# Interplay: seeing how the rules for AI in a German fintech fit together

A design for the part of the portal that shows the big picture. It is a
working document for a future session: it assumes no memory of the
conversation it came from, and it builds on `PLAN.md` (phases) and `README.md`
(what exists).

## Purpose

The portal's goal is to hold, in one place, every regulation and every piece
of guidance that applies to AI systems at a German fintech — a financial
entity supervised by BaFin — so that referring from one to another is easy.

At provision level, the browser already does this. You can read an article,
follow what it cites, see what cites it, and walk a graph of ~3,400
connections. What it does not show is the **big picture**:

- which instruments exist, at what legal level, and which authority stands
  behind each;
- how they depend on each other: one implements another, one declares
  another's obligation fulfilled, one names the supervisor for another;
- where the same obligation turns up in several instruments at once — for
  example logging, incident reporting, or outsourcing.

A provision graph cannot show this: at 3,400 edges it is a texture, not a
picture. This document proposes two views built on one data model:

1. **The instrument map** — one node per instrument, with typed relationships
   between them, each grounded in the provision that creates it.
2. **The requirement matrix** — compliance topics against instruments, each
   cell listing the provisions that address that topic.

Scenario walkthroughs (use case → chain of obligations) were considered and
are **out of scope**.

## The corpus, by legal layer

| Instrument | Layer | Status | Node ids today |
|---|---|---|---|
| Regulation (EU) 2024/1689, **AI Act** (consolidated, in force 27.07.2026) | EU regulation, horizontal | in the browser | `art_`, `rct_`, `anx_`, `def_` |
| Regulation (EU) 2026/1744, Digital Omnibus on AI | EU amending act | in (the changes page, `omr_`) | `omr_` |
| Regulation (EU) 2016/679, **GDPR** | EU regulation, horizontal | in (articles; no recitals yet) | `gdpr_` |
| Commission guidelines on prohibited practices (adopted) and on high-risk classification (draft) | EU guidance on the AI Act | in | `gdl_pp-`, `gdl_hr-` |
| **KI-MIG**, BGBl. 2026 I Nr. 223 | German law implementing the AI Act | in | `kimig_` |
| BaFin, **Guidance on ICT Risks in the Use of AI** (23.01.2026) | supervisory guidance on DORA | in | `gdl_bafin-` |
| Regulation (EU) 2022/2554, **DORA**, with RTS RMF (2024/1774), RTS Subcontracting (2025/532) and the ITS on the register of information | EU sectoral regulation and delegated acts | planned — `PLAN.md` Phase 4 | — |
| BaFin, **MaRisk**, Rundschreiben 06/2026 (BA), as of 30.06.2026 | BaFin circular | source in the repo root (`2026-06-30-rundschreiben-data.pdf`), not parsed — Phase 5 | — |

Candidates to assess later, not yet judged to belong: German data protection
law (BDSG), EBA guidelines touching model use in credit decisions, EDPB
guidance on automated decision-making. Whatever is not ingested can still
appear on the map as a muted stub (see *Instruments outside the corpus*).

## Three kinds of connection

Every connection the views show falls into one of three kinds, and a
compliance reader needs to tell them apart at a glance, because they carry
different weight.

| Kind | What it means | Where it comes from | Today |
|---|---|---|---|
| **Cited** | the text names the other provision | parsing: literal citations | `cites`, `annex`, `explains`, `uses` edges |
| **Legal effect** | one instrument changes how another applies — implements it, declares an obligation fulfilled, names the supervisor, carves an entity out | the text too, but a mention with consequences, curated as a relation with its grounding provisions | not yet |
| **Editorial** | two provisions deal with the same subject | our judgment, always with a written reason | `concords` edges (BaFin guidance → Act) |

(The recital-to-article `relates` edges are a fourth, *derived* kind, used
only inside the Act. They are not part of these views.)

Rendering rule, in both views and in the existing graph: cited = solid line;
legal effect = heavy line with a text badge naming the effect; editorial =
dashed line, labelled *editorial*, reason on hover or in a panel. Colour never
carries the distinction alone.

## View 1 — the instrument map

### What it shows

One node per instrument — about ten to twelve — laid out in fixed horizontal
bands by layer, top to bottom:

