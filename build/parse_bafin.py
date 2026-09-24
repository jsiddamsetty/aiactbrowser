#!/usr/bin/env python3
"""
Parse BaFin's Guidance on ICT Risks in the Use of AI at Financial Entities
(version of 23 January 2026, BaFin's English version) into guidance nodes.

The guidance is supervisory advice on applying DORA — Regulation (EU)
2022/2554 and its RTS on ICT risk management and on subcontracting — to AI
systems. It is not guidance on the AI Act: it cites the Act once, for the
definition of an AI system, and DORA on almost every line. So its sections
join the guidance layer (type "guidance", doc "bafin") with two differences
from the Commission guidelines:

  - a reference that names no act is not the Act's. "Article 8 of DORA" and
    "Article 6(5) sentences 1 and 2 of DORA" stay plain text; only a
    reference naming the AI Act links. Each node carries `act: None`, which
    build.guidance_edges and the page's linker both read;
  - what connects it to the Act is editorial, not interpretive. CONCORDANCE
    names the requirements of the Act a section's subject meets, each with
    its reason, as `concords` edges — never presented as citations.

The PDF's typography carries the structure: parts in 21pt Cambria ("II. ICT
risk management and AI"), sections in 13pt Cambria, body text in 11pt Segoe
UI, run-in heads in italic, footnotes in 8.5pt. Five pages set a DORA
article in a box in the left column (x≈99.5) with the running text wrapped
beside it (x≈300); the box is kept as a quotation after the paragraph it
sits beside. Figures 1 and 2 are written out next to the data.

    python3 build/parse_bafin.py     # prints the sections it found
"""

import html
import os
import re
from collections import namedtuple

from pypdf import PdfReader

from parse_guidelines import _char_width

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "source-bafin-ai.pdf")

DOC = {
    "slug": "bafin",
    "name": "ICT risks in AI",
    "short": "BaFin",
    "authority": "BaFin",
    "title": "Guidance on ICT Risks in the Use of AI at Financial Entities",
    "cite": "BaFin · version of 23 January 2026 · English version",
    "draft": False,
    "sourceUrl": "https://www.bafin.de/SharedDocs/Downloads/EN/Anlage/dl_Anlage_orientierungshilfe_IKT_Risiken_bei_KI_en.html?nn=161628",
}

# After the cover and contents (1–3); before the imprint and the index of
# abbreviations (32–35).
FIRST_PAGE, LAST_PAGE = 4, 31

# What each section's subject meets in the Act — editorial, and said so
# wherever it is shown. Most of these requirements bind high-risk AI systems
# only, while the guidance covers every AI system a financial entity runs.
CONCORDANCE = {
    "I": [
        ("art_74", "Written for the financial entities BaFin supervises. For AI systems "
                   "used by financial institutions, Article 74(6) makes the financial "
                   "supervisor the Act's market surveillance authority too."),
    ],
    "I.1": [
        ("term:AI system", "Starts from the Act's definition of an AI system (Article 3(1)), "
                           "then treats an AI system as ICT assets and infrastructure under "
                           "DORA."),
    ],
    "II.2": [
        ("art_4", "Training so that staff have AI knowledge suited to their role "
                  "(Article 13(6) DORA). The Act asks providers and deployers to ensure "
                  "the AI literacy of their staff."),
    ],
    "II.3": [
        ("art_17", "AI systems belong in the DORA ICT risk management framework. For "
                   "providers that are financial institutions, Article 17(4) deems most of "
                   "the Act's quality management system fulfilled by the internal-governance "
                   "rules of financial services law."),
    ],
    "III.2": [
        ("art_9", "Testing AI systems for their intended purpose, scaled to criticality. "
                  "The Act requires high-risk AI systems to be tested against prior defined "
                  "metrics (Article 9(6)–(8))."),
        ("art_15", "Adversarial testing with data poisoning and evasion attacks. Article "
                   "15(5) requires high-risk AI systems to withstand these attacks."),
    ],
    "IV.1": [
        ("art_12", "Logging AI decisions, model versions and training data. The Act requires "
                   "high-risk AI systems to record events automatically."),
        ("art_26", "Monitoring AI systems in operation and keeping their logs. Article "
                   "26(5)–(6) sets these duties for deployers, and treats a financial "
                   "institution's governance rules and documentation as meeting them."),
    ],
    "V.1": [
        ("art_15", "Defence against adversarial attacks and data set manipulation. Article "
                   "15(5) names data poisoning, model poisoning, adversarial examples and "
                   "confidentiality attacks."),
    ],
    "V.2": [
        ("art_10", "Data quality — completeness, accuracy, representativeness, integrity — "
                   "which DORA regulates only as integrity. Article 10(3) sets these "
                   "qualities for high-risk training, validation and testing data."),
    ],
    "V.3": [
        ("art_73", "Reporting major ICT-related incidents under DORA may include incidents "
                   "in AI systems. The Act separately requires providers of high-risk AI "
                   "systems to report serious incidents."),
    ],
    "Annex": [
        ("art_14", "Human review of security-critical outputs of an AI assistant "
                   "(human-in-the-loop). The Act requires high-risk AI systems to allow "
                   "effective human oversight."),
        ("art_15", "Data poisoning, model poisoning and adversarial manipulation of an LLM "
                   "assistant — the attacks Article 15(5) addresses."),
    ],
}

