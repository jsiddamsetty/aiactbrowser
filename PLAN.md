# Plan: extend the portal to GDPR, DORA, and BaFin (MaRisk / AI-in-ICT)

This is a working plan for a future session. It assumes no memory of prior
conversations — everything needed is written down here or in the repo.

## Where the codebase stands

The portal is a static site (vanilla JS, no build step for the frontend):

- `build/parse.py` — parses EUR-Lex Official Journal HTML (ELI/CONVEX markup)
  into nodes (articles, recitals, annexes, Article 3 definitions) and extracts
  the citation edge list (`article_refs`, `annex_refs`, `build_edges`).
- `build/parse_consolidated.py` — same, for the consolidated (amended) text.
- `build/parse_guidelines.py` — parses the Commission guidelines PDFs into
  `gdl_*` guidance nodes; `GUIDANCE_TARGETS` is a hand-curated editorial
  mapping of guidance sections to the provisions/terms they interpret.
- `build/parse_kimig.py` — parses the KI-MIG (German implementing law,
  gesetze-im-internet.de XML) into `kimig_*` section nodes. It is the first
  second corpus, added before Phase 1, so it rides the single-corpus scheme:
  its IDs are prefixed `kimig_` (not `kimig:`), it lives inside `aiact.json`,
  and its citations of the Act are plain `cites` edges. Its `resolve()` is
  already a small router for **German** citation forms ("Artikel 70 Absatz 1
  der Verordnung (EU) 2024/1689", "§ 2 Absatz 3", "Artikel 3 Nummer 48" →
  `def_48`) and the obvious starting point for MaRisk's German patterns in
  Phase 5. Phase 1 must migrate it: `kimig_2` → `kimig:par_2`, route
  `#/kimig/2` kept as a redirect.
- `build/parse_gdpr.py` — the GDPR, added ahead of Phases 1–2. Like the
  KI-MIG it rides the single-corpus scheme: `gdpr_4` ids inside `aiact.json`,
  routes `#/gdpr/4`. It runs `parse_consolidated` on the EUR-Lex consolidated
  export. Phase 1 must migrate it too: `gdpr_4` → `gdpr:art_4`.
- `build/build.py` — assembles `data/aiact.json` (the Act + graph) and
  `data/changes.json` (the Digital Omnibus redlines). Run: `python3 build/build.py`.
- `assets/app.js` — hash-routed SPA (`#/article/4`, `#/term/52`, `#/graph`…),
  route mapping lives in `ROUTE_TO_ID`/`ID_TO_ROUTE` (~line 129).
  `assets/graph.js` — the graph views. Dev server: `.claude/launch.json`
  ("aiact", port 8377) or any static server at the repo root.

Node IDs are bare and single-corpus: `art_4`, `rct_10`, `anx_III`, `def_52`,
`gdl_pp-5`, `omr_9` (omnibus recitals). Edge kinds: `cites`, `annex`, `uses`,
`explains`, `relates` (TF-IDF-derived), `interprets` (editorial).

**Recent context that matters** (commit `2438b8d`): reference extraction now
has a deflection guard, `deflected()` in `build/parse.py`. It recognizes when
"Article N …" belongs to *another* instrument and drops the edge. It knows:

- named instruments: "of Regulation (EU) 2016/679", "of Directive …",
  "of the Charter", "of the CER Delegated Regulation" — external unless the
  named act is in the corpus (`CORPUS_CELEX`: 2024/1689 is the Act, 2016/679
  the GDPR);
- the guidelines' trailing abbreviations: GDPR, LED, EUDPR, DSA, DMA, UCPD,
  CCD, ECHR, CER, TFEU, TEU, Charter (list inside `DEFLECT_RE`);
- "of that Regulation" / "thereof" — external in the Act's own text,
  self-referential in the omnibus recitals (`amending=True`).

The guard has started becoming a **router**. `cited_act()` returns which act a
reference names: `"self"`, a corpus slug, or `None`. `article_refs(…, doc=,
to=)` returns any corpus act's articles, so "Article 4(4) of Regulation (EU)
2016/679" and "Article 35 GDPR" now resolve to GDPR articles. `deflected()`
remains as the Act's yes/no view of the same test, and `app.js` mirrors the
regex (`citedAct()`) for in-text links. References to acts outside the corpus
are still discarded; those are what Phase 2 has left to do.

