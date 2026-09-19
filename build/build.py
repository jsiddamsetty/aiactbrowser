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
import csv
from datetime import date
import json
import os
import re
import subprocess
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bs4 import BeautifulSoup

import parse as oj
from parse import (
    ROMAN, article_refs, annex_refs, deflected, derive_recital_links,
    build_edges,
)
from parse_consolidated import AMENDER, norm_ws, parse_consolidated
from parse_guidelines import parse_guidelines
from parse_kimig import parse_kimig, kimig_edges, apply_translation
from parse_gdpr import parse_gdpr, gdpr_edges
from parse_bafin import parse_bafin, bafin_edges
from parse_eu import parse_dora
from parse_marisk import parse_marisk, marisk_edges
from model import namespace_nodes, namespace_edges, routed_edges, ns
from editorial import TOPICS, TAGS, RELATIONS, INTERACTIONS, DORA_AI_LENS
import static_pages

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "data")

SRC_OJ = os.path.join(HERE, "source-oj.html")
SRC_OMNIBUS = os.path.join(HERE, "source-omnibus.html")
SRC_GDPR_OJ = os.path.join(HERE, "source-gdpr-oj.html")

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

    # The Commission guidelines that interpret Article 5 and Article 6.
    print("reading the guidelines…")
    guidance, guidance_docs = parse_guidelines()
    # BaFin's guidance on ICT risks in AI — supervisory advice on DORA, which
    # joins the guidance layer but does not interpret the Act.
    print("reading the BaFin guidance…")
    bafin, bafin_doc, bafin_figures = parse_bafin()
    for i, n in enumerate(bafin, len(guidance) + 1):
        n["num"] = i
    guidance = guidance + bafin
    guidance_docs.append(bafin_doc)
    write_files(os.path.join(DATA, "bafin"), bafin_figures)

    # The KI-MIG — the German implementing law, from gesetze-im-internet.de.
    print("reading the KI-MIG…")
    kimig, kimig_parts, kimig_meta = parse_kimig()
    # English leads where a checked translation exists; German stays alongside.
    kimig_en = apply_translation(kimig, kimig_parts, kimig_meta)

    # The GDPR — consolidated articles plus authentic OJ recitals.
    print("reading the GDPR…")
    gdpr, gdpr_chapters, gdpr_meta = parse_gdpr()
    gdpr_oj = read_oj(SRC_GDPR_OJ)
    gdpr_recitals = gdpr_oj["recitals"]
    for recital in gdpr_recitals:
        recital["id"] = "gdpr_rct_%s" % recital["num"]
        recital["label"] = "GDPR recital %s" % recital["num"]
        recital["corpus"] = "gdpr"

    # DORA and the three technical standards called out in the plan.
    print("reading DORA and its technical standards…")
    dora_doc, dora_supporting = parse_dora(HERE)

    # The current MaRisk circular, organised as addressable AT/BT modules.
    print("reading MaRisk…")
    marisk, marisk_parts, marisk_meta = parse_marisk()

    dora_nodes = (dora_doc["articles"] + dora_doc["recitals"] + dora_doc["annexes"] +
                  dora_doc["definitions"])
    support_nodes = []
    for support in dora_supporting:
        support_nodes.extend(support["articles"] + support["recitals"] + support["annexes"])
    nodes = (articles + all_recitals + annexes + definitions + guidance + kimig + gdpr +
             gdpr_recitals + dora_nodes + support_nodes + marisk)
    by_id = {n["id"]: n for n in nodes}

    # ---- edges -----------------------------------------------------------
    print("linking…")
    edges = build_edges(by_id, articles, all_recitals, annexes, definitions)
    edges.extend(guidance_edges(guidance, definitions, by_id))
    edges.extend(bafin_edges(bafin, definitions, by_id))
    edges.extend(kimig_edges(kimig, by_id))
    # Into the GDPR, from its own articles and from every text of the Act that
    # names it — references the deflection guard used to drop.
    edges.extend(gdpr_edges(gdpr, articles + all_recitals + annexes + definitions + guidance,
                            by_id))
    # GDPR recital-to-article links (the consolidated source does not carry a preamble).
    edges.extend(build_edges(by_id, gdpr, gdpr_recitals, [], [], doc="gdpr"))
    edges.extend(dora_doc["edges"])
    for support in dora_supporting:
        edges.extend(support["edges"])
    edges.extend(marisk_edges(marisk, by_id))

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

    # Bare DORA citations in BaFin guidance are contextual rather than named.
    for section in bafin:
        for target in article_refs(section["text"], doc="dora", to="dora"):
            if target in by_id:
                edges.append({"s": section["id"], "t": target, "k": "cites", "w": 1})

    # Deduplicate before calculating graph degrees.
    unique = {}
    for edge in edges:
        key = (edge["s"], edge["t"], edge["k"])
        if key not in unique or len(edge) > len(unique[key]):
            unique[key] = edge
    edges = list(unique.values())

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
                "guidance": len(guidance) - len(bafin),
                "bafin": len(bafin),
                "kimig": len(kimig),
                "kimigEnglish": kimig_en,
                "gdpr": len(gdpr),
                "edges": len(edges),
                "changed": len(changed),
            },
        },
        "kimigMeta": kimig_meta,
        "chapters": chapters,
        "articles": articles,
        "recitals": all_recitals,
        "annexes": annexes,
        "definitions": definitions,
        "guidance": guidance,
        "guidanceDocs": guidance_docs,
        "kimig": kimig,
        "kimigParts": kimig_parts,
        "gdprMeta": gdpr_meta,
        "gdprChapters": gdpr_chapters,
        "gdpr": gdpr,
        "footnotes": current["footnotes"],
        "edges": edges,
    }

    # ---- changes ---------------------------------------------------------
    print("diffing…")
    changes = build_changes(original, current, omni_recitals, edges)

    # ---- namespace and split --------------------------------------------
    # Parsers intentionally keep their source-native, compact IDs.  One pass
    # converts every node, embedded link, and edge endpoint before writing.
    mapping = namespace_nodes(nodes)
    namespaced_edges = namespace_edges(edges, mapping)
    existing_ids = {node["id"] for node in nodes}
    external_nodes, routed = routed_edges(nodes, existing_ids)
    known = {(edge["s"], edge["t"], edge["k"]) for edge in namespaced_edges}
    known_pairs = {(edge["s"], edge["t"]) for edge in namespaced_edges}
    for edge in routed:
        key = (edge["s"], edge["t"], edge["k"])
        if key not in known and (edge["s"], edge["t"]) not in known_pairs:
            namespaced_edges.append(edge); known.add(key); known_pairs.add((edge["s"], edge["t"]))

    # Changes are an AI Act data set and use the same canonical IDs.
    for item in changes["items"]:
        item["id"] = mapping.get(item["id"], ns(item["id"]))
        for recital in item.get("recitals", []):
            recital["id"] = mapping.get(recital["id"], ns(recital["id"]))
    for recital in changes["recitals"]:
        if ":" not in recital["id"]:
            recital["id"] = mapping.get(recital["id"], ns(recital["id"]))

    intra = defaultdict(list)
    xrefs = []
    for edge in namespaced_edges:
        source_corpus = edge["s"].split(":", 1)[0]
        target_corpus = edge["t"].split(":", 1)[0]
        if source_corpus == target_corpus and source_corpus != "ext":
            intra[source_corpus].append(edge)
        else:
            if edge["k"] in ("cites", "annex"):
                edge = dict(edge, sourceKind=edge["k"], k="xcites")
            xrefs.append(edge)

    def pick(corpus, values):
        return [node for node in values if node["id"].startswith(corpus + ":")]

    aia_guidance = pick("aia", guidance)
    corpus_docs = {
        "aia": {
            "meta": doc["meta"], "chapters": chapters, "articles": articles,
            "recitals": all_recitals, "annexes": annexes, "definitions": definitions,
            "guidance": aia_guidance, "guidanceDocs": guidance_docs[:-1],
            "footnotes": current["footnotes"], "edges": intra["aia"],
        },
        "bafin-ai": {"meta": bafin_doc, "guidance": bafin,
                     "guidanceDocs": [bafin_doc], "edges": intra["bafin-ai"]},
        "kimig": {"meta": kimig_meta, "kimig": kimig, "kimigParts": kimig_parts,
                  "edges": intra["kimig"]},
        "gdpr": {"meta": gdpr_meta, "gdpr": gdpr, "recitals": gdpr_recitals,
                 "gdprChapters": gdpr_chapters, "edges": intra["gdpr"]},
        "dora": dict(dora_doc, edges=intra["dora"]),
        "marisk": {"meta": marisk_meta, "modules": marisk, "parts": marisk_parts,
                   "edges": intra["marisk"]},
    }
    for support in dora_supporting:
        slug = support["meta"]["slug"]
        support["edges"] = intra[slug]
        corpus_docs[slug] = support

    # Ensure uniform metadata and accurate post-split counts.
    for slug, corpus_doc in corpus_docs.items():
        meta = corpus_doc.setdefault("meta", {})
        meta["slug"] = slug
        meta.setdefault("sourceUrl", "")
        meta.setdefault("inForce", meta.get("applies") or meta.get("version") or "")
        meta["counts"] = dict(meta.get("counts") or {}, edges=len(corpus_doc.get("edges", [])))
        write(os.path.join(DATA, slug + ".json"), corpus_doc)

    registry = build_registry(corpus_docs)
    topics = build_topics(nodes)
    relations = build_relations(registry, existing_ids)
    by_ns = {node["id"]: node for node in nodes}
    cross_ids = {edge[end] for edge in xrefs for end in ("s", "t")}
    endpoint_nodes = []
    for node_id in sorted(cross_ids):
        if node_id not in by_ns:
            continue
        node = by_ns[node_id]
        endpoint_nodes.append({key: node[key] for key in
                               ("id", "type", "corpus", "label", "title", "term", "key", "num", "roman", "sec")
                               if key in node})
    write(os.path.join(DATA, "registry.json"), registry)
    write(os.path.join(DATA, "xrefs.json"), {
        "nodes": external_nodes + endpoint_nodes, "edges": xrefs,
        "relations": relations["relations"], "citationCounts": aggregate_citations(xrefs),
    })
    write(os.path.join(DATA, "topics.json"), topics)
    write(os.path.join(DATA, "relations.json"), relations)
    write(os.path.join(DATA, "changes.json"), changes)
    write_topics_csv(os.path.join(DATA, "topics.csv"), topics)
    static_pages.main()

    # Report against the old monolith after stripping the new namespaces.
    doc["edges"] = edges
    report(doc, changes, original, corpus_docs, len(xrefs))


