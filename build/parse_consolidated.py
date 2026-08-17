#!/usr/bin/env python3
"""
Parse the EUR-Lex *consolidated* HTML of Regulation (EU) 2024/1689 — the AI Act
as amended and in force from 27 July 2026.

The consolidated export uses a different converter (clg.css) from the original
Official Journal export, so it needs its own reader:

    original (fmx)                consolidated (clg)
    ------------------------      --------------------------------
    p.oj-ti-art                   p.title-article-norm
    p.oj-sti-art                  p.stitle-article-norm
    p.oj-normal                   div.norm / p.norm
    layout <table> for points     div.grid-container.grid-list
    div#001.002 numbered para     span.no-parag inside div.norm
    p.oj-ti-section-1/2           p.title-division-1/2

Crucially it also carries EUR-Lex's own change annotations: marker paragraphs

    <p class="modref"><a title="32026R1744: REPLACED">▼M1</a></p>
    <p class="arrow"><a title="32024R1689">▼B</a></p>

Each marker applies to everything that follows it until the next marker, so
provenance is positional. We record it per block, which is what lets the app
show exactly which parts of a provision the Digital Omnibus rewrote.
"""

import os
import re
import unicodedata

from bs4 import BeautifulSoup, NavigableString, Tag

from parse import (
    ROMAN, ROMAN_RE, clean_ws, smart_title, escape_text, escape_attr,
    plain_text, slugify, DEF_RE,
)

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "source-consolidated.html")

# The amending act, and how the app names it.
AMENDER = {
    "celex": "32026R1744",
    "id": "M1",
    "title": "Regulation (EU) 2026/1744",
    "short": "Digital Omnibus on AI",
    "date": "8 July 2026",
    "applies": "27 July 2026",
    "url": "https://eur-lex.europa.eu/eli/reg/2026/1744/oj/eng",
}

OP_LABEL = {"REPLACED": "replaced", "INSERTED": "inserted", "DELETED": "deleted"}

# EUR-Lex prints a rule of em-dashes where an amending act removed a passage.
DELETION_MARK = re.compile(r"^[—–\-\s]{3,}$")


def norm_ws(s):
    """Collapse whitespace, treating every Unicode space separator as a space."""
    s = "".join(" " if unicodedata.category(c) == "Zs" else c for c in s)
    return re.sub(r"\s+", " ", s).strip()


# ------------------------------------------------------------ change markers

def marker_state(tag):
    """If `tag` is a ▼B / ▼M1 marker, return the provenance it switches to."""
    if tag.name != "p" or not set(tag.get("class") or []) & {"modref", "arrow"}:
        return None
    a = tag.find("a")
    if not a:
        return None
    label = norm_ws(a.get_text())
    if not label.startswith(("▼", "►")):
        return None
    title = a.get("title", "")
    celex, _, op = title.partition(":")
    return {
        "mark": label.lstrip("▼► "),
        "celex": celex.strip(),
        "op": OP_LABEL.get(op.strip().upper(), ""),
    }


# ------------------------------------------------------------- inline output

def inline_html(node, footnotes):
    out = []
    for child in node.children:
        if isinstance(child, NavigableString):
            out.append(escape_text(str(child)))
            continue
        if not isinstance(child, Tag):
            continue

        name = child.name.lower()
        cls = " ".join(child.get("class", []))

        if name == "a":
            # Footnote reference: <a href="#E0001"><span class="superscript">1</span></a>.
            # The anchor itself carries no class, so the href is the only signal —
            # a bare superscript span elsewhere is an exponent (10²⁵), not a note.
            m = re.match(r"#(?:ntr|src\.)?E?0*(\d+)", child.get("href", "") or "")
            if m and child.find("span", class_="superscript"):
                n = m.group(1)
                out.append('<sup class="fn" data-fn="%s" title="%s">%s</sup>'
                           % (n, escape_attr(footnotes.get(n, "")), n))
                continue
            out.append(inline_html(child, footnotes))
            continue

        if name == "span":
            inner = inline_html(child, footnotes)
            if "boldface" in cls:
                out.append("<strong>%s</strong>" % inner)
            elif "italics" in cls:
                out.append("<em>%s</em>" % inner)
            elif "superscript" in cls:
                out.append("<sup>%s</sup>" % inner)
            else:
                out.append(inner)
            continue

        if name in ("i", "em"):
            out.append("<em>%s</em>" % inline_html(child, footnotes))
            continue
        if name in ("b", "strong"):
            out.append("<strong>%s</strong>" % inline_html(child, footnotes))
            continue
        if name == "br":
            out.append("<br>")
            continue

        out.append(inline_html(child, footnotes))

    return "".join(out)


