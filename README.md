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
build/parse_guidelines.py     reader for the Commission guidelines (PDF)
build/parse_kimig.py          reader for the KI-MIG (gesetze-im-internet XML)
build/parse_gdpr.py           reader for the GDPR (consolidated markup)
build/source-oj.html          Regulation (EU) 2024/1689 as first published
build/source-consolidated.html  the same Act, consolidated to 27.07.2026
build/source-omnibus.html     Regulation (EU) 2026/1744, the amending act
build/source-guidelines-prohibited.pdf           C(2025) 5052 final (adopted)
build/source-guidelines-highrisk-principles.pdf  ┐ draft Art. 6 guidelines,
build/source-guidelines-highrisk-annex3.pdf      ┘ consultation version
build/source-kimig.xml        KI-MIG, BGBl. 2026 I Nr. 223 (German law)
build/translations/kimig-en/  its unofficial English translation, per section
build/source-gdpr.html        Regulation (EU) 2016/679, consolidated 04.05.2016
```

## Data

Everything is parsed from official exports — EUR-Lex for the EU texts,
gesetze-im-internet.de for the KI-MIG. Nothing is hand-typed.

| | |
|---|---|
| Articles | 119 &nbsp;*(113 original + 6 inserted in 2026)* |
| Recitals | 180 &nbsp;*(+ 47 from the amending act)* |
| Annexes | 14 &nbsp;*(13 original + Annex XIV)* |
| Defined terms (Article 3) | 68 |
| Guidance sections | 178 &nbsp;*(110 prohibited practices + 68 high-risk)* |
| KI-MIG sections | 20 &nbsp;*(citing 49 provisions of the Act)* |
| GDPR articles | 99 &nbsp;*(6 of them cited from the Act's side)* |
| Connections | ~3 400 |
| Provisions changed in 2026 | 46 |

Three sources, two different markups. The consolidated export uses EUR-Lex's
`clg` converter, the Official Journal export uses `fmx`, so each needs its own
reader — hence two parser modules. The split matters for a second reason: **a
consolidated text never reproduces the preamble**, so the 180 recitals can only
come from the Act as first published.

Regenerate after changing a parser:

```sh
python3 -m pip install beautifulsoup4 pypdf   # build-time dependencies
python3 build/build.py
```

The script prints counts and warns about gaps (missing article or recital
numbers, untitled articles), so a broken parse fails loudly rather than shipping
a half-empty site.

It then lists every connection the build added or dropped since the last
commit. The sources never change, but the parsers do, and `data/aiact.json` is
a single line — git would show a parser tweak that drops 250 edges as one
changed line. Read that list before committing a parser change:

```
edges       3032 -> 3305 since the last commit
  cites      -0    +202
  + art_3            cites     art_4
```

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

## The guidance layer

Two sets of Commission guidelines are parsed in whole and attached to the
provisions they interpret:

- **Guidelines on prohibited AI practices** (Article 5) — C(2025) 5052 final,
  adopted 29 July 2025;
- **Draft guidelines on the classification of high-risk AI systems**
  (Article 6 / Annex III) — the stakeholder-consultation version, clearly
  badged *draft* throughout the UI.

Each numbered section of a guideline document is one node, keyed the way the
Commission cites it ("§ 2.7.1"), with its numbered paragraphs, worked-example
boxes and footnotes preserved. Sections appear in the reader under a
**Commission guidance** block on the provisions they interpret (Article 5,
Article 6, Annex III, and the Article 3 terms they turn on), in the citation
graph, in search, and each as its own document in the contents rail. Literal mentions of
articles, annexes and recitals inside a guidance section become ordinary graph
edges. A reference to the GDPR ("Article 4(4) of Regulation (EU) 2016/679",
"Article 35 GDPR") links to that GDPR article; references to any other
instrument are recognised and left unlinked.

The only non-HTML source: these exist solely as PDFs, so
`build/parse_guidelines.py` recovers structure from typography (body text,
bold headings, 10pt footnotes, superscript markers) and re-spaces words from
each font's `/Widths` table. Section titles are taken from each document's own
contents pages, which are authoritative where the body typography is not.
Guidelines are not binding, and the drafts will change on adoption — the
reader says so on every guidance page.

## The German implementing law (KI-MIG)

The **Gesetz zur Marktüberwachung und Innovationsförderung von künstlicher
Intelligenz** (KI-MIG, BGBl. 2026 I Nr. 223, in force 29 July 2026) is the
German law that gives the Act effect nationally: it names the
Bundesnetzagentur as market surveillance authority, sets up the KI-Reallabor
(sandbox), and adds fines. Its 20 sections (`#/kimig/15`) are read from the
gesetze-im-internet.de XML export and shown **in English by default, with an
English | Deutsch toggle to the original German** on every section, with its
own document in the contents rail, a *National implementation* card on the home
page, and a **German implementing law** block on every provision of the Act a
section cites — Article 70, for instance, lists KI-MIG § 1 and § 6.