Known limitation to carry forward: bare contextual citations — in
`gdl_pp-3.6`, "(Articles 26 and 38 …)" and "(Article 27)" mean DSA articles
with no lexical marker — still mislink to the Act. Regex can't fix these;
Phase 2's per-section override table can.

## Phase 0 — regression guard (done: the edge diff, not unit tests)

The sources are fixed documents, so the only thing that regresses is parser
code. Decided against a `test_refs.py` suite: `build.py` now ends by listing
every edge added or dropped against the committed `data/aiact.json`
(`report_edges`), which catches the whole class of bug without hand-written
cases. Switching the deflection guard off to check it reproduces the original
profiling bug as `+ art_3 cites art_4` among 273 new edges. Review that list
before committing any parser change.

Phase 1 renames every ID, so its first build will report all edges as changed.
Compare with the prefix stripped for that one commit — the list should be
empty — then carry on as normal.

The citation forms the parsers must keep getting right, worth eyeballing in
the diff whenever `deflected()`/`article_refs` change:

- `article_refs("… as defined in Article 4, point (4), of Regulation (EU)
  2016/679")` → `[]` (the original profiling bug);
- omnibus self-references kept: "Article 4 of Regulation (EU) 2024/1689",
  and "Annex III to that Regulation" with `amending=True`;
- "of that Regulation" dropped with `amending=False`;
- abbreviations dropped: "Article 35 GDPR", "Articles 5 to 9 UCPD",
  "Article 16 TFEU", "Article 34(2) DSA", "Article 47 (Charter)";
- "AI Act" NOT dropped: "Articles 60 and 61 AI Act" → both;
- conjoined: "Article 14(4) and Article 16(3) of Regulation (EU) 2019/1020"
  → `[]`; hyphen range "Articles 6-7 UCPD" → `[]`;
- singular annex matches at all: `annex_refs("listed in Annex III")` →
  `["anx_III"]` (the `Annexes?` bug);
- lettered articles: "Article 4a" → `["art_4a"]`;
- range expansion still works: "Articles 8 to 15" → 8..15;
- … but only between the numbers "to" joins: "Articles 9 to 15 and 17 to 25"
  skips 16 (fixed with the GDPR ingest, which dropped `art_2 cites art_16`);
- routed: `article_refs("… Article 4, point (4), of Regulation (EU)
  2016/679", to="gdpr")` → `["gdpr_4"]`; "Article 35 GDPR" → `gdpr_35`;
  inside the GDPR (`doc="gdpr"`) a bare "Article 6(1)" → `gdpr_6`.

## Phase 1 — namespacing refactor (no new content)

Break the single-corpus assumptions before adding a second corpus.

1. **IDs.** Give every node a document prefix: `aia:art_4`, `aia:def_52`,
   `aia:gdl_pp-5`. Choose short slugs now: `aia`, `gdpr`, `dora`, `marisk`,
   `bafin-ai` (BaFin AI/ML supervisory notes). Simplest mechanically: keep
   parsers emitting bare IDs, add the prefix in one pass in `build.py`
   (nodes AND edge endpoints), so parsers stay reusable per corpus.
2. **Routes.** `#/gdpr/article/4`; keep the existing un-prefixed routes as
   permanent redirects to `aia` so published links don't rot. Update
   `ROUTE_TO_ID`/`ID_TO_ROUTE` and `routeOf` in `app.js`.
3. **Data files.** One file per corpus (`data/aia.json`, `data/gdpr.json`, …)
   plus `data/xrefs.json` for cross-corpus edges and `data/registry.json`
   (list of corpora: slug, celex, title, version date, counts). Load lazily
   per route; build each corpus's search index on first load. `aiact.json`
   is already 3.5 MB — do not eagerly load everything.
4. **Meta.** Per-corpus `meta` block (celex, sourceUrl, inForce) already
   exists for the AI Act; make it uniform.

Acceptance: site behaves identically for the AI Act; old URLs redirect;
`python3 build/build.py` still produces valid data; the edge diff, prefixes
stripped, is empty.

## Phase 2 — the deflection guard becomes a router; external stubs

*Partly done with the GDPR ingest: `cited_act()` routes references to acts in
the corpus. External stubs, the override table and the UI toggle remain.*

Ship this *before* ingesting new corpora — it is a visible win on its own.

1. Extend `deflected()` (or a sibling `resolve_ref()`) to return *which*
   instrument it matched, not just True/False. Build the instrument table
   once: celex/number patterns ("Regulation (EU) 2016/679" → `gdpr`) and
   abbreviations (GDPR → `gdpr`, DSA → external-stub, TFEU → external-stub).