FN_PARENS = re.compile(r'\(\s*(<sup class="fn"[^>]*>.*?</sup>)\s*\)')


def inline(node, footnotes):
    """Inline HTML with the export's literal ( ) around footnote refs removed —
    the stylesheet draws those, so keeping them would double up."""
    return FN_PARENS.sub(r"\1", inline_html(node, footnotes))


# -------------------------------------------------------------- block output

class Renderer:
    """Walks a provision, rendering HTML and tracking which amendment each
    block came from."""

    def __init__(self, footnotes, state):
        self.footnotes = footnotes
        self.state = state           # current provenance, mutated as we walk
        self.seen = []               # provenance of every block emitted

    def note(self):
        st = self.state[0]
        if st and st.get("mark") and st["mark"] != "B":
            self.seen.append(dict(st))
            return ' data-chg="%s" data-op="%s"' % (
                escape_attr(st["mark"]), escape_attr(st.get("op", "")))
        return ""

    def blocks(self, container):
        parts = []
        for child in container.children:
            if not isinstance(child, Tag):
                continue

            st = marker_state(child)
            if st:
                self.state[0] = st
                # A deletion marker carries its rule of dashes in the same
                # paragraph as the ▼M1 link, so the removal is recorded here
                # rather than in a block of its own.
                rest = norm_ws("".join(
                    t for t in child.strings
                    if not (t.parent and t.parent.name == "a")))
                if rest and DELETION_MARK.match(rest):
                    parts.append(self.deleted())
                continue

            parts.append(self.block(child))
        return "".join(parts)

    def deleted(self):
        return ('<p class="doc-deleted"%s>Passage deleted by the %s</p>'
                % (self.note(), escape_text(AMENDER["short"])))

    def block(self, el):
        name = el.name.lower()
        cls = set(el.get("class") or [])

        if name == "p" and cls & {"title-article-norm", "stitle-article-norm",
                                  "title-division-1", "title-division-2",
                                  "title-annex-1", "title-annex-2", "footnote"}:
            return ""

        if name == "hr":
            return ""

        # The article's own subtitle lives in <div class="eli-title">; it is
        # carried in the node's metadata, not in the body.
        if name == "div" and "eli-title" in cls:
            return ""

        # A point in a list: marker column + body column.
        if "grid-container" in cls:
            return self.point(el)

        # A numbered paragraph: <div class="norm"><span class="no-parag">2. </span>…
        if name == "div" and "norm" in cls:
            lead = el.find("span", class_="no-parag", recursive=False)
            if lead is not None:
                num = norm_ws(lead.get_text()).rstrip(".").strip()
                body = "".join(
                    self.block(c) if isinstance(c, Tag) and not marker_state(c) else ""
                    for c in el.children if c is not lead
                )
                if not body.strip():
                    body = '<p class="doc-p">%s</p>' % inline(el, self.footnotes)
                # The consolidated export keeps the paragraph number in its own
                # span; fold it back into the running text so the provision
                # reads — and diffs against the original — as one piece.
                shown = '<span class="para-n">%s.</span> ' % escape_text(num)
                if re.match(r'^<p class="doc-p"', body):
                    body = re.sub(r'^(<p class="doc-p"[^>]*>)', lambda m: m.group(1) + shown,
                                  body, count=1)
                else:
                    body = '<p class="doc-p">%s</p>%s' % (shown, body)
                pid = re.sub(r"[^0-9a-z]+", "", num.lower())
                return ('<section class="para" id="p%s" data-para="%s"%s>%s</section>'
                        % (pid, escape_attr(num), self.note(), body))
            # Plain block of text.
            inner = self.blocks(el)
            if inner.strip():
                return inner
            return self.para(el)

        if name in ("p", "div"):
            if el.find(["div", "p"], recursive=False):
                inner = self.blocks(el)
                if inner.strip():
                    return inner
            return self.para(el)

        if name == "table":
            return self.table(el)

        return ""

    def para(self, el):
        html = inline(el, self.footnotes)
        text = norm_ws(re.sub(r"<[^>]+>", " ", html))
        if not text:
            return ""
        if DELETION_MARK.match(text):
            # Where a passage was removed, EUR-Lex leaves a rule of dashes.
            return self.deleted()
        cls = set(el.get("class") or [])
        if "title-gr-seq-level-1" in cls or "title-gr-seq-level-2" in cls:
            return '<h4 class="doc-h"%s>%s</h4>' % (self.note(), html)
        return '<p class="doc-p"%s>%s</p>' % (self.note(), html)

    def point(self, el):
        col1 = el.find("div", class_="grid-list-column-1")
        col2 = el.find("div", class_="grid-list-column-2")
        marker = norm_ws(col1.get_text()) if col1 else ""
        body = self.blocks(col2) if col2 else ""
        if col2 is not None and not body.strip():
            body = '<p class="doc-p">%s</p>' % inline(col2, self.footnotes)
        if not marker and not body.strip():
            return ""
        return ('<div class="point"%s><span class="point-marker">%s</span>'
                '<div class="point-body">%s</div></div>'
                % (self.note(), escape_text(marker), body))

    def table(self, el):
        rows = []
        for tr in el.find_all("tr", recursive=False) + [
                r for b in el.find_all("tbody", recursive=False)
                for r in b.find_all("tr", recursive=False)]:
            cells = tr.find_all("td", recursive=False)
            if not cells:
                continue
            texts = [self.blocks(c) or ('<p class="doc-p">%s</p>' % inline(c, self.footnotes))
                     for c in cells]
            texts = [t for t in texts if norm_ws(re.sub(r"<[^>]+>", " ", t))]
            if not texts:
                continue
            if len(texts) >= 2:
                rows.append('<div class="point"><span class="point-marker">%s</span>'
                            '<div class="point-body">%s</div></div>'
                            % (norm_ws(re.sub(r"<[^>]+>", " ", texts[0])),
                               "".join(texts[1:])))
            else:
                rows.append(texts[0])
        return "".join(rows)