`build/parse_kimig.py` resolves the German citations itself, because the law
cites the Act, other EU regulations and a long tail of German statutes in the
same sentences. A reference links only when it is the Act's or the KI-MIG's
own:

- "Artikel 70 Absatz 1 … der Verordnung (EU) 2024/1689" → Article 70,
  paragraph 1 (`#/article/70/p1`);
- "Artikel 3 Nummer 48 der Verordnung (EU) 2024/1689" → the defined term
  itself (*national competent authority*), not all of Article 3;
- "entgegen Artikel 21 Absatz 1" in the § 15 fine catalogue, whose lead-in
  names the Regulation once for the whole list;
- "§ 2 Absatz 3" → that paragraph of the KI-MIG;
- anything followed by another instrument — "der Verordnung (EU) 2019/1020",
  "des Kreditwesengesetzes", "des Grundgesetzes" — stays plain text.

Links and graph edges come from the same resolved spans, so the page and the
graph cannot disagree. `python3 build/parse_kimig.py` prints what each section
cites.

### The English translation

The English text is an **unofficial machine translation by Claude Sonnet 5**,
not reviewed by a lawyer; only the German is authentic. The toggle on each
section says which is which — *English (translation)*, *Deutsch (original
text)* — rather than a disclaimer banner. It is a checked-in build input, not generated at build time —
`build/translations/kimig-en/NN.html` holds each section as an `<h1>` title
plus the section body in the German's own markup, and `_parts.json` the law's
title and part headings — so the build stays offline and reproducible, and a
correction is an ordinary reviewed diff.