2. References to instruments **in the corpus** become cross-corpus edges in
   `xrefs.json` (new edge kind, e.g. `xcites`), resolved to real nodes when
   the article number exists there.
3. References to instruments **outside the corpus** become stub nodes
   (`ext:dsa:art_26`): label, instrument name, deep link to EUR-Lex
   (`https://eur-lex.europa.eu/eli/reg/…` ELI URLs support article anchors).
   The ~250 references dropped by `2438b8d` reappear as labeled external
   links instead of vanishing.
4. Add the per-section override table for context-only citations (the
   `gdl_pp-3.6` DSA case): a small dict mapping (section id, article number)
   → instrument, consulted before the default "same corpus" assumption.
5. UI: render stubs distinctly (muted node style, external-link icon);
   cross-corpus edges get their own filter toggle in the graph views.

## Source materials and inputs to gather (needed from Phase 3 onward)

Phases 0–2 need nothing new. Everything below is freely downloadable — no
licensing or accounts. Follow the existing naming convention
(`build/source-<corpus>[-role].html|pdf`).

**GDPR**
- EUR-Lex HTML export of 32016R0679 — the same ELI/CONVEX HTML format as
  `build/source-oj.html` (eur-lex.europa.eu/eli/reg/2016/679/oj/eng, HTML
  version → `build/source-gdpr.html`). One file suffices: GDPR has only had
  a corrigendum, so no consolidated/omnibus pair like the AI Act.
- Optional guidance layer: EDPB (and endorsed WP29) guideline PDFs — e.g.
  automated decision-making/profiling — dropped in `build/` like the
  existing `source-guidelines-*.pdf`, each with an editorial targets table
  (which articles/terms it interprets), same as `GUIDANCE_TARGETS`.

**DORA**
- EUR-Lex HTML export of 32022R2554; check for a consolidated version at
  download time and prefer it if one exists.
- The RTS/ITS delegated regulations that matter for the compliance scope,
  each as its own EUR-Lex HTML export — e.g. ICT risk management framework,
  incident classification/reporting, third-party subcontracting. Not all
  are needed; verify current celex numbers on EUR-Lex when fetching rather
  than trusting a remembered list.

**MaRisk / BaFin**
- The current MaRisk circular PDF from bafin.de — verify which amendment is
  in force at the time (7th amendment, Rundschreiben 05/2023, as of this
  plan's writing; an 8th amendment aligning with DORA was in the pipeline).
  Also grab BaFin's English translation PDF if bilingual display is wanted.
- BaFin's AI supervisory papers: the 2021 "Big data and AI: principles for
  the use of algorithms in decision-making processes" paper (optionally the
  2018 BDAI study). Modeled like the Commission guidelines: sections plus
  editorial targets.

**Cross-cutting inputs (small but load-bearing)**
- Instrument registry entries per corpus: celex number, slug, and the
  abbreviations/citation forms its texts use — feeds the router (Phase 2).
  MaRisk needs German patterns ("Artikel 4 Absatz 4", "§ 25a KWG",
  "AT 4.3.2 Tz. 5").
- The concordance table — the one input no download provides; it is domain
  judgment. A CSV (`source_id, target_id, rationale`) grown incrementally
  is enough; the build turns it into `concords` edges. Start with ~15–20
  mappings around real compliance questions (AI Act Art 15 ↔ DORA Art 9 ↔
  MaRisk AT 7.2 territory) rather than attempting completeness.
- Editorial targets tables for every guidance-layer PDF (EDPB, BaFin AI
  papers), in the `GUIDANCE_TARGETS` pattern.

## Phase 3 — GDPR ingest (cheapest corpus, richest cross-links)

*Done, ahead of Phases 1–2.* What was built differs from the notes below:

- The source is the EUR-Lex **consolidated** export (`build/source-gdpr.html`,
  04.05.2016, corrigendum worked in), so there are **no recitals** yet. They
  need the OJ export, as the AI Act's do.
- Article 4's definitions stay inside the article as addressable points
  (`#/gdpr/4/pt4`), not as term nodes.
- The corrigendum's ▼C1 marks are stripped rather than shown as amendments.

Payoff checked: `def_52` (profiling) cites `gdpr_4`. The Act's texts make 35
references into 6 GDPR articles: 4, 6, 9, 22, 35 and 36. EDPB guidance is still
to do.

