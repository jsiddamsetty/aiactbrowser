#!/usr/bin/env python3
"""
Parse the KI-MIG — Gesetz zur Marktüberwachung und Innovationsförderung von
künstlicher Intelligenz (BGBl. 2026 I Nr. 223) — from the gesetze-im-internet.de
"gii-norm" XML export (source-kimig.xml).

The KI-MIG is the German implementing law for Regulation (EU) 2024/1689: it
designates the market surveillance authorities, the notifying authority, the
regulatory sandbox operator and the fines that give the Act effect in Germany.
Its 20 sections (§§) become `kimig_*` nodes; its citations of the Act —
"Artikel 70 Absatz 1 Satz 1 der Verordnung (EU) 2024/1689" — become ordinary
`cites` edges into the Act, and links in the rendered text.

Reference resolution is the delicate part. The law cites, in the same breath,
the Act, other EU regulations (2019/1020, 2024/2847, 2016/679, …) and a long
tail of German statutes (Kreditwesengesetz, Bundesdatenschutzgesetz, Gesetz
über Ordnungswidrigkeiten …). A citation only links when it resolves to the
Act itself or to the KI-MIG:

  - "Artikel N … der Verordnung (EU) 2024/1689"        -> art_N
  - "Artikel 3 Nummer N der Verordnung (EU) 2024/1689" -> def_N (the term)
  - "Anhang III Nummer 1 der Verordnung (EU) 2024/1689" -> anx_III
  - "entgegen Artikel N …" with no instrument named    -> art_N  (the § 15
    fine catalogue, whose lead-in names the Regulation once for the list)
  - a bare "Anhang <roman>"                            -> anx_*  (the KI-MIG
    has no annexes of its own, so any Anhang is the Act's)
  - "§ N …" not followed by another statute's name     -> kimig_N
  - everything else — another instrument's name follows — stays plain text.

Edges and links come from the same spans, so the graph and the page agree.

    python3 build/parse_kimig.py     # prints what each section cites
"""

import html
import json
import os
import re
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "source-kimig.xml")

META = {
    "slug": "kimig",
    "abbr": "KI-MIG",
    "title": "Gesetz zur Marktüberwachung und Innovationsförderung "
             "von künstlicher Intelligenz",
    "shortTitle": "KI-Marktüberwachungs- und Innovationsförderungs-Gesetz",
    "cite": "BGBl. 2026 I Nr. 223",
    "adopted": "22 July 2026",
    "inForce": "29 July 2026",
    "language": "de",
    "sourceUrl": "https://www.gesetze-im-internet.de/ki-mig/",
}

# The § 15 fines bite on the Act as first published, not as amended in 2026.
PINNED_RE = re.compile(r"in der Fassung vom 13\. Juni 2024")

ROUTE = {"art": "article", "anx": "annex", "def": "term", "kimig": "kimig"}
TYPE = {"art": "article", "anx": "annex", "def": "definition", "kimig": "kimig"}


def norm_ws(s):
    return re.sub(r"\s+", " ", s or "").strip()


def esc(s):
    return html.escape(s, quote=False)


# ------------------------------------------------------------------ structure

def parse_kimig():
    """-> (sections, parts, META) — sections are graph nodes, parts the TOC.

    Each section carries a transient `refs` list (every node its text cites,
    in order); kimig_edges() consumes it.
    """
    root = ET.parse(SRC).getroot()

    sections, parts = [], []
    part = sub = None

    for norm in root.findall("norm"):
        md = norm.find("metadaten")
        gl = md.find("gliederungseinheit")
        if gl is not None:
            bez = norm_ws(gl.findtext("gliederungsbez"))
            titel = norm_ws(gl.findtext("gliederungstitel"))
            if bez.startswith("Teil"):
                part = {"label": bez, "title": titel,
                        "num": int(bez.split()[-1]), "subs": []}
                parts.append(part)
                sub = None
            else:                       # Abschnitt, nested inside the Teil
                sub = {"label": bez, "title": titel}
                if part:
                    part["subs"].append(sub)
            continue

        enbez = norm_ws(md.findtext("enbez"))
        m = re.match(r"^§\s*(\d+[a-z]?)$", enbez)
        if not m:
            continue                    # the document header norm
        key = m.group(1)
        sid = "kimig_" + key

        refs = []
        body, text = content_html(norm.find("textdaten/text/Content"), sid, refs)

        node = {
            "id": sid,
            "type": "kimig",
            "num": int(re.match(r"\d+", key).group(0)),
            "key": key,
            "label": "KI-MIG § " + key,
            "title": norm_ws(md.findtext("titel")),
            "part": part["label"] if part else None,
            "partTitle": part["title"] if part else None,
            "sub": sub["label"] if sub else None,
            "subTitle": sub["title"] if sub else None,
            "html": body,
            "text": text,
            "words": len(text.split()),
            "refs": refs,
        }
        if PINNED_RE.search(text):
            node["pinned"] = "13 June 2024"
        sections.append(node)

    return sections, parts, META


