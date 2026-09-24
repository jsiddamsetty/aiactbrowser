#!/usr/bin/env python3
"""Generate normal-URL, no-JavaScript reading pages from corpus JSON."""

from __future__ import annotations

import html
import json
import re
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
MANIFEST = ROOT / ".static-pages.json"
NODE_KEYS = ("articles", "recitals", "annexes", "definitions", "guidance", "kimig", "modules")
PREFIXES = (
    ("art_", "article"), ("rct_", "recital"), ("anx_", "annex"),
    ("def_", "term"), ("par_", "section"), ("module_", "module"),
    ("gdl_", "guidance"), ("omr_", "omnibus-recital"),
)


def read(name):
    with (DATA / name).open(encoding="utf-8") as source:
        return json.load(source)


def node_route(node_id):
    corpus, local = node_id.split(":", 1)
    for prefix, kind in PREFIXES:
        if local.startswith(prefix):
            return "/%s/%s/%s" % (corpus, kind, quote(local[len(prefix):], safe=""))
    return "/%s/node/%s" % (corpus, quote(local, safe=""))


def route_hashes(markup):
    def replace(hit):
        route = hit.group(1)
        parts = route.split("/")
        # The application encodes a paragraph as a final path segment. A
        # static document is one file, so preserve that destination as an HTML
        # fragment instead of linking an agent to a non-existent sub-route.
        if len(parts) > 3 and re.match(r"^(?:p|pt)\d+[a-z]*$", parts[-1], re.I):
            route = "/".join(parts[:-1]) + "#" + parts[-1]
        return 'href="/%s"' % route
    return re.sub(r'href="#/([^"#]+)"', replace, markup or "")


def page(title, body, description=""):
    desc = html.escape(description or title, quote=True)
    return """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>%s — AI Act Browser</title><meta name="description" content="%s"><link rel="stylesheet" href="/assets/static.css"></head>
<body class="agent-page"><main class="agent-wrap"><nav class="agent-nav"><a href="/">AI Act Browser</a><a href="/aia">EU AI Act</a><a href="/gdpr">GDPR</a><a href="/map">Interaction map</a><a href="/changes">Changes</a></nav>%s
<footer class="agent-footer">Static reading page. The interactive reader remains available at <a href="/#/">the application home</a>.</footer></main></body></html>""" % (html.escape(title), desc, body)


def node_title(node):
    return node.get("label") or node.get("title") or node["id"]


def node_body(node):
    markup = route_hashes(node.get("html") or "")
    if not markup:
        markup = "".join("<p>%s</p>" % html.escape(part) for part in node.get("text", "").split("\n\n"))
    return markup


def source_url(document, node=None):
    if node and node.get("type") == "guidance":
        for guide in document.get("guidanceDocs", []):
            if guide.get("slug") == node.get("doc"):
                return guide.get("sourceUrl", "")
    return document.get("meta", {}).get("sourceUrl", "")


def source_link(url):
    if not url:
        return ""
    return '<p class="agent-source"><a href="%s" target="_blank" rel="noopener">Official source ↗</a></p>' % html.escape(url, quote=True)


def write(relpath, contents, written):
    path = ROOT / relpath
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(contents, encoding="utf-8")
    written.add(relpath.as_posix())


def clean_previous():
    if not MANIFEST.exists():
        return
    for item in json.loads(MANIFEST.read_text(encoding="utf-8")):
        path = ROOT / item
        if path.exists() and path.is_file():
            path.unlink()
    folders = ((ROOT / item).parent for item in json.loads(MANIFEST.read_text(encoding="utf-8")))
    for folder in sorted(folders, reverse=True):
        if folder != ROOT and folder.exists() and not any(folder.iterdir()):
            folder.rmdir()


def corpus_nodes(document):
    return [node for key in NODE_KEYS for node in document.get(key, [])]


