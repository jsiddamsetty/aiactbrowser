#!/usr/bin/env python3
"""Reusable parser for the additional EUR-Lex Official Journal corpora."""

import os
from collections import defaultdict

from bs4 import BeautifulSoup

import parse as oj


def parse_eu_oj(path, slug, meta, article_prefix, include_definitions=False):
    with open(path, encoding="utf-8", errors="replace") as fh:
        soup = BeautifulSoup(fh.read(), "html.parser")
    footnotes = oj.parse_footnotes(soup)
    articles, chapters = oj.parse_structure(soup, footnotes)
    # Post-2023 act-by-act OJ exports often group articles under TITLE rather
    # than CHAPTER elements.  The core parser deliberately follows chapters,
    # so technical standards need this structurally equivalent fallback.
    if not articles:
        generic = {"roman": "", "label": meta["shortTitle"],
                   "title": meta["title"], "sections": []}
        for div in soup.find_all("div", id=__import__("re").compile(r"^art_\d+$")):
            article = oj.parse_article(div, footnotes, generic, None)
            if article:
                articles.append(article)
        articles.sort(key=lambda article: article["num"])
        chapters = [generic]
    recitals = oj.parse_recitals(soup, footnotes)
    annexes = oj.parse_annexes(soup, footnotes)
    definitions = oj.parse_definitions(soup, footnotes) if include_definitions else []

    def rename(nodes, old, new):
        for node in nodes:
            if node["id"].startswith(old):
                node["id"] = new + node["id"][len(old):]

    rename(articles, "art_", article_prefix)
    rename(recitals, "rct_", slug.replace("-", "") + "_rct_")
    rename(annexes, "anx_", slug.replace("-", "") + "_anx_")
    rename(definitions, "def_", slug.replace("-", "") + "_def_")

    for node in articles + recitals + annexes + definitions:
        node["corpus"] = slug
        if node["type"] == "article":
            node["key"] = str(node.get("key", node["num"]))
            node["label"] = "%s Article %s" % (meta["shortTitle"], node["key"])
        elif node["type"] == "recital":
            node["label"] = "%s recital %s" % (meta["shortTitle"], node["num"])

    nodes = articles + recitals + annexes + definitions
    by_id = {node["id"]: node for node in nodes}
    annex_prefix = slug.replace("-", "") + "_anx_"
    edges = oj.build_edges(by_id, articles, recitals, annexes, definitions,
                           doc=slug, annex_prefix=annex_prefix)
    degree = defaultdict(int)
    for edge in edges:
        degree[edge["s"]] += 1
        degree[edge["t"]] += 1
    for node in nodes:
        node["degree"] = degree[node["id"]]

    result_meta = dict(meta)
    result_meta["counts"] = {
        "articles": len(articles), "recitals": len(recitals),
        "annexes": len(annexes), "definitions": len(definitions),
        "edges": len(edges),
    }
    return {
        "meta": result_meta, "chapters": chapters, "articles": articles,
        "recitals": recitals, "annexes": annexes,
        "definitions": definitions, "footnotes": footnotes, "edges": edges,
    }


DORA_META = {
    "slug": "dora", "shortTitle": "DORA",
    "title": "Regulation (EU) 2022/2554 — Digital Operational Resilience Act",
    "celex": "32022R2554", "version": "original", "inForce": "17 January 2025",
    "source": "Official Journal of the European Union, L 333, 27.12.2022",
    "sourceUrl": "https://eur-lex.europa.eu/eli/reg/2022/2554/oj/eng",
}

TECHNICAL = [
    {
        "slug": "dora-rts-rmf", "file": "source-dora-rts-rmf.html",
        "prefix": "rtsrmf_", "shortTitle": "RTS RMF", "celex": "32024R1774",
        "title": "DORA RTS on ICT risk management frameworks",
        "sourceUrl": "https://eur-lex.europa.eu/eli/reg_del/2024/1774/oj/eng",
        "inForce": "15 July 2024", "bindingLevel": "delegated regulation",
    },
    {
        "slug": "dora-rts-sub", "file": "source-dora-rts-subcontracting.html",
        "prefix": "rtssub_", "shortTitle": "RTS Subcontracting", "celex": "32025R0532",
        "title": "DORA RTS on subcontracting ICT services",
        "sourceUrl": "https://eur-lex.europa.eu/eli/reg_del/2025/532/oj/eng",
        "inForce": "22 July 2025", "bindingLevel": "delegated regulation",
    },
    {
        "slug": "dora-its-register", "file": "source-dora-its-register.html",
        "prefix": "itsreg_", "shortTitle": "ITS Register", "celex": "32024R2956",
        "title": "DORA ITS on the register of information",
        "sourceUrl": "https://eur-lex.europa.eu/eli/reg_impl/2024/2956/oj/eng",
        "inForce": "22 December 2024", "bindingLevel": "implementing regulation",
    },
]


def parse_dora(here):
    main = parse_eu_oj(os.path.join(here, "source-dora.html"), "dora", DORA_META,
                       "dora_", include_definitions=True)
    supporting = []
    for cfg in TECHNICAL:
        meta = dict(cfg)
        path, prefix = os.path.join(here, meta.pop("file")), meta.pop("prefix")
        supporting.append(parse_eu_oj(path, cfg["slug"], meta, prefix))
    return main, supporting
