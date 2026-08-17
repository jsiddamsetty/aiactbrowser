#!/usr/bin/env python3
"""
Parse the official Official Journal HTML of Regulation (EU) 2024/1689 (the AI Act)
into a single JSON graph consumed by the browser app.

Input : build/source-oj.html   (EUR-Lex CONVEX export, ELI markup)
Output: data/aiact.json

Produces nodes for articles, recitals, annexes and Article 3 definitions, plus a
cross-reference edge list derived from the statutory text itself.
"""

import json
import math
import os
import re
import unicodedata
from collections import defaultdict

from bs4 import BeautifulSoup, NavigableString, Tag

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(HERE, "source-oj.html")
OUT = os.path.join(ROOT, "data", "aiact.json")

ROMAN = {
    "I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7,
    "VIII": 8, "IX": 9, "X": 10, "XI": 11, "XII": 12, "XIII": 13,
}
ROMAN_RE = r"(?:X{0,3})(?:IX|IV|V?I{0,3})"


# ---------------------------------------------------------------- utilities

def clean_ws(s):
    """Collapse whitespace, normalise the OJ's non-breaking and soft spaces."""
    s = s.replace(" ", " ").replace(" ", " ").replace(" ", " ")
    return re.sub(r"\s+", " ", s).strip()


def slugify(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return re.sub(r"-{2,}", "-", s)


# The OJ sets chapter headings in full capitals. Lower-casing them needs to keep
# the Act's acronyms intact — str.title() would give "High-Risk Ai Systems".
ACRONYMS = {"AI", "EU", "GPAI", "ID", "IT", "R&D", "SME", "SMES"}
MINOR_WORDS = {
    "a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into",
    "nor", "of", "on", "or", "the", "to", "with", "along",
}


def smart_title(s):
    """Title-case an all-caps heading without mangling acronyms."""
    if not s or not s.isupper():
        return s

    def word(w, first):
        if not w:
            return w
        if "-" in w:
            return "-".join(word(part, first and i == 0) for i, part in enumerate(w.split("-")))
        bare = w.strip("(),.:;'’")
        if bare in ACRONYMS:
            return w
        low = w.lower()
        if not first and bare.lower() in MINOR_WORDS:
            return low
        return low[:1].upper() + low[1:]

    words = s.split()
    return " ".join(word(w, i == 0 or i == len(words) - 1) for i, w in enumerate(words))


def cols_of(table):
    """Width of each <col> in an OJ layout table, e.g. ['4%', '96%']."""
    return [c.get("width", "") for c in table.find_all("col", recursive=False)]


def own_rows(table):
    """Rows belonging to this table only, not to tables nested inside its cells."""
    rows = table.find_all("tr", recursive=False)
    for body in table.find_all(["tbody", "thead"], recursive=False):
        rows.extend(body.find_all("tr", recursive=False))
    return rows


# ------------------------------------------------------- inline HTML output

INLINE_KEEP = {"i", "em", "b", "strong", "sup", "sub", "br"}


def inline_html(node, footnotes):
    """Render an inline run of the OJ tree to safe, minimal HTML.

    Keeps emphasis, turns footnote anchors into <sup class="fn"> markers, and
    drops EUR-Lex's internal navigation links (they point at the OJ site).
    """
    out = []
    for child in node.children:
        if isinstance(child, NavigableString):
            out.append(escape_text(str(child)))
            continue
        if not isinstance(child, Tag):
            continue

        name = child.name.lower()

        if name == "a":
            href = child.get("href", "")
            # Footnote reference: <a href="#ntr12-..."><span class="oj-note-tag">12</span></a>
            m = re.match(r"#ntr(\d+)-", href)
            if m:
                n = m.group(1)
                title = footnotes.get(n, "")
                out.append(
                    '<sup class="fn" data-fn="%s" title="%s">%s</sup>'
                    % (n, escape_attr(title), n)
                )
                continue
            # Any other link: keep the text only.
            out.append(inline_html(child, footnotes))
            continue

        if name == "span":
            cls = " ".join(child.get("class", []))
            inner = inline_html(child, footnotes)
            if "oj-bold" in cls:
                out.append("<strong>%s</strong>" % inner)
            elif "oj-italic" in cls:
                out.append("<em>%s</em>" % inner)
            elif "oj-super" in cls:
                out.append("<sup>%s</sup>" % inner)
            else:
                out.append(inner)
            continue

        if name in INLINE_KEEP:
            if name == "br":
                out.append("<br>")
            else:
                out.append("<%s>%s</%s>" % (name, inline_html(child, footnotes), name))
            continue

        out.append(inline_html(child, footnotes))

    return "".join(out)


def escape_text(s):
    s = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return s.replace(" ", " ")


def escape_attr(s):
    return escape_text(s).replace('"', "&quot;").replace("\n", " ")


# ------------------------------------------------------ block HTML output

def render_blocks(container, footnotes, depth=0):
    """Render an article/annex/recital body into structured HTML.

    The OJ uses borderless <table> elements for every enumerated point. We turn
    those back into real lists so the text is readable and indentable.
    """
    parts = []
    for child in container.children:
        if not isinstance(child, Tag):
            continue
        name = child.name.lower()
        cls = " ".join(child.get("class", []))

        if name == "p":
            html = inline_html(child, footnotes)
            if not clean_ws(re.sub(r"<[^>]+>", "", html)):
                continue
            if "oj-ti-grseq-1" in cls:
                parts.append('<h4 class="doc-h">%s</h4>' % html)
            elif "oj-ti-art" in cls or "oj-sti-art" in cls or "oj-doc-ti" in cls:
                continue  # headings are emitted from node metadata instead
            elif "oj-note" in cls:
                continue  # footnotes are collected separately
            else:
                parts.append('<p class="doc-p">%s</p>' % html)
            continue

        if name == "table":
            parts.append(render_point_table(child, footnotes, depth))
            continue

        if name == "div":
            # Numbered paragraph of an article, e.g. <div id="025.002">
            pid = child.get("id", "")
            m = re.match(r"^\d{3}\.(\d{3})$", pid)
            if m:
                pnum = int(m.group(1))
                inner = render_blocks(child, footnotes, depth)
                parts.append(
                    '<section class="para" id="p%d" data-para="%d">%s</section>'
                    % (pnum, pnum, inner)
                )
            else:
                parts.append(render_blocks(child, footnotes, depth))
            continue

        if name in ("hr",):
            continue

    return "".join(parts)


def render_point_table(table, footnotes, depth):
    """An OJ layout table -> a list of (marker, body) points."""
    widths = cols_of(table)
    items = []
    # Only this table's own rows: the OJ nests point tables inside <td>, and a
    # recursive search would render the inner rows here as well as in place.
    for tr in own_rows(table):
        tds = tr.find_all("td", recursive=False)
        if not tds:
            continue

        # Leading empty cells indicate nesting depth.
        cells = tds
        lead = 0
        while cells and not clean_ws(cells[0].get_text()):
            lead += 1
            cells = cells[1:]
        if not cells:
            continue

        if len(cells) >= 2:
            marker = clean_ws(cells[0].get_text())
            body = render_blocks(cells[1], footnotes, depth + 1)
            if not body:
                body = '<p class="doc-p">%s</p>' % inline_html(cells[1], footnotes)
        else:
            marker = ""
            body = render_blocks(cells[0], footnotes, depth + 1)
            if not body:
                body = '<p class="doc-p">%s</p>' % inline_html(cells[0], footnotes)

        items.append((lead, marker, body))

    if not items:
        return ""

    # A single wide cell with no marker is just a block of text.
    if len(items) == 1 and not items[0][1] and len(widths) <= 1:
        return items[0][2]

    out = []
    for lead, marker, body in items:
        cls = "point" + (" point-nested" if lead else "")
        out.append(
            '<div class="%s"><span class="point-marker">%s</span>'
            '<div class="point-body">%s</div></div>' % (cls, escape_text(marker), body)
        )
    return "".join(out)


def plain_text(html):
    txt = re.sub(r"<sup class=\"fn\".*?</sup>", " ", html)
    txt = re.sub(r"<[^>]+>", " ", txt)
    return clean_ws(txt)


# ---------------------------------------------------------------- footnotes

def parse_footnotes(soup):
    notes = {}
    for p in soup.select("p.oj-note"):
        a = p.find("a", id=re.compile(r"^ntr\d+-"))
        if not a:
            continue
        m = re.match(r"^ntr(\d+)-", a.get("id", ""))
        if not m:
            continue
        num = m.group(1)
        text = clean_ws(p.get_text())
        text = re.sub(r"^\(\s*%s\s*\)\s*" % re.escape(num), "", text)
        notes[num] = text
    return notes


# --------------------------------------------------------- structure walker

def parse_structure(soup, footnotes):
    """Walk chapters -> sections -> articles, keeping the hierarchy."""
    articles = []
    chapters = []

    enc = soup.find("div", id="enc_1")
    if enc is None:
        raise SystemExit("Could not find the enacting terms (div#enc_1).")

    for cdiv in enc.find_all("div", id=re.compile(r"^cpt_%s$" % ROMAN_RE), recursive=True):
        cid = cdiv.get("id")
        roman = cid.split("_", 1)[1]
        title_div = cdiv.find("div", class_="eli-title")
        ch_title = clean_ws(title_div.get_text()) if title_div else ""
        chapters.append({
            "id": cid,
            "roman": roman,
            "num": ROMAN.get(roman, 0),
            "label": "Chapter " + roman,
            "title": smart_title(ch_title),
            "sections": [],
        })

        # Sections are sibling headings inside the chapter; track the current one
        # while scanning articles in document order.
        cur_section = None
        for el in cdiv.find_all(["p", "div"], recursive=True):
            if el.name == "p" and "oj-ti-section-1" in (el.get("class") or []):
                txt = clean_ws(el.get_text())
                if txt.upper().startswith("SECTION"):
                    sec_title_div = el.find_next("div", class_="eli-title")
                    sec_title = clean_ws(sec_title_div.get_text()) if sec_title_div else ""
                    cur_section = {
                        "label": "Section " + txt.split()[-1],
                        "num": txt.split()[-1],
                        "title": smart_title(sec_title),
                    }
                    chapters[-1]["sections"].append(cur_section)
                continue

            if el.name == "div" and re.match(r"^art_\d+$", el.get("id") or ""):
                art = parse_article(el, footnotes, chapters[-1], cur_section)
                if art:
                    articles.append(art)

    articles.sort(key=lambda a: a["num"])
    return articles, chapters


def parse_article(adiv, footnotes, chapter, section):
    num_p = adiv.find("p", class_="oj-ti-art")
    if not num_p:
        return None
    m = re.search(r"(\d+)", clean_ws(num_p.get_text()))
    if not m:
        return None
    num = int(m.group(1))

    title_div = adiv.find("div", class_="eli-title")
    title = clean_ws(title_div.get_text()) if title_div else ""
    title = title.rstrip("`").strip()  # the OJ export has a stray backtick on Art. 1

    body = render_blocks(adiv, footnotes)
    text = plain_text(body)

    return {
        "id": "art_%d" % num,
        "type": "article",
        "num": num,
        "label": "Article %d" % num,
        "title": title,
        "chapter": chapter["roman"],
        "chapterLabel": chapter["label"],
        "chapterTitle": chapter["title"],
        "section": section["num"] if section else None,
        "sectionLabel": section["label"] if section else None,
        "sectionTitle": section["title"] if section else None,
        "html": body,
        "text": text,
        "words": len(text.split()),
    }


def parse_recitals(soup, footnotes):
    recitals = []
    for rdiv in soup.find_all("div", id=re.compile(r"^rct_\d+$")):
        num = int(rdiv.get("id").split("_")[1])
        body = render_blocks(rdiv, footnotes)
        # Recitals are a single point whose marker is the recital number; strip it.
        body = re.sub(
            r'^<div class="point"><span class="point-marker">\(\d+\)</span>'
            r'<div class="point-body">(.*)</div></div>$',
            r"\1", body, flags=re.S,
        )
        text = plain_text(body)
        if not text:
            continue
        recitals.append({
            "id": "rct_%d" % num,
            "type": "recital",
            "num": num,
            "label": "Recital %d" % num,
            "title": "",
            "html": body,
            "text": text,
            "words": len(text.split()),
        })
    recitals.sort(key=lambda r: r["num"])
    return recitals


def parse_annexes(soup, footnotes):
    annexes = []
    for adiv in soup.find_all("div", id=re.compile(r"^anx_%s$" % ROMAN_RE)):
        roman = adiv.get("id").split("_", 1)[1]
        titles = adiv.find_all("p", class_="oj-doc-ti", recursive=False)
        title = clean_ws(titles[1].get_text()) if len(titles) > 1 else ""
        body = render_blocks(adiv, footnotes)
        text = plain_text(body)
        annexes.append({
            "id": "anx_%s" % roman,
            "type": "annex",
            "num": ROMAN.get(roman, 0),
            "roman": roman,
            "label": "Annex %s" % roman,
            "title": title,
            "html": body,
            "text": text,
            "words": len(text.split()),
        })
    annexes.sort(key=lambda a: a["num"])
    return annexes


# -------------------------------------------------------------- definitions

# A few entries interpose a qualifier: 'subject', for the purpose of real-world
# testing, means ...
DEF_RE = re.compile(r"^[‘'\"]([^’'\"]+)[’'\"]\s*(?:,[^,]{0,80},)?\s*means\b", re.I)


def parse_definitions(soup, footnotes):
    """Article 3 defines 68 terms; each becomes its own node."""
    art3 = soup.find("div", id="art_3")
    if art3 is None:
        return []

    defs = []
    for table in art3.find_all("table", recursive=False):
        for tr in own_rows(table):
            tds = tr.find_all("td", recursive=False)
            if len(tds) < 2:
                continue
            marker = clean_ws(tds[0].get_text())
            m = re.match(r"^\((\d+)\)$", marker)
            if not m:
                continue
            idx = int(m.group(1))
            body_html = render_blocks(tds[1], footnotes)
            if not body_html:
                body_html = '<p class="doc-p">%s</p>' % inline_html(tds[1], footnotes)
            text = plain_text(body_html)
            dm = DEF_RE.match(text)
            if not dm:
                # A few entries use "'X' means" spread over emphasis tags.
                dm = re.match(r"^[‘'\"]?([^’'\";]{2,80}?)[’'\"]?\s+means\b", text)
            term = clean_ws(dm.group(1)) if dm else ""
            if not term:
                continue
            defs.append({
                "id": "def_%d" % idx,
                "type": "definition",
                "num": idx,
                "term": term,
                "label": "‘%s’" % term,
                "title": term,
                "html": body_html,
                "text": text,
                "words": len(text.split()),
                "slug": slugify(term),
            })
    return defs


# ------------------------------------------------------ reference extraction

ART_RE = re.compile(
    r"\bArticles?\s+(\d{1,3})"
    r"((?:\s*(?:,|and|to|or)\s*\d{1,3})*)",
    re.I,
)
ANX_RE = re.compile(r"\bAnnexes?\s+(%s)((?:\s*(?:,|and|to|or)\s*%s)*)\b" % (ROMAN_RE, ROMAN_RE))


def article_refs(text, self_id=None):
    """All 'Article N' / 'Articles N, M and K' targets in a block of text."""
    found = []
    for m in ART_RE.finditer(text):
        nums = [m.group(1)]
        tail = m.group(2) or ""
        connector_to = False
        for tm in re.finditer(r"(,|and|to|or)\s*(\d{1,3})", tail, re.I):
            if tm.group(1).lower() == "to":
                connector_to = True
            nums.append(tm.group(2))
        ints = [int(n) for n in nums]
        # "Articles 8 to 15" means the whole inclusive range.
        if connector_to and len(ints) >= 2:
            expanded = set(ints)
            for a, b in zip(ints, ints[1:]):
                if b > a and b - a <= 40:
                    expanded.update(range(a, b + 1))
            ints = sorted(expanded)
        for n in ints:
            if 1 <= n <= 113:
                found.append("art_%d" % n)
    if self_id:
        found = [f for f in found if f != self_id]
    return found


def annex_refs(text):
    found = []
    for m in ANX_RE.finditer(text):
        romans = [m.group(1)]
        for tm in re.finditer(r"(?:,|and|to|or)\s*(%s)\b" % ROMAN_RE, m.group(2) or ""):
            if tm.group(1):
                romans.append(tm.group(1))
        for r in romans:
            if r in ROMAN:
                found.append("anx_%s" % r)
    return found


# ------------------------------------------------- recital <-> article links
# The Official Journal text contains no recital-to-article mapping: recitals
# explain the enacting terms but only sometimes name them. Explicit "Article N"
# mentions give us part of the picture; for the rest we score topical similarity
# (TF-IDF cosine, boosted when the recital repeats the article's title words)
# and keep only confident matches. Derived links are tagged separately from
# explicit ones so the UI can label and filter them.

STOPWORDS = set("""a an the and or of to in for on by with as that this those these is are be been being
shall which such where when it its their they them from at not no any all other under pursuant
accordance order ensure ensuring including include included also well means natural legal person
persons body bodies case cases use used using make made take taken new than only same both each
should would may can must has have had do does within into out up down over more most less least
regulation union member states article articles annex annexes paragraph point points referred set
laid down respect regard view purpose purposes relevant appropriate necessary provided including""".split())

SIM_MIN = 0.20          # absolute floor for a derived link
SIM_REL = 0.45          # and at least this share of the recital's best score
SIM_MAX_PER_RECITAL = 3


def _tokens(text):
    return [w for w in re.findall(r"[a-z][a-z\-]{2,}", text.lower()) if w not in STOPWORDS]


def _tfidf_vectors(docs):
    df = defaultdict(int)
    for words in docs.values():
        for w in set(words):
            df[w] += 1
    n = len(docs) or 1
    vecs = {}
    for key, words in docs.items():
        tf = defaultdict(int)
        for w in words:
            tf[w] += 1
        v = {}
        for w, c in tf.items():
            if df[w] < 2:
                continue
            v[w] = (1 + math.log(c)) * math.log(n / df[w])
        norm = math.sqrt(sum(x * x for x in v.values())) or 1.0
        vecs[key] = {w: x / norm for w, x in v.items()}
    return vecs


def _cosine(a, b):
    if len(a) > len(b):
        a, b = b, a
    return sum(x * b.get(w, 0.0) for w, x in a.items())


def derive_recital_links(recitals, articles, annexes):
    """Suggest the provision each recital is explaining."""
    targets = list(articles) + list(annexes)
    docs = {n["id"]: _tokens(n["text"]) for n in targets}
    for r in recitals:
        docs[r["id"]] = _tokens(r["text"])
    vecs = _tfidf_vectors(docs)

    title_tokens = {n["id"]: set(_tokens(n["title"])) for n in targets}
    out = []

    for r in recitals:
        rv = vecs[r["id"]]
        rwords = set(docs[r["id"]])
        scored = []
        for t in targets:
            s = _cosine(rv, vecs[t["id"]])
            tt = title_tokens[t["id"]]
            if tt:
                # A recital that repeats an article's title words is very likely
                # about that article.
                s *= 1.0 + 0.8 * (len(tt & rwords) / len(tt))
            if s > 0:
                scored.append((s, t["id"]))
        if not scored:
            continue
        scored.sort(reverse=True)
        best = scored[0][0]
        for s, tid in scored[:SIM_MAX_PER_RECITAL]:
            if s >= SIM_MIN and s >= SIM_REL * best:
                out.append((r["id"], tid, round(s, 3)))
    return out


def build_edges(nodes_by_id, articles, recitals, annexes, definitions):
    """Directed edges. Every edge records where it came from so the UI can
    explain and filter it."""
    edges = []
    seen = set()

    def add(src, dst, kind, weight=1, score=None):
        if src == dst or dst not in nodes_by_id or src not in nodes_by_id:
            return
        key = (src, dst, kind)
        if key in seen:
            return
        seen.add(key)
        e = {"s": src, "t": dst, "k": kind, "w": weight}
        if score is not None:
            e["score"] = score
        edges.append(e)

    # --- citations found in the statutory text ---------------------------
    for node in list(articles) + list(recitals) + list(annexes) + list(definitions):
        txt = node["text"]
        src = node["id"]
        for tgt in article_refs(txt, self_id=src):
            add(src, tgt, "cites")
        for tgt in annex_refs(txt):
            add(src, tgt, "annex")

    # --- recital -> provision --------------------------------------------
    # Explicit naming first, then derived topical matches for the majority of
    # recitals that never name the article they explain.
    for r in recitals:
        for tgt in article_refs(r["text"]):
            add(r["id"], tgt, "explains")
    for src, tgt, score in derive_recital_links(recitals, articles, annexes):
        if (src, tgt, "explains") in seen:
            continue
        add(src, tgt, "relates", score=score)

    # --- definition usage ------------------------------------------------
    # Long/distinctive terms only: matching bare 'risk' or 'AI system' would
    # connect nearly everything to nearly everything.
    for d in definitions:
        term = d["term"]
        if len(term) < 6:
            continue
        pat = re.compile(r"\b%ss?\b" % re.escape(term), re.I)
        for node in list(articles) + list(recitals) + list(annexes):
            hits = len(pat.findall(node["text"]))
            if hits:
                add(node["id"], d["id"], "uses", hits)
        # Definitions that build on other definitions.
        for other in definitions:
            if other["id"] == d["id"] or len(other["term"]) < 6:
                continue
            if re.search(r"\b%ss?\b" % re.escape(other["term"]), d["text"], re.I):
                add(d["id"], other["id"], "uses", 1)

    return edges


# --------------------------------------------------------------------- main

def main():
    with open(SRC, encoding="utf-8", errors="replace") as fh:
        html = fh.read()

    soup = BeautifulSoup(html, "html.parser")

    footnotes = parse_footnotes(soup)
    articles, chapters = parse_structure(soup, footnotes)
    recitals = parse_recitals(soup, footnotes)
    annexes = parse_annexes(soup, footnotes)
    definitions = parse_definitions(soup, footnotes)

    nodes = articles + recitals + annexes + definitions
    nodes_by_id = {n["id"]: n for n in nodes}

    edges = build_edges(nodes_by_id, articles, recitals, annexes, definitions)

    # Degree, used for graph node sizing.
    deg = defaultdict(int)
    for e in edges:
        deg[e["s"]] += 1
        deg[e["t"]] += 1
    for n in nodes:
        n["degree"] = deg.get(n["id"], 0)

    doc = {
        "meta": {
            "title": "Regulation (EU) 2024/1689 — Artificial Intelligence Act",
            "shortTitle": "EU AI Act",
            "celex": "32024R1689",
            "source": "Official Journal of the European Union, L series, 12.7.2024",
            "sourceUrl": "https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng",
            "counts": {
                "articles": len(articles),
                "recitals": len(recitals),
                "annexes": len(annexes),
                "definitions": len(definitions),
                "edges": len(edges),
            },
        },
        "chapters": chapters,
        "articles": articles,
        "recitals": recitals,
        "annexes": annexes,
        "definitions": definitions,
        "footnotes": footnotes,
        "edges": edges,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, separators=(",", ":"))

    size = os.path.getsize(OUT) / 1024.0
    print("articles   %d" % len(articles))
    print("recitals   %d" % len(recitals))
    print("annexes    %d" % len(annexes))
    print("definitions%4d" % len(definitions))
    print("footnotes  %d" % len(footnotes))
    print("edges      %d" % len(edges))
    print("chapters   %d" % len(chapters))
    print("-> %s (%.0f KB)" % (OUT, size))

    # Sanity checks that would otherwise fail silently in the UI.
    missing = [a["num"] for a in articles if not a["title"]]
    if missing:
        print("WARN articles without a title:", missing)
    gaps = sorted(set(range(1, 114)) - {a["num"] for a in articles})
    if gaps:
        print("WARN missing articles:", gaps)
    rgaps = sorted(set(range(1, 181)) - {r["num"] for r in recitals})
    if rgaps:
        print("WARN missing recitals:", rgaps)


if __name__ == "__main__":
    main()