RECITAL_REF = re.compile(r"\b[Rr]ecitals?\s+(\d{1,3})\b")


def guidance_edges(guidance, definitions, by_id):
    """Edges for the guidance layer.

    'interprets' is the editorial mapping — what a section is about — and
    drives the guidance block on a provision's page. Literal mentions of
    articles, annexes and recitals in the section text become ordinary
    'cites'/'annex' edges, so guidance takes part in the citation graph on
    the same terms as everything else.
    """
    by_term = {d["term"]: d["id"] for d in definitions}
    edges, seen = [], set()

    def add(src, dst, kind):
        if dst not in by_id or (src, dst, kind) in seen:
            return
        seen.add((src, dst, kind))
        edges.append({"s": src, "t": dst, "k": kind, "w": 1})

    for g in guidance:
        for t in g.pop("targets", []):
            if t.startswith("term:"):
                dst = by_term.get(t[5:])
                if dst is None:
                    print("WARN guidance target %r not in Article 3" % t)
                    continue
                add(g["id"], dst, "interprets")
            else:
                add(g["id"], t, "interprets")
        # The guidelines cite other instruments constantly — "Article 4(4)
        # of Regulation (EU) 2016/679" is the GDPR, not the Act — and
        # article_refs/annex_refs drop any reference deflected to another act.
        # BaFin's references that name no act are DORA's (`act` None), so only
        # those naming the Act count, and its annexes and recitals are not ours.
        own = g.get("act", "aia")
        for ref in article_refs(g["text"], doc=own):
            if (g["id"], ref, "interprets") not in seen:
                add(g["id"], ref, "cites")
        if own != "aia":
            continue
        for ref in annex_refs(g["text"]):
            if (g["id"], ref, "interprets") not in seen:
                add(g["id"], ref, "annex")
        for m in RECITAL_REF.finditer(g["text"]):
            if not deflected(g["text"][m.end():]):
                add(g["id"], "rct_%d" % int(m.group(1)), "cites")

    return edges


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