# ----------------------------------------------------------------- extraction

Run = namedtuple("Run", "x y size font w text")

EM_O, EM_C, SUP_O, SUP_C = "\x01", "\x02", "\x03", "\x04"

BOX_X = (98.0, 101.0)     # a DORA box's left edge
GUTTER = 290.0            # beside a box, the running text starts right of this
FOOTER_Y = 45.0           # "Guidance on AI  Page N of 35" sits below this
BULLETS = ("\uf0a7", "\uf0b7")


def is_glyph(r):
    return r.font.startswith(("Wingdings", "Symbol"))


def page_runs(page):
    runs = []

    def visit(text, cm, tm, fd, fs):
        if not text or not text.strip():
            return
        font, widths, first = "", None, 32
        if fd:
            font = str(fd.get("/BaseFont", "")).split("+")[-1]
            try:
                widths = [float(w) for w in fd["/Widths"]]
                first = int(fd.get("/FirstChar", 32))
            except Exception:
                widths = None
        x = cm[0] * tm[4] + cm[2] * tm[5] + cm[4]
        y = cm[1] * tm[4] + cm[3] * tm[5] + cm[5]
        size = abs(fs) * abs(cm[3] or 1.0) * abs(tm[3] or 1.0)
        w = sum(_char_width(c, widths, first, size) for c in text)
        if abs(x) < 1 and abs(y) < 1:
            if not runs:
                return
            x, y = runs[-1].x + runs[-1].w, runs[-1].y
        runs.append(Run(x, y, size, font, w, text.replace("\u00a0", " ")))

    page.extract_text(visitor_text=visit)
    return runs


def lines_of(runs):
    """Runs -> visual lines, top to bottom. Anchored to a line's highest
    run, so a raised footnote marker joins its own baseline."""
    lines, cur, base = [], [], None
    for r in sorted(runs, key=lambda r: (-r.y, r.x)):
        if base is None or base - r.y <= 6.0:
            cur.append(r)
            base = r.y if base is None else base
        else:
            lines.append(sorted(cur, key=lambda q: q.x))
            cur, base = [r], r.y
    if cur:
        lines.append(sorted(cur, key=lambda q: q.x))
    return lines


def line_text(line):
    """A line as text, with italics and footnote markers marked."""
    out, prev_end = [], None
    for r in line:
        if is_glyph(r):
            continue
        t = r.text
        if r.size < 8 and t.strip().isdigit():
            t = SUP_O + t.strip() + SUP_C
        elif "Italic" in r.font:
            t = EM_O + t + EM_C
        if prev_end is not None and r.x - prev_end > 0.12 * r.size \
                and out and not plain(out[-1]).endswith(" ") and not r.text.startswith(" "):
            out.append(" ")
        out.append(t)
        prev_end = r.x + r.w
    return re.sub(r"\s+", " ", "".join(out)).strip()


def plain(t):
    t = re.sub("%s\\d+%s" % (SUP_O, SUP_C), "", t)
    return t.replace(EM_O, "").replace(EM_C, "")


def join_lines(a, b):
    """Two wrapped lines of one paragraph. A line-end hyphen joins the word
    ("third-" "party"), except before and/or ("cyber- and data security")."""
    if not a:
        return b
    if plain(a).endswith("-") and re.match(r"[a-z]", plain(b)) \
            and not re.match(r"(?:and|or)\b", plain(b)):
        return a + b
    return a + " " + b


def box_bands(runs):
    """The vertical extent of each DORA box on a page, from its lines at x≈99.5."""
    ys = sorted({round(r.y, 1) for r in runs
                 if BOX_X[0] <= r.x <= BOX_X[1] and not is_glyph(r)}, reverse=True)
    bands = []
    for y in ys:
        if bands and bands[-1][0] - y <= 32:
            bands[-1][0] = y
        else:
            bands.append([y, y])
    return [(lo - 8, hi + 8) for lo, hi in bands]


