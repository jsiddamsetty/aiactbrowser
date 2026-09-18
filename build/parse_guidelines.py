#!/usr/bin/env python3
"""
Parse the Commission guidelines that interpret the Act into guidance nodes.

Three PDFs, two logical documents:

    pp  Guidelines on prohibited AI practices (Article 5) —
        C(2025) 5052 final, adopted 29 July 2025
    hr  Draft guidelines on the classification of high-risk AI systems
        (Article 6) — published for stakeholder consultation, in two parts:
        general principles, and the Annex III use cases

A PDF carries no semantic markup, so structure is recovered from typography:
body text is 11-12pt regular, section headings the same size in bold,
footnote text 10pt, footnote markers smaller still. Words are re-spaced from
glyph positions using each font's /Widths table, because the extractor's own
guesses split and glue words. Anything the classifier cannot place is folded
into the running paragraph, and build.py checks the totals loudly.

Each numbered section that carries body text becomes one node
(type "guidance"), keyed the way the Commission itself cites it — "2.7.1",
"9.3.2" — so a section here can be quoted by number.
"""

import os
import re

from pypdf import PdfReader

HERE = os.path.dirname(os.path.abspath(__file__))

SUP_O, SUP_C = "\x01", "\x02"
BOLD_O, BOLD_C = "\x03", "\x04"

# ------------------------------------------------------------------ documents

DOCS = [
    {
        "slug": "pp",
        "name": "Prohibited practices",
        "label": "Prohibitions",
        "title": "Guidelines on prohibited AI practices",
        "cite": "C(2025) 5052 final · adopted 29 July 2025",
        "draft": False,
        "short": "Proh.",
        "authority": "Commission",
        "files": [
            {"file": "source-guidelines-prohibited.pdf", "skip": set()},
        ],
    },
    {
        "slug": "hr",
        "name": "High-risk classification",
        "label": "High-risk",
        "title": "Draft guidelines on the classification of high-risk AI systems",
        "cite": "draft for stakeholder consultation, 2026 · not yet adopted",
        "draft": True,
        "short": "HR",
        "authority": "Commission",
        "files": [
            # V and VI (entry into application, review) carry their real
            # text here; III and IV point to the Annex III part. Its "1." and
            # "2." are subsections of II, so they are renumbered II.1, II.2
            # to keep them from colliding with the Annex III part's sections.
            {"file": "source-guidelines-highrisk-principles.pdf",
             "skip": {"III", "IV"}, "decimal_prefix": "II."},
            # I, II, V, VI here are placeholders or duplicates of the
            # general-principles part; IV is a one-sentence bridge.
            {"file": "source-guidelines-highrisk-annex3.pdf",
             "skip": {"I", "II", "III", "IV", "V", "VI"}},
        ],
    },
]

# Reading order inside the merged high-risk document: the general principles
# open it, the Annex III sections follow, timing and review close it.
HR_ORDER = {"I": 0, "II": 1, "II.1": 2, "II.2": 3, "V": 900, "VI": 901}

# ------------------------------------------------------------------ rail parts

PART_RULES = {
    "pp": [
        ("3", "Manipulation & exploitation · 5(1)(a)-(b)"),
        ("4", "Social scoring · 5(1)(c)"),
        ("5", "Crime prediction · 5(1)(d)"),
        ("6", "Facial-image scraping · 5(1)(e)"),
        ("7", "Emotion recognition · 5(1)(f)"),
        ("8", "Biometric categorisation · 5(1)(g)"),
        ("9", "Real-time RBI · 5(1)(h)"),
        ("10", "RBI safeguards · 5(2)-(7)"),
        ("11", "Timing & review"),
        ("12", "Timing & review"),
        ("", "Scope & enforcement"),
    ],
    "hr": [
        ("I", "General principles"),
        ("II", "General principles"),
        ("V", "Timing & review"),
        ("VI", "Timing & review"),
        ("2.7", "The Article 6(3) filter"),
        ("3.1", "Biometrics · Annex III 1"),
        ("3.2", "Critical infrastructure · Annex III 2"),
        ("3.3", "Education · Annex III 3"),
        ("3.4", "Employment · Annex III 4"),
        ("3.5", "Essential services · Annex III 5"),
        ("3.6", "Law enforcement · Annex III 6"),
        ("3.7", "Migration & borders · Annex III 7"),
        ("3.8", "Justice & democracy · Annex III 8"),
        ("", "Approach & horizontal issues"),
    ],
}