def write_files(folder, files):
    """Binary build outputs — the figures a PDF source carries."""
    os.makedirs(folder, exist_ok=True)
    for name, data in files.items():
        with open(os.path.join(folder, name), "wb") as fh:
            fh.write(data)


def write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))


def build_registry(corpus_docs):
    details = {
        "aia": ("EU horizontal law", 1, "regulation", "European Union"),
        "gdpr": ("EU horizontal law", 2, "regulation", "European Union"),
        "dora": ("EU sectoral law", 1, "regulation", "European Union"),
        "dora-rts-rmf": ("EU sectoral law", 2, "delegated regulation", "European Commission"),
        "dora-rts-sub": ("EU sectoral law", 3, "delegated regulation", "European Commission"),
        "dora-its-register": ("EU sectoral law", 4, "implementing regulation", "European Commission"),
        "kimig": ("German law", 1, "national law", "Germany"),
        "marisk": ("BaFin", 1, "BaFin circular", "BaFin"),
        "bafin-ai": ("BaFin", 2, "guidance (non-binding)", "BaFin"),
    }
    instruments = []
    for slug, corpus_doc in corpus_docs.items():
        meta = corpus_doc["meta"]
        layer, order, binding, authority = details[slug]
        count = sum(len(corpus_doc.get(key, [])) for key in
                    ("articles", "recitals", "annexes", "definitions", "guidance", "kimig", "modules"))
        instruments.append({
            "slug": slug, "kind": "instrument", "shortTitle": meta.get("shortTitle") or
            meta.get("abbr") or meta.get("name") or slug.upper(),
            "title": meta.get("title") or meta.get("longTitle") or meta.get("name") or slug,
            "citation": meta.get("cite") or meta.get("celex") or "",
            "versionDate": meta.get("inForce") or meta.get("version") or "",
            "layer": layer, "order": order, "bindingLevel": binding, "authority": authority,
            "status": "in", "sourceUrl": meta.get("sourceUrl", ""),
            # These two technical standards are supporting evidence for the
            # third-party-risk story, not standalone reading destinations.
            "menu": slug not in {"dora-rts-sub", "dora-its-register"},
            "route": "#/" + slug if slug not in {"dora-rts-sub", "dora-its-register"} else None,
            "dataFile": "/data/%s.json" % slug, "count": count,
        })
    instruments.extend([
        {"slug": "commission-guidance", "kind": "instrument", "shortTitle": "Commission guidelines",
         "title": "European Commission guidance on the AI Act", "citation": "Article 5 and 6 guidance",
         "layer": "EU guidance", "order": 1, "bindingLevel": "guidance (non-binding)",
         "authority": "European Commission", "status": "in", "route": "#/aia/guidance/pp",
         "sourceUrl": "", "dataFile": "/data/aia.json"},
        {"slug": "authority:bafin", "kind": "authority", "shortTitle": "BaFin",
         "title": "Federal Financial Supervisory Authority", "layer": "Authorities", "order": 1,
         "bindingLevel": "supervisory authority", "authority": "Germany", "status": "in",
         "sourceUrl": "https://www.bafin.de/", "route": None},
        {"slug": "authority:bnetza", "kind": "authority", "shortTitle": "Bundesnetzagentur",
         "title": "Federal Network Agency", "layer": "Authorities", "order": 2,
         "bindingLevel": "market surveillance authority", "authority": "Germany", "status": "in",
         "sourceUrl": "https://www.bundesnetzagentur.de/", "route": None},
    ])
    instruments.sort(key=lambda item: (item.get("layer", ""), item.get("order", 99)))
    return {"generated": date.today().isoformat(), "corpora": instruments}