1. EU horizontal law — AI Act, GDPR
2. EU sectoral law and its delegated acts — DORA, RTS RMF, RTS Subcontracting, ITS
3. EU guidance — the Commission guidelines
4. German law — KI-MIG (later perhaps BDSG, KWG)
5. BaFin — MaRisk, the AI/ICT guidance

Authorities that the instruments name are shown as a second node shape
(round, muted): BaFin as supervisor, the Bundesnetzagentur, data protection
authorities. "Who supervises what" is part of the big picture, and the texts
say it explicitly.

A sketch with the relationships already grounded in the corpus (solid) and
those expected once DORA and MaRisk are in (dotted):

```mermaid
flowchart TB
  subgraph EU_H["EU horizontal law"]
    AIA["AI Act<br/>Reg. (EU) 2024/1689"]
    GDPR["GDPR<br/>Reg. (EU) 2016/679"]
  end
  subgraph EU_S["EU sectoral law"]
    DORA["DORA<br/>Reg. (EU) 2022/2554"]:::planned
    RTS["RTS RMF · RTS Subcontracting · ITS"]:::planned
    FSL["Union financial services law<br/>(governance rules)"]:::stub
  end
  subgraph EU_G["EU guidance"]
    COM["Commission guidelines<br/>Art. 5 · Art. 6"]
  end
  subgraph DE["German law"]
    KIMIG["KI-MIG"]
  end
  subgraph BAFIN_L["BaFin"]
    BAFING["Guidance on ICT risks in AI"]
    MARISK["MaRisk 06/2026"]:::planned
  end
  BAFIN(("BaFin<br/>supervisor")):::authority

  KIMIG -->|implements| AIA
  COM -->|interprets| AIA
  AIA -->|builds on · 26(9), 27(4), 4a| GDPR
  AIA ==>|deems fulfilled · 17(4), 18(3), 19(2), 26(5), 26(6), 72(4)| FSL
  AIA ==>|financial supervisor is market surveillance authority · 74(6)| BAFIN
  KIMIG ==>|names BaFin · § 2(3), § 6| BAFIN
  KIMIG -->|carves out DORA financial entities · § 10| DORA
  BAFING -->|cites · 3(1)| AIA
  BAFING -.->|applies| DORA
  RTS -.->|specifies| DORA
  MARISK -.->|AT 9 excludes DORA ICT third-party services · AT 4.4.2 cites 6(4)| DORA
  BAFIN --- BAFING
  BAFIN --- MARISK

  classDef planned stroke-dasharray: 4 3
  classDef stub fill:#f2f2ee,stroke-dasharray: 2 2
  classDef authority fill:#fff,stroke:#767c8a
```

### The relationships, and what grounds each

Every legal-effect edge must name the provisions that create it; clicking the
edge opens them. These are verified against the texts in the corpus:

| From → to | Relationship | Grounding provisions |
|---|---|---|
| AI Act → Union financial services law | **deems fulfilled** / folds into | Art. 17(4) quality management system deemed fulfilled by internal-governance rules (except 17(1)(g)–(i)); 18(3) technical documentation kept with the financial-services documentation; 19(2) logs kept likewise; 26(5) deployer monitoring deemed fulfilled; 26(6) deployer logs kept with that documentation; 72(4) post-market monitoring integrated for Annex III point 5 systems of financial institutions |
| AI Act → BaFin | **designates the supervisor** | Art. 74(6): for high-risk AI systems placed on the market, put into service or used by financial institutions, the market surveillance authority is the financial supervisor; 74(7) derogation, and reporting to the ECB for credit institutions in the Single Supervisory Mechanism |
| KI-MIG → BaFin | **names the authority** | § 2(3): BaFin is market surveillance authority for AI systems directly connected with a regulated financial activity; § 6: BaFin may report directly under the Act |
| KI-MIG → AI Act | **implements** | § 1 (scope) and the Act's articles its sections cite — 49 provisions, already `cites` edges |
| KI-MIG → DORA | **carves out** | § 10: certain cooperation criteria do not apply to market surveillance of financial entities within Article 2(2) of Regulation (EU) 2022/2554 |
| AI Act → GDPR | **builds on** | Art. 26(9): the deployer uses the Art. 13 information for the DPIA under GDPR Art. 35; 27(4): the fundamental rights impact assessment may rely on that DPIA; Art. 4a: processing special categories of personal data for bias detection. Plus 35 `cites` edges into GDPR Arts. 4, 6, 9, 22, 35, 36 |
| Commission guidelines → AI Act | **interprets** | the existing `interprets` edges (Art. 5, Art. 6, Annex III, Article 3 terms) |
| BaFin guidance → AI Act | cites | Art. 3(1) (the AI system definition) |
| BaFin guidance → DORA | **applies in practice** | its sections cite DORA and the RTS on nearly every line; the edge becomes grounded once DORA is parsed |
| RTS / ITS → DORA | **specifies** | their empowering articles — to read at DORA ingest |
| MaRisk → DORA | **carves out** | AT 9: outsourced or procured ICT services within Art. 3 No. 21 DORA that are subject to ICT third-party risk management under Arts. 28–30 DORA fall outside AT 9 |
| MaRisk → DORA | cites | AT 4.4.2: the compliance function may be combined with the ICT risk control function under Art. 6(4) DORA |