- Source: EUR-Lex CONVEX HTML for 32016R0679, same markup `parse.py` reads.
  GDPR has 99 articles, 173 recitals, no annexes; definitions live in
  Article 4 (not Article 3 — parameterize `parse_definitions`, which
  currently hardcodes `art_3`, and the definitions count/ID scheme).
- Loosen `build.py`/`parse.py` sanity checks that hardcode AI Act counts
  (119 articles, 180 recitals) — make them per-corpus expectations.
- `SELF_CELEX` must become per-corpus: inside the GDPR text, "this
  Regulation" is the GDPR and "Regulation (EU) 2016/679" is a
  self-reference, while "Regulation (EU) 2024/1689" would be external.
- Guidance layer analog: EDPB guidelines (PDFs, like the Commission
  guidelines). Optional in this phase; the `parse_guidelines.py` +
  `GUIDANCE_TARGETS` pattern is the template.
- Payoff to verify: `aia:def_52` (profiling) now cross-cites `gdpr:art_4`;
  likewise personal data (def_50), biometric data, DPIA references in
  Articles 26/27, and the many recital mentions.

## Phase 4 — DORA ingest

- Source: 32022R2554, same EUR-Lex markup. Definitions in Article 3
  (64 terms). Check whether a consolidated version differs from the OJ text.
- DORA's delegated RTS/ITS regulations are its "guidance layer": separate
  celex numbers, also on EUR-Lex, fit the guidance node slot with
  `interprets` edges to the DORA articles they implement.
- Add DORA to the instrument table so AI Act ↔ DORA references route.

## Phase 5 — MaRisk and BaFin AI/ICT (the hard one)

Different in kind from the EUR-Lex corpora; budget the most time here.

- **Structure:** MaRisk is a BaFin circular organized in modules
  (AT 1, AT 4.3.2, BT 1.2 …) with numbered items and explanatory notes
  ("Erläuterungen") — not articles/recitals. Add a `module` node type; IDs
  like `marisk:AT-4.3.2`. The two-column layout (requirement | explanation)
  should map to text + an attached note, similar to how guidance sections
  carry provision text today.
- **Language:** official text is German; BaFin publishes English
  translations that lag. Decision needed (recommendation: German canonical,
  store the English translation alongside when available, UI toggle later).
  Citation extraction needs German patterns: "§ 25a KWG",
  "Artikel 4 Absatz 4", "AT 4.3.2 Tz. 5".
- **Scope decision:** BAIT was largely superseded by DORA (2025). Decide
  whether to include it as a historical layer or start from current MaRisk
  (recommendation: current MaRisk only, note BAIT's supersession in meta).
- **BaFin AI material:** the "Big Data and AI: supervisory principles"
  papers are prose PDFs — model them like the Commission guidelines
  (sections + editorial targets), not like a statute.
- **Concordance:** cross-framework links here are editorial, not textual —
  MaRisk rarely cites the AI Act and vice versa. Create
  `build/concordance.py` (or a data file) hand-mapping related requirements,
  e.g. `aia:art_15` (robustness/cybersecurity) ↔ `dora:art_9` (ICT risk
  management) ↔ `marisk:AT-7.2` (IT resources). New edge kind `concords`
  with a short human-written rationale string per edge, rendered as
  "related requirement" — never presented as a citation. This table is the
  actual product for compliance research; grow it incrementally.

## Portal improvements independent of the extension

- Paragraph permalinks: article HTML already carries
  `<section class="para" data-para="N">` anchors; expose `#/article/26/p9`.
- Applicability timeline: amendment status exists (changes.json); GDPR/DORA
  add staggered application dates suiting the same treatment.
- Search: currently substring over a per-node haystack; per-corpus indexes
  are required by Phase 1 anyway — consider adding term-boosted ranking.

## Ordering and effort (rough)

0. Regression guard — done (edge diff in `build.py`).
1. Namespacing — medium refactor, touches build + app.js routing.
2. Router + stubs — medium, mostly `parse.py`/`build.py`, small UI additions.
3. GDPR — done for the articles; recitals and EDPB guidance remain.
4. DORA — small-medium.
5. MaRisk/BaFin — large (new parser, language, editorial concordance).

Each phase ends with: `python3 build/build.py` clean, its edge diff read and
every added or dropped edge accounted for, and a browser check of the profiling term (`#/term/52` → after Phase 1,
`#/aia/term/52`), which has been the canary throughout.