# ---------------------------------------------------------------- footnotes

def parse_footnotes(soup):
    notes = {}
    for p in soup.find_all("p", class_="footnote"):
        a = p.find("a", id=True)
        m = re.search(r"(\d+)", a.get("id", "")) if a else None
        text = norm_ws(p.get_text())
        m2 = re.match(r"^\(\s*(\d+)\s*\)\s*(.*)$", text)
        if m2:
            notes[m2.group(1)] = m2.group(2)
        elif m:
            notes[m.group(1)] = text
    return notes


# ------------------------------------------------------------------ walking

def art_sort_key(label):
    """'4a' sorts immediately after '4'."""
    m = re.match(r"^(\d+)([a-z]*)$", label)
    if not m:
        return (999, "")
    return (int(m.group(1)), m.group(2))


def parse_consolidated(path=SRC):
    with open(path, encoding="utf-8", errors="replace") as fh:
        soup = BeautifulSoup(fh.read(), "html.parser")

    footnotes = parse_footnotes(soup)
    state = [{"mark": "B", "celex": "32024R1689", "op": ""}]

    articles, chapters, annexes = [], [], []
    chapter, section = None, None

    # Walk the document once, in order, so the ▼ markers and the headings that
    # scope each article are both picked up as we go.
    body = soup.find("body") or soup
    for el in body.find_all(["p", "div"]):
        st = marker_state(el)
        if st:
            state[0] = st
            continue

        cls = set(el.get("class") or [])

        if "title-division-1" in cls:
            label = norm_ws(el.get_text())
            title_p = el.find_next("p", class_="title-division-2")
            title = smart_title(norm_ws(title_p.get_text())) if title_p else ""
            if label.upper().startswith("CHAPTER"):
                roman = label.split()[-1]
                chapter = {
                    "id": "cpt_" + roman, "roman": roman,
                    "num": ROMAN.get(roman, 0),
                    "label": "Chapter " + roman, "title": title,
                }
                chapters.append(chapter)
                section = None
            elif label.upper().startswith("SECTION"):
                section = {"label": "Section " + label.split()[-1],
                           "num": label.split()[-1], "title": title}
            continue

        eid = el.get("id") or ""

        if re.match(r"^art_[0-9]+[a-z]*$", eid):
            art = read_article(el, eid, footnotes, state, chapter, section)
            if art:
                articles.append(art)
            continue

        if re.match(r"^anx_%s$" % ROMAN_RE, eid):
            anx = read_annex(el, eid, footnotes, state)
            if anx:
                annexes.append(anx)
            continue

    articles.sort(key=lambda a: art_sort_key(a["key"]))
    annexes.sort(key=lambda a: a["num"])

    definitions = read_definitions(articles, soup, footnotes, state)

    return {
        "articles": articles,
        "annexes": annexes,
        "definitions": definitions,
        "chapters": chapters,
        "footnotes": footnotes,
    }