def build_topics(nodes):
    by_id = {node["id"]: node for node in nodes}
    topics = [{"slug": slug, "name": name,
               "note": "Curated provisions concerning %s." % name.lower()} for slug, name in TOPICS]
    tags = []
    for row in TAGS:
        if row["provision"] not in by_id:
            print("WARN topic tag target %s is not in the corpus" % row["provision"])
            continue
        item = dict(row)
        node = by_id[row["provision"]]
        item["label"] = node["label"]
        item["title"] = node.get("title", "")
        tags.append(item)
    return {"topics": topics, "tags": tags,
            "qualifiers": {"role": sorted({t["qualifiers"].get("role") for t in tags if t["qualifiers"].get("role")}),
                           "applies": sorted({t["qualifiers"].get("applies") for t in tags if t["qualifiers"].get("applies")})}}


def build_relations(registry, existing_ids):
    slugs = {item["slug"] for item in registry["corpora"]}
    relations = []
    for relation in RELATIONS:
        if relation["from"] not in slugs or relation["to"] not in slugs:
            print("WARN relation names unknown instrument: %s -> %s" %
                  (relation["from"], relation["to"]))
            continue
        missing = [ref for ref in relation["grounding"] if ref.split("/", 1)[0] not in existing_ids]
        if missing:
            print("WARN relation %s -> %s has missing grounding %s" %
                  (relation["from"], relation["to"], missing))
            continue
        relations.append(relation)
    interactions = []
    for interaction in INTERACTIONS:
        if interaction["from"] not in slugs or interaction["to"] not in slugs:
            print("WARN interaction names unknown instrument: %s -> %s" %
                  (interaction["from"], interaction["to"]))
            continue
        refs = [ref for mechanism in interaction["mechanisms"]
                for ref in mechanism["grounding"]]
        missing = [ref for ref in refs if ref.split("/", 1)[0] not in existing_ids]
        if missing:
            print("WARN interaction %s -> %s has missing grounding %s" %
                  (interaction["from"], interaction["to"], missing))
            continue
        interactions.append(interaction)
    lens = dict(DORA_AI_LENS)
    cards = []
    for card in lens["cards"]:
        missing = [ref for ref in card["grounding"] if ref.split("/", 1)[0] not in existing_ids]
        if missing:
            print("WARN DORA AI lens card %s has missing grounding %s" %
                  (card["title"], missing))
            continue
        cards.append(card)
    lens["cards"] = cards
    return {"registry": registry["corpora"], "relations": relations,
            "interactions": interactions, "doraAiLens": lens}


