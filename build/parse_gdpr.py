#!/usr/bin/env python3
"""
Parse Regulation (EU) 2016/679 — the General Data Protection Regulation — from
its EUR-Lex consolidated export (source-gdpr.html: the text of 4.5.2016 with
the corrigendum of 23.5.2018 worked in).

The GDPR is the instrument the Act leans on most: 'personal data', 'profiling'
and 'biometric data' are defined by pointing at GDPR Article 4, and the
guidelines cite it article by article. Its 99 articles become `gdpr_*` nodes.
References to it — "Article 4, point (4), of Regulation (EU) 2016/679" in the
Act, "Article 35 GDPR" in the guidelines — which the deflection guard used to
drop, now route here as `cites` edges (parse.cited_act).

The export is in the Act's consolidated markup, so parse_consolidated reads
it. Three things differ from the Act:

  - a consolidated text never reproduces the preamble, so the 173 recitals
    are not here; they would need the Official Journal export;
  - its ▼C1 markers are the corrigendum — corrections to the text as
    published, not amendments. They are dropped from the markup, where the
    app would show them as 2026 changes, and kept as a flag per article;
  - the definitions stay inside Article 4, each point addressable
    (#/gdpr/4/pt4), because that is how the Act cites them.

    python3 build/parse_gdpr.py     # prints what each article cites
"""

import os
import re
from collections import defaultdict

from parse import article_refs, plain_text
from parse_consolidated import parse_consolidated

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "source-gdpr.html")

META = {
    "slug": "gdpr",
    "abbr": "GDPR",
    "celex": "32016R0679",
    "title": "General Data Protection Regulation",
    "longTitle": "on the protection of natural persons with regard to the processing "
                 "of personal data and on the free movement of such data, and "
                 "repealing Directive 95/46/EC",
    "cite": "Regulation (EU) 2016/679",
    "oj": "OJ L 119, 4.5.2016, p. 1",
    "adopted": "27 April 2016",
    "applies": "25 May 2018",
    "corrigendum": "OJ L 127, 23.5.2018, p. 2",
    "sourceUrl": "https://eur-lex.europa.eu/eli/reg/2016/679/2016-05-04/eng",
}

# How parse_consolidated marks a block that a ▼ marker governs.
CHG_RE = re.compile(r' data-chg="[^"]*" data-op="[^"]*"')
DEF_POINT_RE = re.compile(r'<div class="point">(?=<span class="point-marker">\((\d+)\)</span>)')

# A numbered paragraph: an article's <section class="para" id="p9">, a
# guideline's <div class="para gpara" id="g371">. They never nest.
PARA_OPEN_RE = re.compile(r'<(?:section|div) class="para[^"]*" id="([^"]+)"')


def paragraphs(html):
    """-> [(id, plain text)] for each numbered paragraph in a node's html."""
    opens = list(PARA_OPEN_RE.finditer(html))
    ends = [m.start() for m in opens[1:]] + [len(html)]
    return [(m.group(1), plain_text(html[m.start():end])) for m, end in zip(opens, ends)]


def parse_gdpr():
    """-> (articles, chapters, META)."""
    doc = parse_consolidated(SRC)
    articles = []
    for a in doc["articles"]:
        html = CHG_RE.sub("", a["html"])
        if a["key"] == "4":
            html = DEF_POINT_RE.sub(lambda m: '<div class="point" id="pt%s">' % m.group(1), html)
        node = dict(a, id="gdpr_" + a["key"], type="gdpr",
                    label="GDPR Article " + a["key"], html=html)
        if node.pop("status"):
            node["corrected"] = True
        articles.append(node)
    return articles, doc["chapters"], META


def gdpr_edges(articles, citing, by_id):
    """'cites' edges into the GDPR, deduplicated: between its own articles,
    and from every text of the Act (`citing`) that names it.

    An edge's `at` lists the numbered paragraphs of its source the citation
    sits in (`p9`, a guideline's `g371`), so a backlink can open Article 26(9)
    rather than the top of Article 26.
    """
    edges, seen = [], {}

    def cite(n, **how):
        for dst in article_refs(n["text"], **how):
            if dst in by_id and dst != n["id"] and (n["id"], dst) not in seen:
                seen[n["id"], dst] = {"s": n["id"], "t": dst, "k": "cites", "w": 1}
                edges.append(seen[n["id"], dst])
        for pid, text in paragraphs(n["html"]):
            for dst in article_refs(text, **how):
                e = seen.get((n["id"], dst))
                if e is not None and pid not in e.setdefault("at", []):
                    e["at"].append(pid)

    for a in articles:
        cite(a, self_id=a["id"], doc="gdpr", to="gdpr")
    for n in citing:
        cite(n, amending=bool(n.get("amending")), to="gdpr")
    return edges


if __name__ == "__main__":
    articles, chapters, meta = parse_gdpr()
    edges = gdpr_edges(articles, [], {a["id"]: a for a in articles})
    cites = defaultdict(list)
    for e in edges:
        cites[e["s"]].append(e["t"][len("gdpr_"):])
    print("%d articles in %d chapters · %d corrected by the corrigendum · %d citations"
          % (len(articles), len(chapters), sum(1 for a in articles if a.get("corrected")),
             len(edges)))
    for a in articles:
        print("  Art. %-3s %-50s -> %s" % (a["key"], a["title"][:50],
                                         " ".join(cites[a["id"]]) or "—"))
