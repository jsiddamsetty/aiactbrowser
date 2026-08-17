# AI Act Browser

A single-page reader for **Regulation (EU) 2024/1689** (the EU AI Act) that puts
the article text, its recitals, its cross-references and a full-size citation
graph on one screen.

It shows the Act **as consolidated and in force from 27 July 2026**, after
Regulation (EU) 2026/1744 (the *Digital Omnibus on AI*), and carries a
[What changed](#the-changes-page) view with a word-level redline against the
2024 original.

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
index.html                    markup
assets/styles.css             tokens + layout
assets/app.js                 routing, reader, search, connections, changes
assets/graph.js               force-directed canvas graph (no library)
data/aiact.json               the Act as it now stands — loaded on start
data/changes.json             the 2026 redlines — fetched only on /changes
build/build.py                the entry point: sources -> both JSON files
build/parse.py                reader for Official Journal (fmx) markup
build/parse_consolidated.py   reader for consolidated (clg) markup
build/source-oj.html          Regulation (EU) 2024/1689 as first published
build/source-consolidated.html  the same Act, consolidated to 27.07.2026
build/source-omnibus.html     Regulation (EU) 2026/1744, the amending act
```

## Data

Everything is parsed from official EUR-Lex exports. Nothing is hand-typed.

| | |
|---|---|
| Articles | 119 &nbsp;*(113 original + 6 inserted in 2026)* |
| Recitals | 180 &nbsp;*(+ 47 from the amending act)* |
| Annexes | 14 &nbsp;*(13 original + Annex XIV)* |
| Defined terms (Article 3) | 68 |
| Connections | ~2 550 |
| Provisions changed in 2026 | 46 |

Three sources, two different markups. The consolidated export uses EUR-Lex's
`clg` converter, the Official Journal export uses `fmx`, so each needs its own
reader — hence two parser modules. The split matters for a second reason: **a
consolidated text never reproduces the preamble**, so the 180 recitals can only
come from the Act as first published.

Regenerate after changing a parser:

```sh
python3 -m pip install beautifulsoup4     # only build-time dependency
python3 build/build.py
```

The script prints counts and warns about gaps (missing article or recital
numbers, untitled articles), so a broken parse fails loudly rather than shipping
a half-empty site.

### How the connections are derived

Five edge kinds, each labelled in the UI so you can tell evidence from inference:

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

## The changes page

`#/changes` shows what Regulation (EU) 2026/1744 did to the Act: **6 articles
and Annex XIV added, 39 provisions rewritten**, filterable by kind, each
expanding to a word-level redline against the 2024 text.

**Change status is EUR-Lex's own annotation, never inferred.** The consolidated
export marks every amended block with `▼M1` and names the operation in the
anchor's title (`32026R1744: REPLACED` / `INSERTED` / `DELETED`); the parser
tracks the current marker as it walks the document and records it per block.
That is why amended paragraphs are also flagged inline while you read.

Inferring status from a text comparison instead would be wrong: the two exports
come from different converters, and a raw diff of the 113 shared articles
reports 77 of them as changed — almost all of it footnote markers, non-breaking
spaces and punctuation spacing. The redline is therefore computed *only* for
provisions EUR-Lex has already marked, after canonicalising quotes, dashes and
footnote marks.

The amending act's own 47 recitals are parsed too, matched to the provisions
they explain by the same machinery as the AI Act's recitals, and shown under a
**Why** heading on each change.

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

`vercel.json` sets clean URLs and cache headers; `.vercelignore` keeps the 2.4 MB
of EUR-Lex source documents and the parsers out of the deployment. Pushing to
`main` deploys automatically.

## Interface notes

- `/` focuses search · `g` opens the graph · `Esc` closes overlays
- Click a node to open it; drag to rearrange, scroll to zoom, double-click to refit
- The rail graph shows 1 or 2 hops around what you are reading; the legend
  chips filter node types and always show how many of each type are *there*,
  not how many are currently drawn
- **Expand** opens that same neighbourhood full-screen, centred on what you are
  reading, with 1/2/3-hop and a *Whole Act* toggle — it is a linkable route
  (`#/graph/art_25`), so closing it returns you to the provision. The top-bar
  **Graph** button opens the whole Act instead
- Defined terms are leaves in the hop graph, never routes: `'provider'` is used
  by 161 provisions, so hopping *through* it would drag in most of the Act and
  call it a neighbourhood
- On touch, the graph pans with one finger and zooms with two; the expanded
  view keeps its scope, hop and type controls on a wrapped bar rather than
  dropping them, and the label budget scales with the canvas area
- **Outgoing and backlinks are tabbed** under the graph, so backlinks are never
  pushed below the fold by a long citation list
- Hovering a defined term previews its definition; clicking opens it
- Articles inserted in 2026 are lettered, and routed as such: `#/article/75c`
- Article paragraphs are addressable: `#/article/25/p2`, and in-text references
  like "Article 6(3)" link straight to the paragraph

## Accessibility

The four node-type colours are a categorical palette validated at **all pairs**
in both light and dark mode for protanopia, deuteranopia and tritanopia
(worst-case ΔE 13.9 light / 10.8 dark, OKLab ×100), each clearing 3:1 against its
surface. Colour never carries meaning alone — every node and connection is also
labelled in text. Dark mode uses its own validated steps rather than inverted
light ones.

Amendment state is an editorial annotation, not a fifth category, so it does not
borrow one of the four node hues: changed blocks get a rule, a tint and the word
*replaced 2026* / *inserted 2026*. Redlines use `<ins>` and `<del>` elements —
correct semantics for assistive technology — and prefix each run with `+` or `−`
so the distinction survives without colour.

## Licence

The texts of Regulation (EU) 2024/1689 and Regulation (EU) 2026/1744 are
© European Union, reproduced from [EUR-Lex](https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng);
reuse is authorised under Decision 2011/833/EU provided the source is
acknowledged. Consolidated texts carry no legal value — this is an unofficial
reading aid, and only the Official Journal text is authentic.