def aggregate_citations(edges):
    counts = defaultdict(lambda: {"edges": 0, "targets": set()})
    for edge in edges:
        if edge["k"] not in ("cites", "xcites", "annex"):
            continue
        source = edge["s"].split(":", 1)[0]
        target = edge["t"].split(":", 1)[0]
        row = counts[(source, target)]
        row["edges"] += 1
        row["targets"].add(edge["t"])
    return [{"from": source, "to": target, "citations": row["edges"],
             "provisions": len(row["targets"])}
            for (source, target), row in sorted(counts.items())]


def write_topics_csv(path, topics):
    with open(path, "w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh, lineterminator="\n")
        writer.writerow(["topic", "instrument", "provision", "role", "applies_to", "effect", "reason"])
        for tag in topics["tags"]:
            qualifiers = tag["qualifiers"]
            writer.writerow([tag["topic"], tag.get("instrument", tag["provision"].split(":", 1)[0]), tag["provision"],
                             qualifiers.get("role", ""), qualifiers.get("applies", ""),
                             qualifiers.get("effect", ""), tag["reason"]])


def report(doc, changes, original, corpus_docs=None, xref_count=0):
    c = doc["meta"]["counts"]
    print()
    print("articles    %d  (%d in the original)" % (c["articles"], len(original["articles"])))
    print("recitals    %d  + %d from the amending act" % (c["recitals"], c["omnibusRecitals"]))
    print("annexes     %d  (%d in the original)" % (c["annexes"], len(original["annexes"])))
    print("definitions %d" % c["definitions"])
    print("guidance    %d sections" % c["guidance"])
    print("BaFin       %d sections  (%d related requirements of the Act)"
          % (c["bafin"], sum(1 for e in doc["edges"] if e["k"] == "concords")))
    print("KI-MIG      %d sections  (%d with an English translation)"
          % (c["kimig"], c["kimigEnglish"]))
    into = {e["t"] for e in doc["edges"]
            if e["t"].startswith("gdpr_") and not e["s"].startswith("gdpr_")}
    print("GDPR        %d articles  (%d cited by the Act and its guidance)"
          % (c["gdpr"], len(into)))
    print("edges       %d" % c["edges"])
    cc = changes["meta"]["counts"]
    print("changes     %d  (%d inserted · %d amended · %d removed)"
          % (cc["total"], cc["inserted"], cc["amended"], cc["removed"]))

    names = ["changes.json", "registry.json", "xrefs.json", "topics.json"]
    if corpus_docs:
        names = sorted(slug + ".json" for slug in corpus_docs) + names
    for name in names:
        p = os.path.join(DATA, name)
        print("-> data/%-14s %6.0f KB" % (name, os.path.getsize(p) / 1024.0))

    if xref_count:
        print("cross-refs  %d" % xref_count)

    report_edges(committed_edges(), doc["edges"])

    # Loud failures beat a quietly half-empty site.
    warn = []
    if c["articles"] < 119:
        warn.append("expected 119 articles")
    if c["recitals"] != 180:
        warn.append("expected 180 recitals")
    if c["kimig"] != 20:
        warn.append("expected 20 KI-MIG sections")
    if c["gdpr"] != 99:
        warn.append("expected 99 GDPR articles")
    if c["kimigEnglish"] != c["kimig"]:
        warn.append("%d KI-MIG sections have no valid English translation"
                    % (c["kimig"] - c["kimigEnglish"]))
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


def committed_edges():
    """The edges in the last committed data/aiact.json, or None without git."""
    try:
        blob = subprocess.run(["git", "show", "HEAD:data/aiact.json"], cwd=ROOT,
                              capture_output=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        return None
    return json.loads(blob)["edges"]


def natural(key):
    return [int(p) if p.isdigit() else p for p in re.split(r"(\d+)", key)]


def report_edges(old, new, limit=40):
    """Print the connections this build added or dropped since the last commit.

    The sources never change; the parsers do. data/aiact.json is one line, so
    git reports a parser change that silently drops 250 edges as '2 +-' — this
    is the review that diff cannot give.
    """
    print()
    if old is None:
        print("edges       no committed data/aiact.json to compare with")
        return
    edge = lambda e: (e["s"], e["k"], e["t"])
    order = lambda r: (natural(r[0]), r[1], natural(r[2]))
    before, after = set(map(edge, old)), set(map(edge, new))
    gone = sorted(before - after, key=order)
    came = sorted(after - before, key=order)
    if not gone and not came:
        print("edges       unchanged since the last commit")
        return
    print("edges       %d -> %d since the last commit" % (len(old), len(new)))
    for k in sorted({r[1] for r in gone + came}):
        print("  %-10s -%-4d +%d" % (k, sum(r[1] == k for r in gone),
                                   sum(r[1] == k for r in came)))
    for sign, rows in (("-", gone), ("+", came)):
        for s, k, t in rows[:limit]:
            print("  %s %-16s %-9s %s" % (sign, s, k, t))
        if len(rows) > limit:
            print("  %s … and %d more" % (sign, len(rows) - limit))


if __name__ == "__main__":
    main()