def part_of(slug, sec):
    for pref, name in PART_RULES[slug]:
        if not pref or sec == pref or sec.startswith(pref + "."):
            return name
    return ""


# What each section is *about* — the editorial layer on top of the literal
# citations derived from the text. "term:x" resolves against Article 3 at
# build time so definition renumbering cannot silently break it.
TARGETS = {
    "pp:": ["art_5"],
    "pp:2.3": ["art_5", "term:placing on the market", "term:putting into service"],
    "pp:2.5": ["art_5", "art_2"],
    "pp:2.6": ["art_5", "art_6"],
    "pp:2.7": ["art_5", "term:general-purpose AI system"],
    "pp:2.9": ["art_5", "art_74", "art_99"],
    "pp:5": ["art_5", "term:profiling"],
    "pp:7": ["art_5", "term:emotion recognition system"],
    "pp:8": ["art_5", "term:biometric categorisation system", "term:biometric data"],
    "pp:9": ["art_5", "term:remote biometric identification system",
             "term:publicly accessible space", "term:law enforcement"],
    "pp:10.1.1": ["art_5", "art_27"],
    "pp:10.1.2": ["art_5", "art_49"],
    "pp:11": ["art_113"],
    "pp:12": ["art_96"],
    "hr:": ["art_6"],
    "hr:I": ["art_6"],
    "hr:II": ["art_6", "term:AI system", "term:intended purpose"],
    "hr:V": ["art_111", "art_113"],
    "hr:VI": ["art_7", "art_112"],
    "hr:1": ["art_6", "anx_III"],
    "hr:2": ["art_6", "anx_III"],
    "hr:2.7": ["art_6"],
    "hr:2.7.2": ["art_6", "term:profiling"],
    "hr:3.1": ["anx_III"],
    "hr:3.1.2": ["anx_III", "term:remote biometric identification system"],
    "hr:3.1.3": ["anx_III", "term:biometric categorisation system"],
    "hr:3.1.4": ["anx_III", "term:emotion recognition system"],
    "hr:3.2": ["anx_III", "term:critical infrastructure"],
    "hr:3.3": ["anx_III"],
    "hr:3.4": ["anx_III"],
    "hr:3.5": ["anx_III"],
    "hr:3.6": ["anx_III", "term:law enforcement"],
    "hr:3.7": ["anx_III"],
    "hr:3.8": ["anx_III"],
}


def targets_for(slug, sec):
    match, match_len = [], -1
    for key, val in TARGETS.items():
        doc, pref = key.split(":", 1)
        if doc != slug:
            continue
        if pref == "" or sec == pref or sec.startswith(pref + "."):
            if len(pref) > match_len:
                match, match_len = val, len(pref)
    return match


# ------------------------------------------------------------------ extraction

FOOT_MIN, FOOT_MAX = 9.4, 10.4   # 10pt footnote text; below that, superscripts
BODY_MIN = 10.5


# Typographic characters sit outside the /Widths range once decoded to
# Unicode; nominal Times widths keep the gap arithmetic honest for them.
EXTRA_W = {"‘": 333, "’": 333, "“": 444, "”": 444, "–": 500, "—": 1000,
           "…": 1000, " ": 250, "·": 310, "•": 350}


def _char_width(c, widths, first, size):
    i = ord(c) - first
    if widths is not None and 0 <= i < len(widths) and widths[i] > 0:
        return widths[i] / 1000.0 * size
    return EXTRA_W.get(c, 500) / 1000.0 * size