PARA_MARK = re.compile(r"^\s*\((\d+[a-z]?)\)\s*")


def content_html(content, self_id, refs):
    """A norm's Content -> (html, plain text), in the site's article markup."""
    if content is None:
        return "", ""
    out = []
    for i, p in enumerate(content.findall("P"), 1):
        m = PARA_MARK.match(p.text or "")
        n = m.group(1) if m else str(i)
        marker = '<span class="para-n">(%s)</span> ' % n if m else ""
        inner = render_flow(p, 0, self_id, refs,
                            skip=m.end() if m else 0, marker=marker)
        out.append('<section class="para" id="p%s" data-para="%s">%s</section>'
                   % (n, n, inner))
    return "".join(out), norm_ws(" ".join(content.itertext()))


def render_flow(el, depth, self_id, refs, skip=0, marker=""):
    """P or LA content: running text interleaved with DL lists."""
    parts = []
    lead = [marker]

    def flush(buf):
        t = norm_ws("".join(buf))
        if t:
            parts.append('<p class="doc-p">%s%s</p>'
                         % (lead.pop() if lead else "", linkify(t, self_id, refs)))
        del buf[:]

    buf = [(el.text or "")[skip:]]
    for child in el:
        if child.tag == "DL":
            flush(buf)
            parts.append(render_dl(child, depth, self_id, refs))
        else:                            # BR and other inline noise
            buf.append(" ".join(child.itertext()))
        buf.append(child.tail or "")
    flush(buf)
    return "".join(parts)


def render_dl(dl, depth, self_id, refs):
    """DT/DD pairs -> the site's .point markup, nested lists indented."""
    cls = "point point-nested" if depth else "point"
    out, marker = [], ""
    for child in dl:
        if child.tag == "DT":
            marker = norm_ws("".join(child.itertext()))
        elif child.tag == "DD":
            body = "".join(render_flow(la, depth + 1, self_id, refs)
                           for la in child.findall("LA"))
            out.append('<div class="%s"><span class="point-marker">%s</span>'
                       '<div class="point-body">%s</div></div>'
                       % (cls, esc(marker), body))
            marker = ""
    return "".join(out)


# ------------------------------------------------------------------ citations

AIA = "2024/1689"

# What may sit between a citation head and the instrument that owns it:
# "Absatz 2 Buchstabe c und Absatz 13", "Nummer 1, 3, 4 oder 5",
# "in Verbindung mit Anhang III Nummer 1", "sowie Artikel 15 Absatz 1 und 5",
# "Artikel 79 Absatz 7 sowie nach Artikel 81 Absatz 2" …
_TAIL = (r"(?:\s+(?:Absatz|Absätze[ns]?|Satz|Sätze[ns]?|Nummer[n]?|"
         r"Buchstabe[ns]?|Doppelbuchstabe[ns]?|Halbsatz|Unterabsatz|"
         r"Abschnitt|in\s+Verbindung\s+mit|(?:sowie|und|oder)\s+(?:nach|gemäß)|"
         r"und|oder|bis|sowie|"
         r"Artikel[ns]?|Anh[aä]ng(?:e?s|en)?|erster|zweiter|"
         r"\d+[a-z]?|[a-z]\b|[ivx]+\b|[A-Z]\b)|\s*,)*")

CLUSTER_RE = re.compile(
    r"(?:entgegen\s+)?(?:de[snm]\s+)?"
    r"(?:Artikel[ns]?\s+\d+[a-z]?|Anh[aä]ng(?:e?s|en)?\s+[IVX]+\b)" + _TAIL)

INSTR_RE = re.compile(
    r"^\s+der\s+(?:Durchführungsverordnung|Delegierten\s+Verordnung|Verordnung)"
    r"\s+\((?:EU|EG)\)\s+(?:Nr\.\s*)?(\d{1,4}/\d{1,4})")

