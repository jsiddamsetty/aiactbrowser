# AI Act Browser

A static regulatory portal for the EU AI Act and connected instruments:
GDPR, DORA and its technical standards, KI-MIG, MaRisk, Commission guidance,
and BaFin guidance on ICT risks in AI.

The interactive reader combines provision text, recitals, cross-references,
change tracking, a citation graph, and an instrument relationship map. It
uses vanilla JavaScript and no frontend framework.

## Run locally

Serve the repository root with any static server, then open it in a browser.

```sh
python3 -m http.server 4173
```

The interactive app uses hash routes, such as `/#/aia/article/6` and
`/#/gdpr`.

## Agent and crawler access

Every document and provision is also built as a normal, no-JavaScript HTML
page. Examples:

- `/aia/article/6`
- `/gdpr/article/35`
- `/kimig/section/15`
- `/sitemap`

The generated pages retain the legal text and cross-links. They are the
appropriate surface for agents, crawlers, and readers without JavaScript;
the hash-routed reader remains the enhanced browser interface.

## Build

Corpus data and static pages are generated from the source documents:

```sh
python3 -m pip install beautifulsoup4 pypdf
python3 build/build.py
```

The build writes:

- `data/*.json` — corpus data, graph edges, topics, and change data
- `aia/`, `gdpr/`, `dora/`, and related directories — static provision pages
- `map.html`, `graph.html`, `changes.html`, `topics.html`, and `sitemap.html`

## Project layout

| Path | Purpose |
| --- | --- |
| `index.html` | Interactive application shell and no-JavaScript home fallback |
| `assets/app.js` | Reader, routing, search, links, and map interactions |
| `assets/graph.js` | Canvas citation graph |
| `assets/styles.css` | Interactive interface styles |
| `assets/static.css` | Static reading-page styles |
| `build/build.py` | Source parsing, data assembly, and static export |
| `build/static_pages.py` | Static page generator |
| `data/` | Generated corpus data |
| `PLAN.md` | Implementation history and future work |
| `INTERPLAY.md` | Design notes for cross-instrument views |

## Sources and editorial status

The EU texts are parsed from EUR-Lex exports; KI-MIG is parsed from
gesetze-im-internet.de; the guidance and MaRisk material are parsed from the
source files in `build/`. Literal citations are extracted from the text.
Recital links, topic tags, and instrument-level relationships are research
aids and are identified in the interface as derived or editorial material.

The AI Act corpus is consolidated and in force from 27 July 2026. Check the
source links shown in the reader for the authoritative text.