def _runs_of(page):
    """Every text op as (x, y, size, bold, width, text)."""
    runs = []

    def visit(text, cm, tm, font_dict, font_size):
        if not text or not text.strip():
            return
        font, widths, first = "", None, 32
        if font_dict:
            font = str(font_dict.get("/BaseFont", ""))
            try:
                widths = [float(w) for w in font_dict["/Widths"]]
                first = int(font_dict.get("/FirstChar", 32))
            except Exception:
                widths = None
        # Text in a positioned box carries local coordinates; composing the
        # text matrix with the current transform puts every run on the page.
        x = cm[0] * tm[4] + cm[2] * tm[5] + cm[4]
        y = cm[1] * tm[4] + cm[3] * tm[5] + cm[5]
        scale = abs(cm[3] if cm[3] else 1.0) * abs(tm[3] if tm[3] else 1.0)
        size = abs(font_size) * (scale or 1.0)
        w = sum(_char_width(c, widths, first, size) for c in text)
        if abs(x) < 1.0 and abs(y) < 1.0:
            # The extractor flushes some runs after the text matrix has been
            # reset, losing their position; stream order still holds, so the
            # run belongs at the end of the one before it.
            if not runs:
                return
            px, py, psize, pbold, pw, ptext = runs[-1]
            x, y = px + pw, py
        runs.append((x, y, size, "Bold" in font, w, text))

    page.extract_text(visitor_text=visit)
    return runs


def _lines_of(page):
    """Cluster runs into visual lines; superscripts sit a few points above
    their baseline, so a 6pt tolerance folds them into the right line."""
    runs = sorted(_runs_of(page), key=lambda r: (-r[1], r[0]))
    lines, cur, base_y = [], [], None
    for r in runs:
        # Anchored to the line's first (highest) baseline rather than chained
        # run-to-run: chaining lets tightly spaced lines snowball into one.
        if base_y is None or base_y - r[1] <= 6.0:
            cur.append(r)
            if base_y is None:
                base_y = r[1]
        else:
            lines.append(sorted(cur, key=lambda q: q[0]))
            cur, base_y = [r], r[1]
    if cur:
        lines.append(sorted(cur, key=lambda q: q[0]))
    return lines


def _join(parts):
    """Concatenate runs, inserting a space where the glyph gap says one was."""
    out = []
    prev_end = None
    prev_size = None
    for x, y, size, bold, w, text in parts:
        if prev_end is not None:
            gap = x - prev_end
            if gap > 0.12 * max(size, prev_size) and \
                    not (out and out[-1].endswith(" ")) and not text.startswith(" "):
                out.append(" ")
        out.append(text)
        prev_end, prev_size = x + w, size
    return "".join(out)


# The extractor sometimes drops a stray space inside a word ("A rticle",
# "Anne x"). Repairing every word is not safe; repairing the reference
# vocabulary is, and it is what the cross-reference linker depends on.
KEYWORDS = ["Article", "Articles", "Annex", "Annexes", "Recital", "Recitals",
            "Regulation", "Directive", "Chapter", "Section", "paragraph"]
KEYWORD_RE = [(re.compile(r"\b" + r"\s?".join(kw) + r"\b"), kw)
              for kw in KEYWORDS]


def norm_text(t):
    t = re.sub(r"\s+", " ", t).strip()
    # spurious breaks inside hyphenated words: "high -risk", "sub- paragraph"
    t = re.sub(r"(\w) ?- ?(?=\w)", r"\1-", t)
    for pat, kw in KEYWORD_RE:
        t = pat.sub(kw, t)
    return t


class Line:
    __slots__ = ("text", "bold_frac", "sups", "x0")

    def __init__(self, runs):
        parts, sups = [], []
        for r in runs:
            x, y, size, bold, w, text = r
            if size < FOOT_MIN:
                n = text.strip()
                if n.isdigit():                      # footnote marker
                    sups.append(int(n))
                    parts.append((x, y, size, bold, w, SUP_O + n + SUP_C))
                else:                                # shrunk ordinary glyphs
                    parts.append(r)
                continue
            if bold:
                parts.append((x, y, size, bold, w, BOLD_O + text + BOLD_C))
            else:
                parts.append(r)
        self.text = norm_text(_join(parts))
        self.sups = sups
        self.x0 = min((r[0] for r in runs if r[2] >= FOOT_MIN),
                      default=runs[0][0] if runs else 0)
        bold_chars = sum(len(r[5]) for r in runs if r[3] and r[2] >= FOOT_MIN)
        chars = sum(len(r[5]) for r in runs if r[2] >= FOOT_MIN)
        self.bold_frac = bold_chars / chars if chars else 0.0

    def plain(self):
        return re.sub("[%s%s%s%s]" % (SUP_O, SUP_C, BOLD_O, BOLD_C), "",
                      re.sub("%s\\d+%s" % (SUP_O, SUP_C), "", self.text))


