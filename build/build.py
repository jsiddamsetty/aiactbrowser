#!/usr/bin/env python3
"""
Build the two JSON files the site loads.

    data/aiact.json    the Act as it now stands (consolidated, in force
                       27.07.2026) plus recitals, definitions and the graph
    data/changes.json  what the Digital Omnibus changed, provision by
                       provision, with a word-level redline

Three source documents, two markups:

    source-oj.html            Regulation (EU) 2024/1689 as first published
                              — the ONLY source of the 180 recitals, which a
                              consolidated text never reproduces
    source-consolidated.html  the same Regulation as amended and in force
    source-omnibus.html       Regulation (EU) 2026/1744, the amending act —
                              its 47 recitals explain why each change was made

Change status is taken from EUR-Lex's own ▼M1 annotations, never inferred from
a text comparison: the two exports come from different converters, so a naive
diff reports punctuation and footnote noise as amendments. The diff is used
only to render the redline for provisions EUR-Lex has already marked.

    python3 build/build.py
"""

import difflib
import json
import os
import re
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bs4 import BeautifulSoup

import parse as oj
from parse import (
    ROMAN, article_refs, annex_refs, derive_recital_links, build_edges,
)
from parse_consolidated import AMENDER, norm_ws, parse_consolidated

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "data")

SRC_OJ = os.path.join(HERE, "source-oj.html")
SRC_OMNIBUS = os.path.join(HERE, "source-omnibus.html")

IN_FORCE = "27 July 2026"


# ------------------------------------------------------------------- reading

def read_oj(path):
    """Parse a document in the original Official Journal (fmx) markup."""
    with open(path, encoding="utf-8", errors="replace") as fh:
        soup = BeautifulSoup(fh.read(), "html.parser")
    footnotes = oj.parse_footnotes(soup)
    articles, chapters = oj.parse_structure(soup, footnotes)
    return {
        "articles": articles,
        "chapters": chapters,
        "recitals": oj.parse_recitals(soup, footnotes),
        "annexes": oj.parse_annexes(soup, footnotes),
        "definitions": oj.parse_definitions(soup, footnotes),
        "footnotes": footnotes,
    }


# ---------------------------------------------------------------- word diff

CANON_SUBS = [
    (re.compile(r"[‘’]"), "'"),
    (re.compile(r"[“”]"), '"'),
    (re.compile(r"[—–]"), "-"),
    (re.compile(r"\*+\d*"), ""),        # asterisk footnote marks
    (re.compile(r"\(\s*\)"), ""),       # parens left behind by a stripped mark
    (re.compile(r"\s+([,.;:)\]])"), r"\1"),
    (re.compile(r"([(\[])\s+"), r"\1"),
]


def canon(text):
    t = norm_ws(text)
    for pat, rep in CANON_SUBS:
        t = pat.sub(rep, t)
    return norm_ws(t)


def tokens(text):
    """Words with their trailing space, so a join reproduces the text."""
    return re.findall(r"\S+\s*", canon(text))


def redline(before, after):
    """Word-level diff as [[op, text], …] with op -1 delete, 0 equal, 1 insert."""
    a, b = tokens(before), tokens(after)
    ops = []

    def push(op, text):
        if not text:
            return
        if ops and ops[-1][0] == op:
            ops[-1][1] += text
        else:
            ops.append([op, text])

    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(
            None, a, b, autojunk=False).get_opcodes():
        if tag == "equal":
            push(0, "".join(a[i1:i2]))
        else:
            if tag in ("replace", "delete"):
                push(-1, "".join(a[i1:i2]))
            if tag in ("replace", "insert"):
                push(1, "".join(b[j1:j2]))

    return [[o, t.strip() if o else t] if False else [o, t] for o, t in ops]


def diff_stats(ops):
    added = sum(len(t.split()) for o, t in ops if o == 1)
    removed = sum(len(t.split()) for o, t in ops if o == -1)
    kept = sum(len(t.split()) for o, t in ops if o == 0)
    total = kept + max(added, removed)
    return {
        "added": added,
        "removed": removed,
        "changedShare": round((added + removed) / (2 * total), 3) if total else 0,
    }