def read_box(lines):
    """A box's lines -> ("box", reference, title, quotation)."""
    ref, title, body = "", "", ""
    for line in lines:
        t = line_text(line)
        if not ref:
            ref = t
        elif all("Bold" in r.font for r in line if not is_glyph(r)) and not body:
            title = join_lines(title, t)
        else:
            body = join_lines(body, t)
    return ["box", ref, title, body]


# ------------------------------------------------------------------ structure

def parse_bafin():
    """-> (nodes, doc metadata, figures {filename: PNG bytes})."""
    reader = PdfReader(SRC)
    sections, footnotes, figures = [], {}, {}
    state = {"cur": None, "block": None, "due": [], "roman": None, "part": None}
    last = {"y": None, "head": None}
    fn_cur = None

    def section(sec, title, part):
        cur = {"sec": sec, "title": title, "part": part, "blocks": []}
        sections.append(cur)
        state["cur"] = cur
        return cur

    def close():
        """End the open paragraph or list, then place the boxes it ran beside."""
        cur = state["cur"]
        if state["block"] is not None and cur is not None:
            cur["blocks"].append(state["block"])
        state["block"] = None
        while state["due"] and cur is not None:
            cur["blocks"].append(state["due"].pop(0))

    for pn in range(FIRST_PAGE, LAST_PAGE + 1):
        page = reader.pages[pn - 1]
        runs = [r for r in page_runs(page) if r.y >= FOOTER_Y]
        bands = box_bands(runs)
        in_box = lambda r: r.x < GUTTER and any(lo <= r.y <= hi for lo, hi in bands)
        boxes = []
        for lo, hi in bands:
            box_lines = lines_of([r for r in runs if in_box(r) and lo <= r.y <= hi])
            boxes.append((hi, read_box(box_lines)))
        body = [r for r in runs if not in_box(r)]
        last["y"] = None

        for line in lines_of(body):
            y = line[0].y
            for top, box in list(boxes):
                if y < top - 8:
                    state["due"].append(box)
                    boxes.remove((top, box))
            text_runs = [r for r in line if not is_glyph(r)]
            if not text_runs:
                continue
            main = max(r.size for r in text_runs)
            text = line_text(line)
            ptext = plain(text)

            # footnotes: 8.5pt at the foot of the page, each opened by its marker
            if main < 9.5:
                for i, piece in enumerate(re.split("%s(\\d+)%s" % (SUP_O, SUP_C), text)):
                    if i % 2:
                        fn_cur = int(piece)
                        footnotes[fn_cur] = ""
                    elif piece.strip() and fn_cur is not None:
                        footnotes[fn_cur] = join_lines(footnotes[fn_cur], plain(piece).strip())
                continue

            # headings: parts in 21pt Cambria, sections in 13pt; either may wrap
            if all(r.font.startswith("Cambria") for r in text_runs):
                size = round(main)
                if last["head"] and last["head"][1] == size:
                    cur = state["cur"]
                    cur["title"] = join_lines(cur["title"], ptext)
                    if size >= 20:
                        cur["part"] = join_lines(cur["part"], ptext)
                    continue
                close()
                if size >= 20:
                    m = re.match(r"^([IVX]+)\.\s*(.+)$", ptext)
                    if m:
                        state["roman"] = m.group(1)
                        section(m.group(1), m.group(2), "%s. %s" % (m.group(1), m.group(2)))
                    else:
                        state["roman"] = "Annex"
                        section("Annex", ptext, "Annex · " + ptext)
                else:
                    m = re.match(r"^(\d+)\.\s*(.+)$", ptext)
                    if m:
                        section("%s.%s" % (state["roman"], m.group(1)), m.group(2),
                                sections[-1]["part"])
                last["head"], last["y"] = (state["cur"], size), y
                continue
            last["head"] = None
            if state["cur"] is None:
                continue

            # the case study's running title, set above its own heading
            if ptext.startswith("Annex: Case study"):
                continue

            # figure captions, with the figure drawn on the same page
            if all("Bold" in r.font for r in text_runs) and ptext.startswith("Figure"):
                close()
                m = re.match(r"^Figure (\d+)", ptext)
                images = sorted(page.images, key=lambda im: -len(im.data))
                if m and images:
                    name = "figure-%s.png" % m.group(1)
                    figures[name] = images[0].data
                    state["cur"]["blocks"].append(["fig", name, text])
                last["y"] = y
                continue

            gap = last["y"] - y if last["y"] is not None else None
            block = state["block"]

            if any(is_glyph(r) and r.text.strip() in BULLETS for r in line):
                if block is None or block[0] != "list":
                    close()
                    state["block"] = block = ["list", []]
                block[1].append(text)
            elif block is not None and block[0] == "list" and text_runs[0].x >= 112 \
                    and (gap is None or gap <= 20):
                block[1][-1] = join_lines(block[1][-1], text)
            elif re.match(r"^Variant \d+\b", ptext):
                # The case study's three infrastructure variants. Other italic
                # line starts are run-in heads, which wrap beside a box.
                close()
                state["cur"]["blocks"].append(["h3", text])
            else:
                # A paragraph runs on across a page break unless it had ended.
                fresh = block is None or block[0] != "p" or \
                    (gap is not None and gap > 20) or \
                    (gap is None and plain(block[1]).rstrip().endswith((".", ":", "?", "!")))
                if fresh:
                    close()
                    state["block"] = ["p", text]
                else:
                    block[1] = join_lines(block[1], text)
            last["y"] = y

        # a box whose paragraph never ended on its page goes after it anyway
        state["due"].extend(box for top, box in boxes)
    close()

    nodes = []
    for s in sections:
        body = "".join(block_html(b, footnotes) for b in s["blocks"])
        text = re.sub(r"\s+", " ", " ".join(block_text(b) for b in s["blocks"])).strip()
        if len(text.split()) < 20:
            continue      # a part heading straight followed by its first section
        nodes.append({
            "id": "gdl_bafin-" + s["sec"],
            "type": "guidance",
            "doc": DOC["slug"],
            "docName": DOC["name"],
            "draft": False,
            "act": None,
            "sec": s["sec"],
            "label": "BaFin § " + s["sec"],
            "title": s["title"],
            "part": s["part"],
            "paras": None,
            "html": body,
            "text": text,
            "words": len(text.split()),
            "targets": [],
            "status": None,
        })
    return nodes, dict(DOC), figures


