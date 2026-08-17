# AI Act Browser

A single-page reader for **Regulation (EU) 2024/1689** (the EU AI Act) that puts
the article text, its recitals, its cross-references and a full-size citation
graph on one screen.

It combines what the two obvious references each do well:

- from **artificialintelligenceact.eu** — a clean chapter/section table of
  contents and readable, properly structured article text;
- from the **AI Act Graph Explorer** — outgoing connections, backlinks and a
  knowledge graph;
- and adds the two things neither has: **recitals attached to the provisions
  they explain**, and a graph you can actually work in (full-screen, filterable,
  zoomable, clickable).

No framework, no runtime dependencies. Three static files and one JSON.

## What's in the box

```
index.html            markup
assets/styles.css     tokens + layout
assets/app.js         routing, reader, search, connections
assets/graph.js       force-directed canvas graph (no library)
data/aiact.json       the parsed Act — the only data the site loads
build/parse.py        Official Journal HTML  ->  data/aiact.json
build/source-oj.html  the EUR-Lex source document
```

## Data

Everything is parsed from the official EUR-Lex CONVEX/ELI export of the Act
(`build/source-oj.html`, CELEX `32024R1689`). Nothing is hand-typed.

| | |
|---|---|
| Articles | 113 |
| Recitals | 180 |
| Annexes | 13 |
| Defined terms (Article 3) | 68 |
| Footnotes | 58 |
| Connections | ~2 100 |

Regenerate after changing the parser:

```sh
python3 -m pip install beautifulsoup4     # only build-time dependency
python3 build/parse.py
```

The script prints counts and warns about gaps (missing article or recital
numbers, untitled articles), so a broken parse fails loudly rather than shipping
a half-empty site.

### How the connections are derived

Four edge kinds, each labelled in the UI so you can tell evidence from inference:

| Kind | Meaning | Source |
|---|---|---|
| `cites` | "…the obligations of the provider under **Article 16**" | literal text |
| `annex` | "…listed in **Annex I**" | literal text |
| `uses` | the provision uses a term defined in Article 3 | whole-word match |
| `explains` / `relates` | a recital explains this provision | see below |

**The recital mapping is the one genuinely derived layer.** The Official Journal
text contains no recital-to-article index: recitals explain the enacting terms
but usually never name them. So:

- when a recital *does* name a provision, that is an `explains` edge and the UI
  badges it **"names it"**;
- otherwise the parser scores TF-IDF cosine similarity between the recital and
  every article and annex, boosted when the recital repeats the provision's
  title words, and keeps matches that clear both an absolute floor (0.20) and
  45 % of that recital's best score, capped at three. Those are `relates` edges,
  shown under a **"matched by topic"** note.

This recovers a mapping for 149 of the 180 recitals; the remaining 31 are
general or institutional recitals that genuinely belong to no single provision.
Spot-checks line up with the editorial mappings on artificialintelligenceact.eu
(Article 5 → recitals 29–44, Article 25 → 84–90, Article 50 → 132–136).

Treat the topical matches as a research aid, not an authority. The literal
citations and the text itself are exact.

## Running it

Any static server:

```sh
python3 -m http.server 4321      # then open http://localhost:4321
```

## Deploying to Vercel

Zero configuration — it is a static site.

```sh
npm i -g vercel
vercel            # preview
vercel --prod     # production
```

`vercel.json` sets clean URLs and cache headers; `.vercelignore` keeps the 1.2 MB
Official Journal source and the parser out of the deployment.

## Interface notes

- `/` focuses search · `g` opens the graph · `Esc` closes overlays
- Click a node to open it; drag to rearrange, scroll to zoom, double-click to refit
- The rail graph shows 1 or 2 hops around what you are reading; the legend
  chips filter node types
- Article paragraphs are addressable: `#/article/25/p2`, and in-text references
  like "Article 6(3)" link straight to the paragraph

## Accessibility

The four node-type colours are a categorical palette validated at **all pairs**
in both light and dark mode for protanopia, deuteranopia and tritanopia
(worst-case ΔE 13.9 light / 10.8 dark, OKLab ×100), each clearing 3:1 against its
surface. Colour never carries meaning alone — every node and connection is also
labelled in text. Dark mode uses its own validated steps rather than inverted
light ones.

## Licence

The text of Regulation (EU) 2024/1689 is © European Union, reproduced from
[EUR-Lex](https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng); reuse is
authorised under Decision 2011/833/EU provided the source is acknowledged.
This is an unofficial reading aid — only the Official Journal text is
authentic.