def corpus_page(slug, document, written):
    meta = document.get("meta", {})
    nodes = corpus_nodes(document)
    title = meta.get("shortTitle") or meta.get("abbr") or meta.get("title") or slug.upper()
    summary = meta.get("title") or title
    groups = {}
    for node in nodes:
        groups.setdefault(node.get("type", "provisions").replace("_", " ").title(), []).append(node)
    lists = []
    for label, entries in groups.items():
        items = "".join('<li><a href="%s">%s</a><small>%s</small></li>' % (
            node_route(node["id"]), html.escape(node_title(node)), html.escape(node.get("title") or "")) for node in entries)
        lists.append("<h2>%s</h2><ul class=\"agent-list\">%s</ul>" % (html.escape(label), items))
    body = '<p class="agent-kicker">%s</p><h1>%s</h1><p class="agent-summary">%s</p>' % (
        html.escape(meta.get("bindingLevel") or "Legal text"), html.escape(title), html.escape(summary))
    body += source_link(source_url(document))
    body += "".join(lists)
    write(Path(slug) / "index.html", page(title, body, summary), written)

    for index, node in enumerate(nodes):
        previous = nodes[index - 1] if index else None
        following = nodes[index + 1] if index + 1 < len(nodes) else None
        links = '<a href="/%s">%s</a>' % (slug, html.escape(title))
        if previous:
            links += ' · <a href="%s">Previous</a>' % node_route(previous["id"])
        if following:
            links += ' · <a href="%s">Next</a>' % node_route(following["id"])
        node_title_text = node_title(node)
        body = '<p class="agent-kicker">%s</p><h1>%s</h1><p class="agent-meta">%s</p><nav class="agent-nav">%s</nav>%s<article class="agent-body">%s</article>' % (
            html.escape(node.get("type", "provision").replace("_", " ")),
            html.escape(node_title_text), html.escape(node.get("title") or ""), links,
            source_link(source_url(document, node)), node_body(node))
        route = node_route(node["id"]).lstrip("/")
        write(Path(route + ".html"), page(node_title_text, body, node.get("text", "")[:180]), written)


def overview_pages(registry, written):
    items = registry.get("corpora", [])
    cards = "".join('<a class="agent-card" href="/%s"><strong>%s</strong><span>%s</span></a>' % (
        html.escape(item["slug"]), html.escape(item.get("shortTitle") or item["slug"]),
        html.escape(item.get("title") or item.get("bindingLevel") or ""))
        for item in items if item.get("dataFile") and item["slug"] != "commission-guidance")
    body = '<p class="agent-kicker">Static reference</p><h1>The EU AI Act</h1><p class="agent-summary">A complete, linkable reading edition of the AI Act and connected instruments. These normal-URL pages are available without JavaScript.</p><h2>Documents</h2>' + cards
    write(Path("agents.html"), page("AI Act Browser", body), written)

    relations = read("relations.json").get("relations", [])
    rels = "".join("<li><strong>%s → %s</strong><br>%s</li>" % (
        html.escape(item["from"]), html.escape(item["to"]), html.escape(item.get("explanation", ""))) for item in relations)
    write(Path("map.html"), page("Interaction map", '<p class="agent-kicker">Interaction map</p><h1>How the rules connect</h1><ul>%s</ul>' % rels), written)

    graph_links = "".join('<li><a href="/%s">%s</a></li>' % (
        html.escape(item["slug"]), html.escape(item.get("shortTitle") or item["slug"]))
        for item in items if item.get("dataFile") and item["slug"] != "commission-guidance")
    write(Path("graph.html"), page("Citation graph", '<p class="agent-kicker">Citation graph</p><h1>Browse the graph as linked documents</h1><p class="agent-summary">The interactive graph is canvas-based. Its complete source texts and addressable nodes are available below as ordinary links.</p><ul>%s</ul>' % graph_links), written)

    changes = read("changes.json")
    rows = "".join("<li><a href=\"%s\">%s</a> — %s</li>" % (
        node_route(item["id"]), html.escape(item.get("label") or item["id"]), html.escape(item.get("status") or ""))
        for item in changes.get("items", []))
    write(Path("changes.html"), page("Changes", '<p class="agent-kicker">Digital Omnibus on AI</p><h1>What changed in 2026</h1><ul>%s</ul>' % rows), written)

    topics = read("topics.json")
    topic_rows = "".join("<li><strong>%s</strong>: %s</li>" % (
        html.escape(topic.get("label") or topic.get("name") or "Topic"),
        html.escape(topic.get("description") or "")) for topic in topics.get("topics", []))
    write(Path("topics.html"), page("Topics", '<p class="agent-kicker">Requirement matrix</p><h1>Topics across instruments</h1><ul>%s</ul>' % topic_rows), written)


def main():
    clean_previous()
    written = set()
    registry = read("registry.json")
    for entry in registry.get("corpora", []):
        data_file = entry.get("dataFile")
        if data_file and entry["slug"] != "commission-guidance":
            corpus_page(entry["slug"], read(Path(data_file).name), written)
    overview_pages(registry, written)
    urls = sorted("/%s" % path[:-5] if path.endswith(".html") else "/%s" % path for path in written)
    links = "".join('<li><a href="%s">%s</a></li>' % (html.escape(url), html.escape(url)) for url in urls)
    write(Path("sitemap.html"), page("Site map", '<p class="agent-kicker">Static navigation</p><h1>Site map</h1><ul class="agent-list">%s</ul>' % links), written)
    MANIFEST.write_text(json.dumps(sorted(written), indent=2) + "\n", encoding="utf-8")
    print("static pages: %d" % len(written))


if __name__ == "__main__":
    main()