DOTTED = re.compile(r"\.{5,}\s*\d+\s*$")
TOC_ROW = re.compile(r"^((?:[IVX]{1,4}|\d{1,2}(?:\.\d{1,2}){0,3}))\.?\s*(.+?)"
                     r"\s*\.{5,}\s*\d+\s*$")


def read_pages(path):
    """(body_lines, footnotes, toc): body as Line objects, footnotes
    num -> text, and the document's own Contents as sec -> title — the
    canonical spelling of every section heading, free of the glyph
    misplacement that mangles a handful of headings in the body."""
    reader = PdfReader(path)
    body, footnotes, toc = [], {}, {}
    fn_current = None
    prev = ["", ""]      # the two preceding lines, for wrapped Contents rows

    for page in reader.pages:
        for runs in _lines_of(page):
            # Fragments composed to the far left margin are misplaced
            # glyph-subset runs; they duplicate text drawn elsewhere.
            runs = [r for r in runs if r[0] >= 30]
            if not runs:
                continue
            sizes = [r[2] for r in runs if r[2] >= FOOT_MIN]
            if not sizes:
                continue
            main = max(sizes)

            if main <= FOOT_MAX:                     # footnote text
                text = ""
                for x, y, size, bold, w, t in runs:
                    if size < FOOT_MIN and t.strip().isdigit():
                        fn_current = int(t.strip())
                        footnotes.setdefault(fn_current, "")
                    else:
                        text += t
                if fn_current is not None:
                    footnotes[fn_current] = norm_text(
                        footnotes[fn_current] + " " + text)
                continue

            line = Line(runs)
            plain = line.plain()
            if not plain or re.fullmatch(r"[\divxIVX]{1,4}", plain):
                continue                             # page number
            if DOTTED.search(plain) or plain in ("Contents", "CONTENTS"):
                # A row's title may wrap before the dot leader reaches it.
                for cand in (plain, prev[1] + " " + plain,
                             prev[0] + " " + prev[1] + " " + plain):
                    m = TOC_ROW.match(norm_text(cand))
                    if m:
                        toc.setdefault(m.group(1), m.group(2))
                        break
                prev = ["", ""]
                continue                             # table of contents
            if plain.startswith("EN ") or plain in ("EN", "ANNEX"):
                continue                             # cover furniture
            prev = [prev[1], plain]
            body.append(line)

    return body, footnotes, toc


# ------------------------------------------------------------------ structure

HEAD_ROMAN = re.compile(r"^([IVX]{1,4})\.\s*([A-Z‘'\"].*)$")
# A top-level number needs its dot ("3." not "3") — a stray bold digit glued
# to a bold phrase must not open a phantom section. Deeper numbers ("10.2.2.1")
# are unambiguous with or without it.
HEAD_DEC1 = re.compile(r"^(\d{1,2})\.\s+([A-Z‘'\"(].*)$")
HEAD_DECN = re.compile(r"^(\d{1,2}(?:\.\d{1,2}){1,3})\.?\s*([A-Z‘'\"(].*)$")
HEAD_LETTER = re.compile(r"^([a-e])\)\s+(.+)$")
PARA = re.compile(r"^\((\d{1,3})\)\s*(.*)$")
POINT = re.compile(r"^\(([a-z]{1,4})\)\s*(.*)$")
DASH = re.compile(r"^(?:[–—•]\s*|-\s+)(.+)$")
MINOR = re.compile(r"^[ivx]{1,4}\.\s+[A-Z].{4,}$")   # "iii. The scope of …"
EXAMPLE = re.compile(r"^(Examples?\s*:|For example\b|Practical examples?\b)")