The translator was held to the Act's official English terms (*Betreiber* is
the Act's **deployer**, *KI-Reallabor* its **AI regulatory sandbox**) and EU
citation style ("Artikel 70 Absatz 1 Satz 1" → "the first sentence of
Article 70(1)"). Because the English uses the Act's own vocabulary, it also
picks up the Act's defined-term links, which the German cannot.

Where a rendering is uncertain, the German **noun** follows it in
parentheses — "registry office (Geschäftsstelle)", "administrative
assistants (Verwaltungshelfer)" — at its first mention in a section. Only
terms get this, never whole phrases: the full German is a click away on the
toggle.

The German remains the source of truth for the graph: edges come from
resolving the German citations, and `apply_translation()` rejects any English
section whose links, paragraph ids or point markers differ from the German's
in any way, falling back to German for it. Check the files with:

```sh
python3 build/parse_kimig.py --check
```

Every visit opens in English; switching to German holds for the rest of that
tab's session. Search matches either language.

§ 15 punishes breaches of the Regulation *"in der Fassung vom 13. Juni 2024"*
— as first published — while this browser shows the Act as amended. The
section says so, and names the cited provisions that have changed since
(Article 27).

## The GDPR

**Regulation (EU) 2016/679**, the General Data Protection Regulation, is the
act the AI Act leans on most. The Act defines *personal data*, *profiling* and
*special categories of personal data* by pointing at GDPR Articles 4 and 9, and
lets deployers reuse their GDPR impact assessment (Articles 26 and 27). The
GDPR's 99 articles (`#/gdpr/35`) are read from the EUR-Lex consolidated
export. It uses the same `clg` markup as the Act, so `parse_consolidated.py`
reads it. The GDPR gets:

- its own home page (`#/gdpr`);
- its chapters in the contents rail;
- a *Related regulation* card on the Act's home page;
- a **Cited by the AI Act** block on every GDPR article that the Act, its
  recitals or the guidelines cite. Each entry opens the paragraph the citation
  sits in, highlighted, such as Article 26(9) or guideline paragraph (371). So
  do backlinks into the GDPR. The build records those paragraphs on the edge
  (`at`).

`build/parse_gdpr.py` prints what each article cites.

### How references reach it

The deflection guard used to recognise a reference to another act and drop
it. `cited_act()` in `build/parse.py` now says *which* act a reference names,
and a reference naming the GDPR lands on the GDPR:

- "Article 4, point (4), of Regulation (EU) 2016/679" → the profiling
  definition, point (4) of GDPR Article 4 (`#/gdpr/4/pt4`);
- "Article 35 GDPR", the guidelines' shorthand → GDPR Article 35, and
  "Article 9(1) GDPR" → its paragraph 1. "Article 4(4) GDPR" → point (4),
  since Article 4 numbers points, not paragraphs;
- inside the GDPR, a bare "Article 6(1)" → GDPR Article 6, paragraph 1;
- "Article 27 of Directive (EU) 2016/680", "Article 27 LED", or any other
  act outside the corpus → plain text.

`citedAct()` in `app.js` is the same test, so the links on a page are the
edges in the graph. Before, the page and the graph disagreed on shorthand
like "Article 35 GDPR" or "Article 16 TFEU". The graph dropped those
references, but the page linked them to the Act's article with the same
number. Now neither does.

### What is and isn't here

- **No recitals.** A consolidated text never reproduces the preamble, so the
  GDPR's 173 recitals would need the Official Journal export, the same way
  the Act's recitals come from `source-oj.html`.
- **The corrigendum** (OJ L 127, 23.5.2018) is worked into the text. EUR-Lex
  marks its corrections ▼C1 in eight articles. They correct the text as
  published rather than amend it, so the page doesn't mark them as changes.
  Those articles just say *as corrected*.
- **Definitions stay inside Article 4** rather than becoming term nodes. The
  Act cites them by point, and each point can be addressed. The Act's own
  defined terms aren't linked inside the GDPR: the words are the same, but
  the GDPR gives them its own meanings.
- **In the graph, the GDPR is a separate statute.** Walking from a provision
  of the Act, a GDPR article is a leaf, and the reverse holds too. So a
  neighbourhood stays inside the text you are reading.

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
- The contents rail shows one document at a time, picked from the menu at its
  top: the AI Act (with Articles · Recitals · Annexes · Terms tabs), the GDPR,
  each Commission guideline, or the KI-MIG. Picking one opens its home page. The
  rail follows the reader — opening a
  KI-MIG section switches it to the KI-MIG — and remembers the Act's tab while
  another document is showing. A new corpus is one more menu entry
  (`docList()` in `app.js`), not another tab
- Each attached document has its own home page — `#/gdpr`, `#/guidance/pp`,
  `#/guidance/hr`, `#/kimig` — reached from its name in the breadcrumb of any
  of its sections and from the cards on the Act's home page. It lists the
  document's parts, what it interprets (guidelines) or which provisions of the
  Act it cites and from which sections (KI-MIG), and the rail graph shows the
  document with everything it links to
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

The four original node-type colours (article, recital, annex, term) are a
categorical palette validated at **all pairs** in both light and dark mode for
protanopia, deuteranopia and tritanopia (worst-case ΔE 13.9 light / 10.8 dark,
OKLab ×100, Machado 2009 simulation), each clearing 3:1 against its surface.
The KI-MIG ochre/gold (`#7D5800` light / `#FEC748` dark) was chosen by the same
test against all five existing hues and the ink greys: worst case ΔE 11.5 light
/ 16.2 dark, text contrast 6.4:1 / 10.7:1. The GDPR forest green (`#17412C`
light / `#A7D8C1` dark) was chosen by the same test, searching light and dark
shades of one hue together. Its worst case against the six existing hues is
ΔE 12.8 light / 13.7 dark, in both modes against the KI-MIG ochre under
protanopia. It sits at least ΔE 8.4 from the ink greys, with text contrast
11.5:1 / 10.5:1. The guidance violet predates that
check and does not pass it — under protanopia it sits ΔE 1.9 from the article
blue — so the text labels carry that distinction. Colour never carries meaning alone — every node and connection is also
labelled in text. Dark mode uses its own validated steps rather than inverted
light ones.

Amendment state is an editorial annotation, not a fifth category, so it does not
borrow one of the four node hues: changed blocks get a rule, a tint and the word
*replaced 2026* / *inserted 2026*. Redlines use `<ins>` and `<del>` elements —
correct semantics for assistive technology — and prefix each run with `+` or `−`
so the distinction survives without colour.

## Licence

The KI-MIG is a German federal statute and, as an official work, not subject
to copyright (§ 5 UrhG); it is reproduced from
[gesetze-im-internet.de](https://www.gesetze-im-internet.de/ki-mig/).

The texts of Regulation (EU) 2024/1689, Regulation (EU) 2026/1744 and
Regulation (EU) 2016/679 are
© European Union, reproduced from [EUR-Lex](https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng);
reuse is authorised under Decision 2011/833/EU provided the source is
acknowledged. Consolidated texts carry no legal value — this is an unofficial
reading aid, and only the Official Journal text is authentic.