# A German statute's genitive right after the reference: "des Grundgesetzes",
# "der Abgabenordnung", "des Gesetzes über Ordnungswidrigkeiten" — external.
# ("dieses Gesetzes" is one word, so it never matches "des\s".)
LAW_RE = re.compile(r"^\s+(?:des|der)\s+[A-ZÄÖÜ][\wäöüß-]*")

ART_NUMS_RE = re.compile(
    r"Artikel[ns]?\s+(\d+[a-z]?)((?:\s*(?:,|und|oder|bis)\s*\d+[a-z]?)*)")
ANX_ROMANS_RE = re.compile(r"Anh[aä]ng(?:e?s|en)?\s+([IVX]+)\b")
LIST_NUM_RE = re.compile(r"(,|und|oder|bis)\s*(\d+[a-z]?)")
ABSATZ_RE = re.compile(r"\s+Absatz\s+(\d+)\b")
NUMMER_RE = re.compile(r"\s+Nummer\s+(\d+)\b")

PAR_RE = re.compile(r"(§§?\s*)(\d+[a-z]?)((?:\s*(?:,|und|oder|bis)\s*\d+[a-z]?)*)")
PAR_TAIL_RE = re.compile(
    r"(?:\s+(?:Absatz|Absätze[ns]?|Satz|Sätze[ns]?|Nummer[n]?|"
    r"Buchstabe[ns]?|Halbsatz|und|oder|bis|\d+[a-z]?|[a-z]\b)|\s*,)*")


def _list(first, rest, base):
    """The numbers after a head: '57' + ' und 58' -> link 58, target 58;
    '8' + ' bis 11' -> link 11, targets 9, 10, 11.  -> [(key, start, end|None)]"""
    out, prev = [], first
    for lm in LIST_NUM_RE.finditer(rest):
        op, nxt = lm.group(1), lm.group(2)
        if op == "bis" and prev.isdigit() and nxt.isdigit() \
                and int(prev) < int(nxt) <= int(prev) + 40:
            out.extend((str(k), None, None) for k in range(int(prev) + 1, int(nxt)))
        out.append((nxt, base + lm.start(2), base + lm.end(2)))
        prev = nxt
    return out


def resolve(text, self_id=None):
    """-> (spans, targets): spans are (start, end, node id, para|None) to link;
    targets every node cited, including the insides of 'bis' ranges."""
    spans, targets = [], []

    def hit(start, end, nid, para=None):
        targets.append(nid)
        if start is not None and nid != self_id:
            spans.append((start, end, nid, para))

    for m in CLUSTER_RE.finditer(text):
        span, rest = m.group(0), text[m.end():]
        im = INSTR_RE.match(rest)
        if im:
            if im.group(1) != AIA:
                continue                          # another EU instrument
        elif LAW_RE.match(rest):
            continue                              # a German statute's article
        elif not span.startswith("entgegen") and ART_NUMS_RE.search(span):
            continue    # a bare Artikel outside the § 15 fine catalogue
        base = m.start()

        for am in ART_NUMS_RE.finditer(span):
            first, s, e = am.group(1), base + am.start(), base + am.end(1)
            nm = NUMMER_RE.match(text, e) if first == "3" else None
            if nm and not am.group(2):
                hit(s, nm.end(), "def_" + nm.group(1))    # a defined term
                continue
            pm = ABSATZ_RE.match(text, e) if not am.group(2) else None
            if pm:
                hit(s, pm.end(), "art_" + first, "p" + pm.group(1))
            else:
                hit(s, e, "art_" + first)
            for key, ls, le in _list(first, am.group(2), base + am.start(2)):
                hit(ls, le, "art_" + key)

        for xm in ANX_ROMANS_RE.finditer(span):
            hit(base + xm.start(), base + xm.end(), "anx_" + xm.group(1))

    for m in PAR_RE.finditer(text):
        tail = PAR_TAIL_RE.match(text, m.end())
        if LAW_RE.match(text[tail.end():]):
            continue                              # another statute's §
        first = m.group(2)
        pm = ABSATZ_RE.match(text, m.end(2)) if not m.group(3) else None
        if pm:
            hit(m.start(), pm.end(), "kimig_" + first, "p" + pm.group(1))
        else:
            hit(m.start(), m.end(2), "kimig_" + first)
        for key, ls, le in _list(first, m.group(3), m.start(3)):
            hit(ls, le, "kimig_" + key)

    spans.sort()
    clean, last = [], -1
    for sp in spans:
        if sp[0] >= last:
            clean.append(sp)
            last = sp[1]
    return clean, targets


def href(nid, para=None):
    prefix, rest = nid.split("_", 1)
    return "#/%s/%s%s" % (ROUTE[prefix], rest, "/" + para if para else "")