def read_article(div, eid, footnotes, state, chapter, section):
    num_p = div.find("p", class_="title-article-norm")
    if not num_p:
        return None
    label = norm_ws(num_p.get_text())
    m = re.search(r"(\d+\s*[a-z]?)", label)
    if not m:
        return None
    key = re.sub(r"\s+", "", m.group(1))

    title_p = div.find("p", class_="stitle-article-norm")
    # EUR-Lex carries a stray quote on Article 1's heading in both exports.
    title = norm_ws(title_p.get_text()).rstrip("`'’\" ") if title_p else ""

    entry_state = dict(state[0])
    r = Renderer(footnotes, state)
    html = r.blocks(div)
    text = plain_text(html)

    # An article whose own marker says INSERTED is new; otherwise it is amended
    # if any block inside it carries a change marker.
    changes = r.seen
    if entry_state.get("mark") == "M1" and entry_state.get("op") == "inserted":
        status = "inserted"
    elif changes or (entry_state.get("mark") == "M1" and entry_state.get("op")):
        status = "amended"
    else:
        status = None

    num = int(re.match(r"(\d+)", key).group(1))
    return {
        "id": "art_" + key,
        "type": "article",
        "key": key,
        "num": num,
        "suffix": key[len(str(num)):],
        "label": "Article " + key,
        "title": title,
        "chapter": chapter["roman"] if chapter else None,
        "chapterLabel": chapter["label"] if chapter else None,
        "chapterTitle": chapter["title"] if chapter else None,
        "section": section["num"] if section else None,
        "sectionLabel": section["label"] if section else None,
        "sectionTitle": section["title"] if section else None,
        "html": html,
        "text": text,
        "words": len(text.split()),
        "status": status,
    }


def read_annex(div, eid, footnotes, state):
    roman = eid.split("_", 1)[1]
    titles = div.find_all("p", class_=re.compile(r"title-annex-[12]"))
    title = ""
    for t in titles:
        txt = norm_ws(t.get_text())
        if not re.match(r"^ANNEX\b", txt, re.I):
            title = txt
            break
    if not title:
        # Annex XIV, added in 2026, states its subject in a plain paragraph
        # instead of a second heading.
        head = div.find("p", class_="title-annex-1")
        first = head.find_next("p", class_="norm") if head else None
        if first is not None:
            title = norm_ws(first.get_text())

    entry_state = dict(state[0])
    r = Renderer(footnotes, state)
    html = r.blocks(div)
    text = plain_text(html)

    if entry_state.get("mark") == "M1" and entry_state.get("op") == "inserted":
        status = "inserted"
    elif r.seen or (entry_state.get("mark") == "M1" and entry_state.get("op")):
        status = "amended"
    else:
        status = None

    return {
        "id": "anx_" + roman,
        "type": "annex",
        "num": ROMAN.get(roman, 0),
        "roman": roman,
        "label": "Annex " + roman,
        "title": smart_title(title) if title.isupper() else title,
        "html": html,
        "text": text,
        "words": len(text.split()),
        "status": status,
    }


def read_definitions(articles, soup, footnotes, state):
    """Article 3 defines the terms; each becomes its own node."""
    art3 = next((a for a in articles if a["key"] == "3"), None)
    if not art3:
        return []

    defs = []
    frag = BeautifulSoup(art3["html"], "html.parser")
    for pt in frag.find_all("div", class_="point"):
        marker = norm_ws(pt.find("span", class_="point-marker").get_text())
        m = re.match(r"^\((\d+)\)$", marker)
        if not m:
            continue
        idx = int(m.group(1))
        body = pt.find("div", class_="point-body")
        body_html = body.decode_contents() if body else ""
        text = plain_text(body_html)
        dm = DEF_RE.match(text) or re.match(
            r"^[‘'\"]?([^’'\";]{2,80}?)[’'\"]?\s+means\b", text)
        if not dm:
            continue
        term = norm_ws(dm.group(1))
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
            "status": "amended" if pt.get("data-chg") else None,
        })
    return defs


if __name__ == "__main__":
    doc = parse_consolidated()
    print("articles   %d" % len(doc["articles"]))
    print("annexes    %d" % len(doc["annexes"]))
    print("definitions%4d" % len(doc["definitions"]))
    print("chapters   %d" % len(doc["chapters"]))
    print("footnotes  %d" % len(doc["footnotes"]))
    for k in ("inserted", "amended"):
        n = [a["label"] for a in doc["articles"] if a["status"] == k]
        print("%-9s %d  %s" % (k, len(n), ", ".join(n[:12])))