def inline(t, footnotes):
    t = re.sub("%s(\\s*)%s" % (EM_C, EM_O), r"\1", t)
    t = html.escape(t, quote=False)
    t = t.replace(EM_O, "<em>").replace(EM_C, "</em>")
    return re.sub("%s(\\d+)%s" % (SUP_O, SUP_C), lambda m: '<sup class="fn" title="%s">%s</sup>' % (
        html.escape(footnotes.get(int(m.group(1)), "")), m.group(1)), t)


def block_html(b, fn):
    kind = b[0]
    if kind == "p":
        return '<p class="doc-p">%s</p>' % inline(b[1], fn)
    if kind == "h3":
        return '<h3 class="gl-h3">%s</h3>' % inline(b[1], fn)
    if kind == "list":
        return '<ul class="gl-list">%s</ul>' % "".join("<li>%s</li>" % inline(i, fn) for i in b[1])
    if kind == "box":
        return ('<aside class="gl-box"><p class="gl-box-ref">%s</p><p class="gl-box-title">%s</p>'
                '<p class="doc-p">%s</p></aside>' % (inline(b[1], fn), inline(b[2], fn), inline(b[3], fn)))
    if kind == "fig":
        return ('<figure class="gl-fig"><img src="/data/bafin/%s" alt="%s" loading="lazy">'
                '<figcaption>%s</figcaption></figure>'
                % (b[1], html.escape(plain(b[2])), inline(b[2], fn)))
    return ""


def block_text(b):
    if b[0] == "list":
        return " ".join(plain(i) for i in b[1])
    if b[0] == "box":
        return " ".join(plain(x) for x in b[1:])
    return plain(b[2] if b[0] == "fig" else b[1])


def bafin_edges(nodes, definitions, by_id):
    """The concordance as `concords` edges, each carrying its reason (`why`)."""
    by_term = {d["term"]: d["id"] for d in definitions}
    found = {n["sec"]: n["id"] for n in nodes}
    edges = []
    for sec, rows in CONCORDANCE.items():
        if sec not in found:
            print("WARN BaFin concordance names § %s, which the parse did not find" % sec)
            continue
        for target, why in rows:
            dst = by_term.get(target[5:]) if target.startswith("term:") else target
            if dst not in by_id:
                print("WARN BaFin concordance target %r is not in the corpus" % target)
                continue
            edges.append({"s": found[sec], "t": dst, "k": "concords", "w": 1, "why": why})
    return edges


if __name__ == "__main__":
    nodes, doc, figures = parse_bafin()
    print("%d sections · %d figures" % (len(nodes), len(figures)))
    for n in nodes:
        kinds = re.findall(r'<(p class="doc-p"|ul|aside|figure|h3)', n["html"])
        print("  § %-6s %-58s %5dw  p%d ul%d box%d fig%d h3%d" % (
            n["sec"], n["title"][:58], n["words"],
            sum(k.startswith("p") for k in kinds), kinds.count("ul"), kinds.count("aside"),
            kinds.count("figure"), kinds.count("h3")))