Two edges deserve a note:

- **"Union financial services law"** is what the AI Act's deeming clauses
  point to, not MaRisk by name. In Germany those governance rules reach an
  institution through national law and BaFin's circulars; MaRisk itself refers
  to § 25a(1) KWG, proper business organisation. Draw the stub node
  now; when MaRisk is in, add a relation from it to the stub only as far as
  its own text supports.
- **Supersession** (BAIT by DORA) is plausible but is not stated in any text
  in the corpus — MaRisk 06/2026 does not mention BAIT. Leave it off until a
  source says so.

### Aggregated citation counts

Cited-kind edges on the map are not hand-curated. The build aggregates the
provision-level edges between instruments — "GDPR ← AI Act: 35 citations into
6 articles" — and the map draws them with a thickness by count and a label on
hover. Nothing to maintain.

### Interaction

- Click an instrument → its home page (`#/`, `#/gdpr`, `#/kimig`, `#/guidance/bafin` …).
- Click an edge → a side panel: relationship kind, one-sentence explanation,
  the grounding provisions as links (paragraph-level where the relation is).
- Select an instrument → dim everything not connected to it.
- Filter by relationship family: cited / legal effect / editorial.
- Route: `#/map`. A small version on the Act's home page ("The rules at a
  glance") links to it.

### Layout

Deterministic, not force-directed: with a dozen nodes a physics layout only
adds jitter. Fixed bands, nodes ordered within a band by hand in the registry
(below), edges routed as curves. SVG, with a text equivalent (see
*Accessibility*). On narrow screens the bands stack and each instrument
becomes a card listing its relationships, which is the text equivalent shown
visibly.

## View 2 — the requirement matrix

This is the working view: it answers "where is X required, and by whom?"

### Shape

- **Rows** — compliance topics.
- **Columns** — instruments: AI Act · GDPR · DORA (+ RTS) · MaRisk · BaFin
  guidance · KI-MIG · Commission guidelines.
- **Cells** — the provisions that address that topic in that instrument, as
  linked chips (article or paragraph, e.g. `Art. 26(6)`), each with its
  qualifiers.

An empty cell must say which kind of empty it is: **not addressed** (mapped,
nothing there) or **not yet mapped** (instrument not ingested, or topic not
yet reviewed for it). The difference matters to a compliance reader, so the
column header shows each instrument's mapping status.

### The initial topics, with seed provisions

Seeded from what is in the corpus. DORA and RTS entries come from the BaFin
guidance's own citations of them, so they are grounded in a text. MaRisk
entries are **candidates from its table of contents**, to be confirmed when it
is parsed. The exceptions are those marked *(read)*, whose passages have been
checked:

- AT 4.3.4 applies to automated models, technology-based innovation and AI;
- its item 6 asks for explainability, especially for AI-like models;
- AT 9 excludes ICT services under DORA's third-party regime.