def parse_events(body_lines):
    """Fold visual lines into structural events.

    Layout carries meaning the words alone do not: paragraph markers sit on
    the left margin, example blocks are set in from it, and sub-point markers
    further still — so each rule checks the line's indent as well as its text.
    """
    events = []
    pending = None       # a heading that may wrap onto the next line
    pending_h3 = None    # a lettered sub-heading that may wrap onto the next line
    seen_head = False
    discard = False      # inside a disclaimer box
    last_para = None
    last_roman = 0
    last_dec = ()

    ROMAN_VAL = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6,
                 "VII": 7, "VIII": 8, "IX": 9, "X": 10, "XI": 11, "XII": 12}

    def ascending(sec):
        """Sections only ever count upward; a bold numbered list item that
        would take the numbering backwards is body text, not a heading."""
        nonlocal last_roman, last_dec
        if sec in ROMAN_VAL:
            if ROMAN_VAL[sec] <= last_roman:
                return False
            last_roman = ROMAN_VAL[sec]
            return True
        parts = tuple(int(p) for p in sec.split("."))
        if last_dec and parts <= last_dec:
            return False
        last_dec = parts
        return True

    # The left margin is where the paragraph markers live.
    xs = [l.x0 for l in body_lines if PARA.match(l.plain())]
    margin = min(xs) if xs else 60.0

    def flush():
        nonlocal pending, pending_h3
        if pending:
            events.append(pending)
            pending = None
        if pending_h3:
            events.append(("h3", pending_h3[0]))
            pending_h3 = None

    for line in body_lines:
        text, plain = line.text, line.plain()

        # Lettered sub-headings are sometimes wrapped with their continuation
        # set further to the right.  Keep the first line pending so the
        # continuation does not become an orphaned body paragraph.
        if pending_h3:
            heading, heading_x = pending_h3
            if line.bold_frac > 0.6 and line.x0 > heading_x + 5:
                events.append(("h3", norm_text(heading + " " + plain)))
                pending_h3 = None
                continue
            flush()

        if line.bold_frac > 0.6 and not PARA.match(plain):
            m = HEAD_ROMAN.match(plain) or HEAD_DEC1.match(plain) or \
                HEAD_DECN.match(plain)
            if m and ascending(m.group(1)):
                flush()
                pending = ("head", m.group(1), m.group(2).strip())
                seen_head, discard = True, False
                continue
            m = HEAD_LETTER.match(plain)
            if m and seen_head:
                flush()
                pending_h3 = (plain, line.x0)
                discard = False
                continue
            if pending:                              # wrapped heading line
                pending = ("head", pending[1],
                           norm_text(pending[2] + " " + plain))
                continue

        just_after_head = pending is not None or \
            (events and events[-1][0] == "head")
        flush()
        if not seen_head:
            continue                                 # cover pages

        if plain.startswith("Disclaimer:"):
            discard = True
            continue

        m = PARA.match(text)
        # Paragraph numbers run consecutively through a document; "(1)" in a
        # quoted provision at the start of a wrapped line is not paragraph 1.
        if m and (last_para is None or int(m.group(1)) == last_para + 1 or
                  just_after_head):
            discard = False
            last_para = int(m.group(1))
            events.append(("para", last_para))
            if m.group(2):
                events.append(("p", m.group(2)))
            continue
        if discard:
            continue
        m = DASH.match(text)
        if m:
            events.append(("dash", m.group(1)))
            continue
        m = POINT.match(text)
        if m and line.x0 < margin + 55:
            events.append(("point", m.group(1), m.group(2)))
            continue
        if MINOR.match(plain) and line.x0 < margin + 45:
            events.append(("h3", plain))
            continue
        if EXAMPLE.match(re.sub("^[%s]\\d+[%s]" % (SUP_O, SUP_C), "", text)) \
                and margin + 6 < line.x0 < margin + 22:
            events.append(("ex", text))
            continue
        events.append(("cont", text))

    flush()
    return events