def linkify(text, self_id, refs):
    """Plain text -> escaped HTML with the Act's provisions as .xref links."""
    spans, targets = resolve(text, self_id)
    refs.extend(targets)
    out, last = [], 0
    for s, e, nid, para in spans:
        out.append(esc(text[last:s]))
        out.append('<a class="xref" data-node="%s" data-type="%s" href="%s">%s</a>'
                   % (nid, TYPE[nid.split("_", 1)[0]], href(nid, para), esc(text[s:e])))
        last = e
    out.append(esc(text[last:]))
    return "".join(out)


def kimig_edges(sections, by_id):
    """Citation edges for the KI-MIG layer, deduplicated.

    Links in the text to anything by_id lacks would be dead, so they are
    reported here rather than discovered by a reader.
    """
    edges, seen = [], set()
    for s in sections:
        for dst in s.pop("refs", []):
            if dst not in by_id:
                print("WARN KI-MIG § %s cites %s, which is not in the corpus"
                      % (s["key"], dst))
                continue
            if dst == s["id"] or (s["id"], dst) in seen:
                continue
            seen.add((s["id"], dst))
            edges.append({"s": s["id"], "t": dst, "k": "cites", "w": 1})
    return edges


# ---------------------------------------------------------------- translation
#
# The English text is an unofficial translation kept alongside the parse, one
# file per section — translations/kimig-en/NN.html, an <h1> title and then
# the section body in the same markup as the German, links included — plus
# _parts.json for the law's title and its Teil/Abschnitt headings.
#
# The German stays the source of truth: edges come from resolving the German
# citations, and each translated body must carry exactly the German links and
# paragraph/point skeleton, or the section is served in German only.

TRANS_DIR = os.path.join(HERE, "translations", "kimig-en")

# Who produced the files in TRANS_DIR; shown to readers beside the English.
TRANSLATION = {
    "lang": "en",
    "by": "Claude Sonnet 5",
    "kind": "machine translation, not reviewed by a lawyer",
}

ANCHOR_RE = re.compile(r"<a\s[^>]*>")
ANCHOR_TEXT_RE = re.compile(r"<a\s[^>]*>(.*?)</a>", re.S)
PARA_ID_RE = re.compile(r'<section class="para" id="([^"]+)"')
MARKER_RE = re.compile(r'<span class="(point-marker|para-n)">(.*?)</span>')
TAG_RE = re.compile(r"</?([a-z0-9]+)[^>]*>")
H1_RE = re.compile(r"^\s*<h1>(.*?)</h1>\s*", re.S)
GERMAN_RE = re.compile(r"\b(?:der|die|das|und|des|oder|nicht|wird|werden|"
                       r"Absatz|Artikel|Anhang|Satz|gemäß)\b")


def html_text(body):
    return norm_ws(html.unescape(re.sub(r"<[^>]+>", " ", body)))


def check_translation(de_html, en_html):
    """-> (errors, warnings) for one section. Errors disqualify it."""
    errors, warnings = [], []

    de_a, en_a = sorted(ANCHOR_RE.findall(de_html)), sorted(ANCHOR_RE.findall(en_html))
    if de_a != en_a:
        lost = [a for a in set(de_a) if de_a.count(a) > en_a.count(a)]
        extra = [a for a in set(en_a) if en_a.count(a) > de_a.count(a)]
        errors.append("links differ — missing %s, unexpected %s" % (lost, extra))

    if PARA_ID_RE.findall(de_html) != PARA_ID_RE.findall(en_html):
        errors.append("paragraph ids differ: %s vs %s"
                      % (PARA_ID_RE.findall(de_html), PARA_ID_RE.findall(en_html)))
    if MARKER_RE.findall(de_html) != MARKER_RE.findall(en_html):
        errors.append("paragraph/point markers differ")

    for tag in ("section", "p", "div", "span", "a"):
        de_n = len(re.findall(r"<%s[\s>]" % tag, de_html))
        en_n = len(re.findall(r"<%s[\s>]" % tag, en_html))
        if tag != "p" and de_n != en_n:
            errors.append("<%s> count %d, expected %d" % (tag, en_n, de_n))
        opened = len(re.findall(r"<%s[\s>]" % tag, en_html))
        closed = en_html.count("</%s>" % tag)
        if opened != closed:
            errors.append("<%s> opened %d times, closed %d" % (tag, opened, closed))
    stray = {t for t in TAG_RE.findall(en_html)} - {"section", "p", "div", "span", "a"}
    if stray:
        errors.append("tags not in the German markup: %s" % sorted(stray))

    for t in ANCHOR_TEXT_RE.findall(en_html):
        if not t.strip() or re.search(r"Artikel|Absatz|Anhang|Nummer", t):
            errors.append("link text left untranslated: %r" % t)

    # German kept in parentheses beside an uncertain rendering is deliberate.
    running = re.sub(r"\([^()]*\)", " ", html_text(ANCHOR_TEXT_RE.sub(" ", en_html)))
    german = GERMAN_RE.findall(running)
    if len(german) > 3:
        warnings.append("reads partly German: %s" % " ".join(german[:10]))
    return errors, warnings