| Topic | AI Act | GDPR | DORA / RTS (from BaFin's citations) | MaRisk (candidates) | BaFin guidance | KI-MIG |
|---|---|---|---|---|---|---|
| Scope and classification | 2, 3(1), 5, 6, Annex III | 2, 3 | DORA 2 | AT 2 | I.1, I.2 | 1 |
| Governance and accountability | 17 (17(4)), 26(1)–(2) | 24 | DORA 5 | AT 3, AT 4.3.1 | II.2 | — |
| Risk management | 9, 27 | 35 | DORA 6, 8 | AT 4.3.2 | II.3 | — |
| Models and development | 11, 15(1) | 25 | RTS RMF 15–17 | AT 4.3.4 *(read)* | III.1 | — |
| Data and data governance | 10, 4a | 5, 6, 9 | RTS RMF 5–7 | — | V.2 | — |
| Testing and validation | 9(6)–(8), 15 | — | DORA 24–25, RTS RMF 16 | — | III.2 | 14 |
| Robustness and cybersecurity | 15(4)–(5) | 32 | DORA 9 | AT 7.2 | V.1 | — |
| Record-keeping and logging | 12, 18(3), 19(2), 26(6) | 30 | RTS RMF 12 | AT 6 | IV.1, V.1 | 18 |
| Monitoring in operation | 26(5), 72 | — | DORA 10 | — | IV.1 | — |
| Human oversight and automated decisions | 14, 86 | 22 | — | AT 4.3.4 item 6, explainability *(read)* | Annex | — |
| Transparency to affected persons | 13, 50 | 13–15 | — | — | — | — |
| Incidents and reporting | 73, 26(5) | 33, 34 | DORA 17, 19 | — | V.3 | 7 |
| Third parties and outsourcing | 25 | 28 | DORA 28–30, RTS Subcontracting | AT 9, not for ICT services under DORA 28–30 *(read)* | IV.2 | — |
| Business continuity | 15(4) | — | DORA 11, 12 | AT 7.3 | IV.1 | — |
| Staff competence and AI literacy | 4 | 39 | DORA 5(4), 13(6) | AT 7.1 | II.2, III.1 | — |
| Supervision and enforcement | 74(6), 99 | 83 | — | — | I | 2, 6, 15 |

Sixteen rows to start. After the first full tagging pass, merge rows whose
cells are mostly empty and split rows whose cells overflow. This table is a
seed for review, not the tags themselves: each cell entry becomes a tag with
a reason (below), and some entries will not survive that step.

### Qualifiers

Most of the AI Act's requirements bind only **high-risk** systems, and bind
providers and deployers differently; DORA's often depend on whether a system
supports **critical or important functions**. A cell that ignores this
misleads. Each tag therefore carries qualifiers, from a small fixed
vocabulary:

- **role** — provider · deployer · controller · processor · financial entity · institution
- **applies to** — all AI systems · high-risk AI systems · general-purpose AI · personal data processing · critical or important functions
- **effect** — requires · deemed fulfilled by (with the relation it refers to) · guidance only

Chips show their qualifiers as short text badges (`high-risk`, `deployer`).
Filters above the matrix narrow by role and by *applies to*, so a deployer of
a high-risk system sees only what binds it. The filter state is kept for the
session; it is not a route.

### Binding level

Column headers carry the instrument's binding level in words — regulation ·
delegated regulation · national law · BaFin circular · guidance (non-binding)
— so that a row shows at once whether an overlap is between two laws or
between a law and advice.

### Topic pages and the provision page

- `#/topic/<slug>` — one topic, every tagged provision grouped by instrument
  in reading order, each with its reason and qualifiers, and the legal-effect
  relations that touch it (e.g. under *logging*: AI Act 26(6) → deemed kept
  with the financial-services documentation).
- On every provision page, a block **Same topic in other instruments** lists
  the other provisions sharing its topics, with reasons, and a block **Legal
  effect** shows relations grounded in it. This is how the big picture reaches
  the reader who never opens the matrix.

### Export

A CSV of the matrix (topic, instrument, provision, qualifiers, reason) is
cheap from the same data and is what compliance teams will want to paste into
their own registers. Because artifacts viewers cannot download files, offer
it as a static file in `data/`, not a generated download.

## Data model

### Topic tags, not provision pairs

The BaFin concordance today maps pairs: *BaFin § V.1 ↔ AI Act Art. 15*. That
does not scale. A topic with ten provisions across instruments needs 45 pairs
to be complete, and every new provision adds a pair to each existing one.
With six or seven instruments this becomes unmaintainable and inconsistent.

Instead, **tag each provision with the topics it addresses**. Two provisions
are related when they share a topic. Ten provisions need ten tags; a new
provision needs one.

A hand-curated module, reviewed through ordinary git diffs (unlike the
one-line `data/aiact.json`):

```python
# build/topics.py

TOPICS = [
    {"slug": "logging", "name": "Record-keeping and logging",
     "note": "Recording events and keeping the records."},
    # …
]

# (provision, topic, qualifiers, reason)
TAGS = [
    ("aia:art_12", "logging",
     {"role": "provider", "applies": "high-risk"},
     "High-risk AI systems must allow the automatic recording of events."),
    ("aia:art_26/p6", "logging",
     {"role": "deployer", "applies": "high-risk"},
     "Deployers keep the logs for at least six months; financial institutions "
     "keep them with their financial-services documentation."),
    ("bafin:V.1", "logging",
     {"role": "financial entity", "applies": "all AI systems", "effect": "guidance only"},
     "Log relevant events in AI systems, protected against manipulation "
     "(Article 12 RTS RMF)."),
]
```

Rules the build enforces, loudly:

- the provision exists, and a paragraph (`/p6`) or point (`/pt4`) exists in its html;
- the topic exists; the qualifiers use the fixed vocabulary;
- the reason is non-empty and does not merely repeat the provision's title;
- a coverage report per instrument: provisions tagged / total, topics with no
  tag in an ingested instrument.

**Provision references use the namespaced form from `PLAN.md` Phase 1**
(`aia:art_26/p6`, `gdpr:art_35`, `bafin:V.1`) from the first tag written, and
the build maps them to today's ids until Phase 1 lands. Tags written in the
old id form would all have to be rewritten.

**The BaFin `CONCORDANCE`** (13 rows in `build/parse_bafin.py`) converts
directly: each row becomes a tag on the BaFin section and a tag on the Act
provision under the same topic, and its reason moves onto the tags. The
`concords` edge kind is then derived from shared topics (or retired), and
`CONCORDANCE` is deleted.

**In the graph views**, topics are optional hub nodes (off by default) with
provision–topic edges, not provision–provision edges: a topic with ten
provisions adds ten edges, not 45.

### Legal-effect relations

A second hand-curated module, one entry per relationship, each naming its
grounding provisions:

```python
# build/relations.py

# (from, to, kind, grounding provisions, explanation)
RELATIONS = [
    ("aia", "eu-fs-governance", "deems-fulfilled",
     ["aia:art_17/p4", "aia:art_18/p3", "aia:art_19/p2",
      "aia:art_26/p5", "aia:art_26/p6", "aia:art_72/p4"],
     "For financial institutions, parts of the Act's provider and deployer "
     "obligations are met through internal-governance rules and documentation "
     "under Union financial services law."),
    ("aia", "authority:bafin", "designates",
     ["aia:art_74/p6"],
     "The financial supervisor is the market surveillance authority for "
     "high-risk AI systems of financial institutions."),
    ("kimig", "authority:bafin", "designates",
     ["kimig:par_2/p3", "kimig:par_6"],
     "BaFin supervises AI systems directly connected with a regulated "
     "financial activity."),
    ("kimig", "aia", "implements", ["kimig:par_1"], "…"),
    ("kimig", "dora", "carves-out", ["kimig:par_10"], "…"),
    ("aia", "gdpr", "builds-on",
     ["aia:art_26/p9", "aia:art_27/p4", "aia:art_4a"], "…"),
]

KINDS = {
    "implements": "implements",
    "specifies": "specifies",
    "interprets": "interprets",
    "applies": "applies in practice",
    "deems-fulfilled": "deems fulfilled",
    "designates": "designates the supervisor",
    "carves-out": "carves out",
    "builds-on": "builds on",
}
```

The build checks that every grounding provision exists and that every
instrument slug is in the registry. Relations appear three ways: as map edges,
as badges in matrix cells (a *deemed fulfilled* marker on AI Act 26(5)), and
as the **Legal effect** block on the grounding provisions' pages.

### The instrument registry

`PLAN.md` Phase 1 already calls for `data/registry.json`. It becomes the node
list of the map. Per instrument:

- slug, short and full title, citation (CELEX / BGBl. / circular number), version date;
- layer (the map band) and order within it;
- binding level (regulation · delegated regulation · national law · BaFin circular · guidance);
- issuing authority;
- corpus status: *in* · *planned* · *stub*;
- source URL, and the route of its home page when in.

Authorities (`authority:bafin`, `authority:bnetza`, …) are registry entries of
their own kind.

### Instruments outside the corpus

Relations may point to instruments not ingested — "Union financial services
law", KWG, CRD. They appear on the map as muted **stub** nodes with a link to
the official source, the same idea as `PLAN.md` Phase 2's external stubs for
provisions. A stub never gets a matrix column.

### Where the data goes

`data/topics.json` (topics, tags, qualifiers) and `data/relations.json`
(registry, relations, aggregated counts) — both small. Until Phase 1 splits
the data into per-corpus files, load them with `aiact.json` at start; the
provision-page blocks need them on every page. When Phase 1 introduces
`data/xrefs.json`, tags and relations move into it.

## Placement in the interface

- **Top bar**: *Map* and *Matrix* next to *Changes* and *Graph*.
- **Routes**: `#/map`, `#/matrix`, `#/topic/<slug>`. The router's
  `parseHash` gains these three the way `#/changes` was added.
- **Home page**: the small map, above the document cards.
- **Provision pages**: the *Same topic in other instruments* and *Legal
  effect* blocks, after the existing guidance and KI-MIG blocks.
- **Graph views**: relationship-family toggles (cited / legal effect /
  editorial) and the optional topic hubs.

## Accessibility

- The matrix is a real `<table>` with `<th scope="col">` instrument headers
  and `<th scope="row">` topic headers; cells contain links, not click
  handlers on divs.
- The map's SVG has `role="img"` and a label, and the same content is on the
  page as a list — each instrument with its relationships as sentences
  ("KI-MIG names BaFin as market surveillance authority — § 2(3), § 6").
- Relationship kinds, qualifiers and binding levels are words, never colour
  alone; the three connection kinds also differ by line style.
- Narrow screens: the matrix pivots — pick a topic to list instruments, or an
  instrument to list topics — with a horizontally scrolling table and sticky
  first column as the fallback.

## Build order

1. **Registry, relations and the map** for what is already in: AI Act, GDPR,
   KI-MIG, Commission guidelines, BaFin guidance, with stubs for DORA and
   Union financial services law. Small, uses existing data, and tests whether
   legal-effect edges read well.
2. **Topics, tags and the matrix** for the same instruments, including the
   topic pages, the provision-page blocks and the CSV. Convert the BaFin
   `CONCORDANCE`. Write tags in the namespaced id form from the start.
3. **Phase 1 namespacing** (`PLAN.md`), if it has not happened by then —
   before the tag count grows further.
4. **DORA and its RTS/ITS** (Phase 4): the DORA column fills; the BaFin
   guidance's DORA references become links; *specifies* and *applies in
   practice* relations become grounded.
5. **MaRisk** (Phase 5): German, modules AT/BT/BTO; its column fills; its
   relation to DORA is written from its own text; the "Union financial
   services law" stub is connected only as far as texts support.

## Open decisions

- **Topic list** — the sixteen rows above are a seed; merge or split after
  the first tagging pass.
- **Tag granularity** — paragraph where an obligation is paragraph-specific
  (26(5) monitoring vs 26(6) logs), article otherwise.
- **Review** — tags and relations are editorial and legal-effect claims in a
  compliance tool; each should be reviewed by someone with compliance
  expertise before it ships, and the reason field makes that review possible.
- **Qualifier vocabulary** — confirm the role and *applies to* values against
  DORA's and MaRisk's own terms once they are read.
- **Stubs** — which instruments outside the corpus deserve a stub node (CRD,
  KWG, BDSG, EBA guidelines), and which are simply left off.
- **MaRisk language** — German canonical with the English translation beside
  it, as `PLAN.md` Phase 5 recommends; the matrix shows module references
  (`AT 4.3.4`), which read the same in both.