# ------------------------------------------------------------------ rendering

def esc(t):
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def inline(t, footnotes):
    t = esc(t)
    t = re.sub(
        "%s(\\d+)%s" % (SUP_O, SUP_C),
        lambda m: '<sup class="fn" title="%s">%s</sup>' % (
            esc(footnotes.get(int(m.group(1)), "")).replace('"', "&quot;"),
            m.group(1)),
        t)
    t = t.replace(BOLD_O, "<b>").replace(BOLD_C, "</b>")
    t = t.replace("</b> <b>", " ").replace("</b><b>", "")
    return t


def plain(t):
    t = re.sub("%s\\d+%s" % (SUP_O, SUP_C), "", t)
    return t.replace(BOLD_O, "").replace(BOLD_C, "")


def chunk_html(c, footnotes):
    if c[0] == "p":
        return '<p class="doc-p">%s</p>' % inline(c[1], footnotes)
    if c[0] == "ex":
        return '<div class="gl-ex"><p class="doc-p">%s</p></div>' % inline(c[1], footnotes)
    if c[0] == "list":
        return '<ul class="gl-list">%s</ul>' % "".join(
            "<li>%s</li>" % inline(i, footnotes) for i in c[1])
    if c[0] == "points":
        return "".join(
            '<div class="point"><span class="point-marker">(%s)</span>'
            '<div class="point-body"><p class="doc-p">%s</p></div></div>'
            % (m, inline(t, footnotes)) for m, t in c[1])
    return ""


class Section:
    def __init__(self, sec, title):
        self.sec = sec
        self.title = title
        self.blocks = []
        self.paras = []

    def html(self, footnotes):
        out = []
        for b in self.blocks:
            if b[0] == "h3":
                out.append('<h3 class="gl-h3">%s</h3>' % inline(b[1], footnotes))
            else:
                chunks = b[2] if b[0] == "para" else b[1]
                inner = "".join(chunk_html(c, footnotes) for c in chunks)
                if b[0] == "para":
                    out.append(
                        '<div class="para gpara" id="g%d">'
                        '<span class="gnum">(%d)</span>'
                        '<div class="gbody">%s</div></div>' % (b[1], b[1], inner))
                else:
                    out.append(inner)
        return "".join(out)

    def text(self):
        bits = []
        for b in self.blocks:
            if b[0] == "h3":
                bits.append(plain(b[1]))
            else:
                for c in (b[2] if b[0] == "para" else b[1]):
                    if c[0] in ("p", "ex"):
                        bits.append(plain(c[1]))
                    elif c[0] == "list":
                        bits.extend(plain(i) for i in c[1])
                    elif c[0] == "points":
                        bits.extend(plain(t) for m, t in c[1])
        return norm_text(" ".join(bits))


def build_sections(events, skip):
    sections, cur, chunks = [], None, None
    skipping = False

    def open_chunks(para_num=None):
        nonlocal chunks
        chunks = []
        if cur is None:
            return
        if para_num is not None:
            cur.blocks.append(("para", para_num, chunks))
            cur.paras.append(para_num)
        else:
            cur.blocks.append(("loose", chunks))

    for ev in events:
        kind = ev[0]

        if kind == "head":
            sec, title = ev[1], ev[2]
            skipping = sec.split(".")[0] in skip or sec in skip
            if skipping:
                cur, chunks = None, None
            else:
                cur = Section(sec, title)
                sections.append(cur)
                chunks = None
            continue
        if skipping or cur is None:
            continue

        if kind == "h3":
            cur.blocks.append(("h3", ev[1]))
            chunks = None
        elif kind == "para":
            open_chunks(ev[1])
        elif kind in ("p", "ex"):
            if chunks is None:
                open_chunks()
            chunks.append((kind, ev[1]))
        elif kind == "dash":
            if chunks is None:
                open_chunks()
            if not chunks or chunks[-1][0] != "list":
                chunks.append(("list", []))
            chunks[-1][1].append(ev[1])
        elif kind == "point":
            if chunks is None:
                open_chunks()
            if not chunks or chunks[-1][0] != "points":
                chunks.append(("points", []))
            chunks[-1][1].append((ev[1], ev[2]))
        elif kind == "cont":
            if chunks is None:
                open_chunks()
            if not chunks:
                chunks.append(("p", ev[1]))
            elif chunks[-1][0] == "list":
                chunks[-1][1][-1] = norm_text(chunks[-1][1][-1] + " " + ev[1])
            elif chunks[-1][0] == "points":
                m, t = chunks[-1][1][-1]
                chunks[-1][1][-1] = (m, norm_text(t + " " + ev[1]))
            else:
                chunks[-1] = (chunks[-1][0], norm_text(chunks[-1][1] + " " + ev[1]))

    return [s for s in sections if s.blocks]