def trim_equal(ops, keep=14):
    """Collapse long runs of unchanged words so a redline stays readable."""
    out = []
    for i, (op, text) in enumerate(ops):
        if op != 0:
            out.append([op, text])
            continue
        words = text.split(" ")
        if len(words) <= keep * 2:
            out.append([0, text])
            continue
        head = " ".join(words[:keep])
        tail = " ".join(words[-keep:])
        if i == 0:
            out.append([0, "… " + tail])
        elif i == len(ops) - 1:
            out.append([0, head + " …"])
        else:
            out.append([0, head + " … " + tail])
    return out


# ------------------------------------------------------------------- assembly

def main():
    print("reading sources…")
    original = read_oj(SRC_OJ)
    omnibus = read_oj(SRC_OMNIBUS)
    current = parse_consolidated()

    # ---- nodes -----------------------------------------------------------
    articles = current["articles"]
    annexes = current["annexes"]
    definitions = current["definitions"]
    chapters = current["chapters"]

    # A consolidated text never carries the preamble, so the recitals come from
    # the Act as first published; the amending act's recitals come with it and
    # are what explain the 2026 changes.
    recitals = original["recitals"]
    for r in recitals:
        r["source"] = "32024R1689"
        r["sourceLabel"] = "Regulation (EU) 2024/1689"

    omni_recitals = []
    for r in omnibus["recitals"]:
        r = dict(r)
        r["id"] = "omr_%d" % r["num"]
        r["label"] = "Omnibus recital %d" % r["num"]
        r["source"] = AMENDER["celex"]
        r["sourceLabel"] = AMENDER["title"]
        r["amending"] = True
        omni_recitals.append(r)

    all_recitals = recitals + omni_recitals

    nodes = articles + all_recitals + annexes + definitions
    by_id = {n["id"]: n for n in nodes}

    # ---- edges -----------------------------------------------------------
    print("linking…")
    edges = build_edges(by_id, articles, all_recitals, annexes, definitions)

    # Recital -> provision, for both preambles.
    seen = {(e["s"], e["t"], e["k"]) for e in edges}
    for src, tgt, score in derive_recital_links(all_recitals, articles, annexes):
        if (src, tgt, "explains") in seen or (src, tgt, "relates") in seen:
            continue
        seen.add((src, tgt, "relates"))
        edges.append({"s": src, "t": tgt, "k": "relates", "w": 1, "score": score})

    deg = defaultdict(int)
    for e in edges:
        deg[e["s"]] += 1
        deg[e["t"]] += 1
    for n in nodes:
        n["degree"] = deg.get(n["id"], 0)

    changed = [n for n in articles + annexes + definitions if n.get("status")]

    doc = {
        "meta": {
            "title": "Regulation (EU) 2024/1689 — Artificial Intelligence Act",
            "shortTitle": "EU AI Act",
            "celex": "32024R1689",
            "version": "consolidated",
            "inForce": IN_FORCE,
            "source": "Consolidated text, EUR-Lex, in force from " + IN_FORCE,
            "sourceUrl": "https://eur-lex.europa.eu/eli/reg/2024/1689/2026-07-27/eng",
            "originalUrl": "https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng",
            "amendedBy": AMENDER,
            "counts": {
                "articles": len(articles),
                "recitals": len(recitals),
                "omnibusRecitals": len(omni_recitals),
                "annexes": len(annexes),
                "definitions": len(definitions),
                "edges": len(edges),
                "changed": len(changed),
            },
        },
        "chapters": chapters,
        "articles": articles,
        "recitals": all_recitals,
        "annexes": annexes,
        "definitions": definitions,
        "footnotes": current["footnotes"],
        "edges": edges,
    }

    write(os.path.join(DATA, "aiact.json"), doc)

    # ---- changes ---------------------------------------------------------
    print("diffing…")
    changes = build_changes(original, current, omni_recitals, edges)
    write(os.path.join(DATA, "changes.json"), changes)

    report(doc, changes, original)