def read_translation(num):
    path = os.path.join(TRANS_DIR, "%02d.html" % num)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as fh:
        raw = fh.read()
    m = H1_RE.match(raw)
    if not m:
        return ("", raw.strip())
    return (norm_ws(html.unescape(m.group(1))), raw[m.end():].strip())


def apply_translation(sections, parts, meta, report=print):
    """Make English the primary text where a checked translation exists.

    The German moves to *De fields; a section without a usable translation
    keeps German as its only text and `lang: "de"`. -> count translated.
    """
    heads = {}
    ppath = os.path.join(TRANS_DIR, "_parts.json")
    if os.path.exists(ppath):
        with open(ppath, encoding="utf-8") as fh:
            heads = json.load(fh)

    law = heads.get("_law") or {}
    if law:
        meta["titleEn"] = law.get("title")
        meta["shortTitleEn"] = law.get("shortTitle")

    # Teil/Abschnitt headings, re-keyed on the sections that name them.
    rename = {}
    for p in parts:
        h = heads.get(p["label"]) or {}
        old = (p["label"], p["title"])
        if h.get("title"):
            p["labelDe"], p["titleDe"] = p["label"], p["title"]
            p["label"], p["title"] = "Part %d" % p["num"], h["title"]
        rename[old] = (p["label"], p["title"])
        for sub in p["subs"]:
            sh = (h.get("subs") or {}).get(sub["label"])
            sold = (old[0], sub["label"], sub["title"])
            if sh:
                sub["labelDe"], sub["titleDe"] = sub["label"], sub["title"]
                sub["label"] = "Division " + sub["label"].split()[-1]
                sub["title"] = sh
            rename[sold] = (sub["label"], sub["title"])

    done = 0
    for s in sections:
        pkey = (s["part"], s["partTitle"])
        skey = (s["part"], s["sub"], s["subTitle"])
        if s["sub"] and skey in rename:
            s["subDe"], s["subTitleDe"] = s["sub"], s["subTitle"]
            s["sub"], s["subTitle"] = rename[skey]
        if pkey in rename:
            s["partDe"], s["partTitleDe"] = s["part"], s["partTitle"]
            s["part"], s["partTitle"] = rename[pkey]

        tr = read_translation(s["num"])
        if tr is None:
            s["lang"] = "de"
            continue
        title, body = tr
        errors, warnings = check_translation(s["html"], body)
        if not title:
            errors.append("no <h1> title")
        for w in warnings:
            report("WARN KI-MIG § %s translation %s" % (s["key"], w))
        if errors:
            for e in errors:
                report("WARN KI-MIG § %s translation rejected: %s" % (s["key"], e))
            s["lang"] = "de"
            continue
        s["titleDe"], s["htmlDe"], s["textDe"] = s["title"], s["html"], s["text"]
        s["title"], s["html"] = title, body
        s["text"] = html_text(body)
        s["words"] = len(s["text"].split())
        s["lang"] = "en"
        done += 1
    if done:
        meta["translation"] = dict(TRANSLATION, sections=done)
    return done


if __name__ == "__main__":
    import sys
    sections, parts, meta = parse_kimig()
    if "--check" in sys.argv:
        # Validate the English translation files against the German parse.
        n = apply_translation(sections, parts, meta)
        missing = [s["key"] for s in sections if s["lang"] == "de"]
        print("%d of %d sections translated and valid" % (n, len(sections)))
        if missing:
            print("German only: §§ " + ", ".join(missing))
        sys.exit(0 if not missing else 1)
    print("%d sections in %d parts" % (len(sections), len(parts)))
    for s in sections:
        cited = sorted(set(r for r in s["refs"] if r != s["id"]))
        print("  § %-3s %-50s -> %s" % (s["key"], s["title"][:50],
                                        " ".join(cited) or "—"))