# ---------------------------------------------------------------------- titles

KEEP_CAPS = {"AI", "RBI", "EU", "CCTV", "GDPR", "GPAI", "I", "II", "III",
             "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV"}
RECASE = {"ACT": "Act", "ACT:": "Act:", "ACT.": "Act.",
          "COMMISSION": "Commission"}


def fix_title(t):
    """Headings set in caps come back in sentence case; initialisms survive."""
    out = []
    for i, w in enumerate(t.split()):
        if w in KEEP_CAPS or not w.isupper() or len(w) < 2:
            out.append(w)
        elif w in RECASE:
            out.append(RECASE[w])
        elif i == 0:
            out.append(w.capitalize())
        else:
            out.append(w.lower())
    return " ".join(out)


def sec_sort(slug, sec):
    if slug == "hr" and sec in HR_ORDER:
        return (HR_ORDER[sec],)
    try:
        return (100,) + tuple(int(p) for p in sec.split("."))
    except ValueError:
        return (500, sec)


# ---------------------------------------------------------------------- driver

def parse_guidelines():
    """(nodes, docs): guidance nodes in reading order, plus doc metadata."""
    nodes = []

    for doc in DOCS:
        doc_sections = []
        for f in doc["files"]:
            body, footnotes, toc = read_pages(os.path.join(HERE, f["file"]))
            sections = build_sections(parse_events(body), f["skip"])
            prefix = f.get("decimal_prefix")
            for s in sections:
                # The Contents spelling of the heading is authoritative.
                if s.sec in toc:
                    s.title = toc[s.sec]
                if prefix and s.sec[0].isdigit():
                    s.sec = prefix + s.sec
            doc_sections.extend((s, footnotes) for s in sections)

        doc_sections.sort(key=lambda sf: sec_sort(doc["slug"], sf[0].sec))

        for s, footnotes in doc_sections:
            text = s.text()
            if len(text.split()) < 20:
                continue      # a bridge sentence, not a section
            if doc["slug"] == "hr" and s.sec == "3":
                continue      # umbrella intro to the Annex III areas
            nodes.append({
                "id": "gdl_%s-%s" % (doc["slug"], s.sec),
                "type": "guidance",
                "doc": doc["slug"],
                "docName": doc["name"],
                "draft": doc["draft"],
                "sec": s.sec,
                "label": "%s § %s" % (doc["label"], s.sec),
                "title": fix_title(s.title),
                "part": part_of(doc["slug"], s.sec),
                "paras": [min(s.paras), max(s.paras)] if s.paras else None,
                "html": s.html(footnotes),
                "text": text,
                "words": len(text.split()),
                "targets": targets_for(doc["slug"], s.sec),
                "status": None,
            })

    for i, n in enumerate(nodes):
        n["num"] = i + 1

    docs_meta = [{k: d[k] for k in ("slug", "name", "title", "cite", "draft", "short", "authority")}
                 for d in DOCS]
    return nodes, docs_meta


if __name__ == "__main__":
    ns, docs = parse_guidelines()
    print("%d guidance sections" % len(ns))
    for n in ns:
        rng = "%d-%d" % tuple(n["paras"]) if n["paras"] else "-"
        print("%-3s %-8s %-52s %9s %6dw  %s" % (
            n["doc"], n["sec"], n["title"][:52], rng, n["words"],
            ",".join(t for t in n["targets"] if not t.startswith("term"))))