def build_changes(original, current, omni_recitals, edges):
    orig_articles = {"art_%d" % a["num"]: a for a in original["articles"]}
    orig_annexes = {a["id"]: a for a in original["annexes"]}
    orig_defs = {d["id"]: d for d in original["definitions"]}

    items = []

    def add(node, before, kind):
        entry = {
            "id": node["id"],
            "type": node["type"],
            "label": node["label"],
            "title": node.get("title") or node.get("term") or "",
            "status": node["status"],
            "kind": kind,
        }
        if node["status"] == "inserted" or before is None:
            entry["status"] = "inserted"
            entry["words"] = node["words"]
            entry["preview"] = node["text"][:400]
        else:
            ops = redline(before["text"], node["text"])
            entry["stats"] = diff_stats(ops)
            entry["diff"] = trim_equal(ops)
        items.append(entry)

    for a in current["articles"]:
        if a.get("status"):
            add(a, orig_articles.get(a["id"]), "article")
    for a in current["annexes"]:
        if a.get("status"):
            add(a, orig_annexes.get(a["id"]), "annex")
    for d in current["definitions"]:
        if d.get("status"):
            add(d, orig_defs.get(d["id"]), "definition")

    # Anything in the original that the consolidated text no longer contains.
    gone = []
    cur_ids = {a["id"] for a in current["articles"]}
    for aid, a in orig_articles.items():
        if aid not in cur_ids:
            gone.append({"id": aid, "label": a["label"], "title": a["title"],
                         "type": "article", "status": "removed", "kind": "article"})
    items.extend(gone)

    # Which omnibus recital explains which provision.
    explains = defaultdict(list)
    for e in edges:
        if e["s"].startswith("omr_") and e["k"] in ("explains", "relates"):
            explains[e["t"]].append({"id": e["s"], "how": e["k"]})
    for it in items:
        rs = explains.get(it["id"], [])
        if rs:
            it["recitals"] = sorted(rs, key=lambda r: int(r["id"].split("_")[1]))[:6]

    order = {"inserted": 0, "amended": 1, "removed": 2}
    items.sort(key=lambda i: (order.get(i["status"], 9), sort_key(i["id"])))

    return {
        "meta": {
            "amendedBy": AMENDER,
            "inForce": IN_FORCE,
            "baseUrl": "https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng",
            "counts": {
                "total": len(items),
                "inserted": sum(1 for i in items if i["status"] == "inserted"),
                "amended": sum(1 for i in items if i["status"] == "amended"),
                "removed": sum(1 for i in items if i["status"] == "removed"),
                "articles": sum(1 for i in items if i["kind"] == "article"),
                "annexes": sum(1 for i in items if i["kind"] == "annex"),
                "definitions": sum(1 for i in items if i["kind"] == "definition"),
                "recitals": len(omni_recitals),
            },
        },
        "items": items,
        "recitals": omni_recitals,
    }


def sort_key(nid):
    m = re.match(r"^(art|anx|def)_(.+)$", nid)
    if not m:
        return (9, 0, "")
    kind, rest = m.groups()
    order = {"art": 0, "anx": 1, "def": 2}[kind]
    mm = re.match(r"^(\d+)([a-z]*)$", rest)
    if mm:
        return (order, int(mm.group(1)), mm.group(2))
    return (order, ROMAN.get(rest, 0), "")


def write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))


def report(doc, changes, original):
    c = doc["meta"]["counts"]
    print()
    print("articles    %d  (%d in the original)" % (c["articles"], len(original["articles"])))
    print("recitals    %d  + %d from the amending act" % (c["recitals"], c["omnibusRecitals"]))
    print("annexes     %d  (%d in the original)" % (c["annexes"], len(original["annexes"])))
    print("definitions %d" % c["definitions"])
    print("edges       %d" % c["edges"])
    cc = changes["meta"]["counts"]
    print("changes     %d  (%d inserted · %d amended · %d removed)"
          % (cc["total"], cc["inserted"], cc["amended"], cc["removed"]))

    for name in ("aiact.json", "changes.json"):
        p = os.path.join(DATA, name)
        print("-> data/%-14s %6.0f KB" % (name, os.path.getsize(p) / 1024.0))

    # Loud failures beat a quietly half-empty site.
    warn = []
    if c["articles"] < 119:
        warn.append("expected 119 articles")
    if c["recitals"] != 180:
        warn.append("expected 180 recitals")
    gaps = sorted(set(range(1, 181)) - {r["num"] for r in doc["recitals"]
                                        if not r.get("amending")})
    if gaps:
        warn.append("missing recitals %s" % gaps[:8])
    empty = [i["label"] for i in changes["items"]
             if i["status"] == "amended" and not i.get("diff")]
    if empty:
        warn.append("amended with an empty redline: %s" % empty[:6])
    for w in warn:
        print("WARN", w)


if __name__ == "__main__":
    main()
