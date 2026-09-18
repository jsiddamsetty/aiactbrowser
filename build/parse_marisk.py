#!/usr/bin/env python3
"""Parse the structured modules of BaFin MaRisk circular 06/2026."""

import html
import os
import re
from collections import defaultdict

from pypdf import PdfReader

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(os.path.dirname(HERE), "2026-06-30-rundschreiben-data.pdf")

META = {
    "slug": "marisk", "shortTitle": "MaRisk",
    "title": "Mindestanforderungen an das Risikomanagement — MaRisk",
    "cite": "BaFin Circular 06/2026 (BA)", "version": "30 June 2026",
    "inForce": "30 June 2026", "language": "de",
    "sourceUrl": "https://www.bafin.de/SharedDocs/Veroeffentlichungen/DE/Rundschreiben/2026/rs_06_2026_MaRisk_BA.html",
}

MODULE_RE = re.compile(r"^(AT|BT|BTO|BTR)(?:\s+(\d+(?:\.\d+)*))?\s+(.+?)\s+(\d+)\s*$")
HEADER_RE = re.compile(r"^BA 54\s*[-–].*Bundesanstalt.*$|^Seite \d+ von \d+$")
ITEM_RE = re.compile(r"^(\d+)\s+(.+)")
DORA_RE = re.compile(
    r"\bArt(?:ikel|\.)\s*(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?\s*"
    r"(?:Abs(?:atz|\.)?\s*(\d+)|\((\d+)\))?[^.\n]{0,120}?"
    r"(?:DORA\b|Verordnung\s*\(EU\)\s*2022/2554)", re.I)
MODULE_CITE_RE = re.compile(r"\b(AT|BT|BTO|BTR)\s+(\d+(?:\.\d+)*)\b")


def clean_page(text):
    lines = []
    for raw in text.splitlines():
        line = re.sub(r"\s+", " ", raw).strip()
        if not line or HEADER_RE.match(line):
            continue
        lines.append(line)
    return "\n".join(lines)


def toc(reader):
    found = {}
    for page in reader.pages[1:6]:
        for line in clean_page(page.extract_text() or "").splitlines():
            match = MODULE_RE.match(line)
            if not match:
                continue
            family, number, title, page_num = match.groups()
            key = family + ((" " + number) if number else "")
            found[key] = {"key": key, "family": family, "title": title, "page": int(page_num)}
    return found


def render_body(lines):
    blocks, current = [], []
    for line in lines:
        match = ITEM_RE.match(line)
        if match:
            if current:
                blocks.append((None, " ".join(current)))
            current = [match.group(2)]
            blocks.append((match.group(1), ""))
        elif current:
            current.append(line)
        else:
            blocks.append((None, line))
    if current:
        blocks.append((None, " ".join(current)))
    out = []
    for i, (num, text) in enumerate(blocks):
        if num is not None:
            body = blocks[i + 1][1] if i + 1 < len(blocks) and blocks[i + 1][0] is None else ""
            out.append('<section class="para" id="p%s" data-para="%s"><span class="para-n">%s</span><p class="doc-p">%s</p></section>' %
                       (num, num, num, html.escape(body)))
        elif i == 0 or blocks[i - 1][0] is None:
            out.append('<aside class="marisk-note"><p class="doc-p">%s</p></aside>' % html.escape(text))
    return "".join(out)


def parse_marisk(path=SRC):
    reader = PdfReader(path)
    entries = toc(reader)
    ordered = sorted(entries.values(), key=lambda x: (x["page"], len(x["key"])))
    page_text = {i + 1: clean_page(page.extract_text() or "") for i, page in enumerate(reader.pages)}
    nodes = []
    for index, entry in enumerate(ordered):
        start = entry["page"]
        end = ordered[index + 1]["page"] if index + 1 < len(ordered) else len(reader.pages) + 1
        body = "\n".join(page_text.get(p, "") for p in range(start, end + 1))
        marker = re.compile(r"(?:^|\n)%s\s+%s(?:\s|\n)" %
                            (re.escape(entry["key"]), re.escape(entry["title"])))
        hit = marker.search(body)
        if hit:
            body = body[hit.end():]
        if index + 1 < len(ordered):
            nxt = ordered[index + 1]
            cut = re.search(r"(?:^|\n)%s\s+%s(?:\s|\n)" %
                            (re.escape(nxt["key"]), re.escape(nxt["title"])), body)
            if cut:
                body = body[:cut.start()]
        lines = body.splitlines()
        text = re.sub(r"\s+", " ", " ".join(lines)).strip()
        if len(text.split()) < 4:
            continue
        nodes.append({
            "id": "marisk_" + entry["key"].replace(" ", "-").replace(".", "."),
            "type": "module", "corpus": "marisk", "key": entry["key"],
            "label": "MaRisk " + entry["key"], "title": entry["title"],
            "html": render_body(lines), "text": text, "words": len(text.split()),
            "page": start, "status": None,
        })
    return nodes, ordered, dict(META, counts={"modules": len(nodes)})


def marisk_edges(nodes, by_id):
    edges, seen = [], set()
    keys = {n["key"]: n["id"] for n in nodes}
    for node in nodes:
        for match in DORA_RE.finditer(node["text"]):
            first, last = int(match.group(1)), int(match.group(2) or match.group(1))
            for number in range(first, min(last, 64) + 1):
                dst = "dora_%s" % number
                key = (node["id"], dst)
                if dst in by_id and key not in seen:
                    para = match.group(3) or match.group(4)
                    edge = {"s": node["id"], "t": dst, "k": "cites", "w": 1}
                    if para and first == last:
                        edge["targetAt"] = "p" + para
                    edges.append(edge); seen.add(key)
        for match in MODULE_CITE_RE.finditer(node["text"]):
            dst = keys.get(match.group(1) + " " + match.group(2))
            key = (node["id"], dst)
            if dst and dst != node["id"] and key not in seen:
                edges.append({"s": node["id"], "t": dst, "k": "cites", "w": 1})
                seen.add(key)
    return edges


if __name__ == "__main__":
    parsed, _, meta = parse_marisk()
    print("%d MaRisk modules" % len(parsed))
    for node in parsed:
        print("%-14s %s" % (node["key"], node["title"]))
