/* ============================================================
   AI Act Browser — application
   ============================================================ */

(function () {
  "use strict";

  var DATA = null;
  var N = {};            // id -> node
  var OUT = {};          // id -> [edge]
  var IN = {};           // id -> [edge]
  var EDGES = [];        // aggregated runtime edges; corpus documents stay immutable
  var TERM_RE = null;    // defined terms, longest first
  var TERM_BY_KEY = {};
  var SEARCH = [];
  var REGISTRY = { corpora: [] }, XREFS = { nodes: [], edges: [], relations: [] };
  var TOPICS = { topics: [], tags: [] }, RELATIONS = { registry: [], relations: [] };
  var CORPUS_DOCS = {}, LOADS = {};

  var TYPES = ["article", "recital", "annex", "definition", "guidance", "kimig", "gdpr", "module", "external"];
  var ALL_TYPES = { article: true, recital: true, annex: true, definition: true, guidance: true, kimig: true, gdpr: true, module: true, external: true };
  var TYPE_LABEL = { article: "Articles", recital: "Recitals", annex: "Annexes", definition: "Terms", guidance: "Guidance", kimig: "KI-MIG", gdpr: "GDPR", module: "MaRisk", external: "External" };
  var KIND_LABEL = {
    cites: "cites", annex: "annex", uses: "defined term",
    explains: "cites", relates: "topical", interprets: "interprets", concords: "related", xcites: "cross-citation"
  };

  var state = {
    route: null,
    depth: 1,
    show: Object.assign({}, ALL_TYPES),
    ovShow: Object.assign({}, ALL_TYPES),
    edgeShow: { cited: true, cross: true, editorial: true, derived: true },
    ovView: "graph",
    ovFocus: null,          // provision the expanded graph is centred on
    ovScope: "all",         // "focus" | "all"
    ovDepth: 1
  };

  var el = {};
  var mini = null, full = null;

  /* The KI-MIG reads in English by default, with the German original a click
     away. The choice lasts for the tab's session only, so a new visit always
     opens in English. A section with no checked translation only has German. */
  var kimigLang = "en";
  try { if (sessionStorage.getItem("aiact-kimig-lang") === "de") kimigLang = "de"; } catch (e) {}

  function inGerman(n) { return n.type === "kimig" && (kimigLang === "de" || n.lang !== "en"); }
  function kField(n, f) { return inGerman(n) && n[f + "De"] != null ? n[f + "De"] : n[f]; }
  // Node type describes a provision (article, recital, guidance); corpus
  // describes the instrument it belongs to. Counts about an instrument must
  // always use the latter — GDPR, for example, has article and recital types.
  function corpusOf(n) {
    return n && (n.corpus || (n.id && n.id.indexOf(":") > 0 ? n.id.split(":")[0] : "aia"));
  }

  function nodeTitle(n, max) {
    if (n.type === "definition") return n.term;
    if (n.type === "kimig") return kField(n, "title");
    return n.title || lede(n.text, max);
  }

  /* ── boot ─────────────────────────────────────────────────── */

  function $(s) { return document.querySelector(s); }

  document.addEventListener("DOMContentLoaded", function () {
    el.doc = $("#doc"); el.toc = $("#toc"); el.conn = $("#conn");
    el.q = $("#q"); el.results = $("#results");
    el.legend = $("#legend"); el.tip = $("#tip");
    el.overlay = $("#overlay"); el.ovFilters = $("#ov-filters");
    el.gempty = $("#gempty"); el.ovSub = $("#ov-sub");

    initTheme();
    wireChrome();

    Promise.all([json("/data/aia.json"), json("/data/registry.json"),
                 json("/data/xrefs.json"), json("/data/topics.json"), json("/data/relations.json")])
      .then(function (parts) {
        REGISTRY = parts[1]; XREFS = parts[2]; TOPICS = parts[3]; RELATIONS = parts[4];
        CORPUS_DOCS.aia = parts[0];
        start(parts[0]);
      })
      .catch(function (err) {
        el.doc.innerHTML =
          '<div class="boot"><p><strong>The Act could not be loaded.</strong></p>' +
          '<p>' + esc(String(err.message || err)) + '</p>' +
          '<p>Run <code>python3 build/build.py</code> to regenerate the corpus data.</p></div>';
      });
  });

  function json(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + ": HTTP " + r.status); return r.json(); });
  }

  function start(data) {
    DATA = data;
    ["articles", "recitals", "annexes", "definitions", "guidance", "guidanceDocs",
     "kimig", "kimigParts", "gdpr", "gdprChapters"].forEach(function (key) {
      if (!DATA[key]) DATA[key] = [];
    });
    index();
    buildToc();
    buildLegend();
    buildOverlayFilters();

    mini = new Graph($("#gmini"), {
      labelMode: "auto",
      pinFocus: true,
      onSelect: function (n) { go(routeOf(n.id)); },
      onHover: tipFor
    });
    full = new Graph($("#gfull"), {
      labelMode: "auto",
      dimFocus: false,
      onSelect: function (n) { closeOverlay(); go(routeOf(n.id)); },
      onHover: tipFor
    });

    window.addEventListener("resize", debounce(function () {
      mini.resize();
      if (!el.overlay.hidden) full.resize();
    }, 160));

    window.addEventListener("hashchange", renderAsync);
    renderAsync();
  }

  function index() {
    N = {}; OUT = {}; IN = {}; SEARCH = [];
    var all = [], loadedIds = {};
    Object.keys(CORPUS_DOCS).forEach(function (slug) {
      var doc = CORPUS_DOCS[slug];
      ["articles", "recitals", "annexes", "definitions", "guidance", "kimig", "gdpr", "modules"].forEach(function (key) {
        (doc[key] || []).forEach(function (node) { all.push(node); loadedIds[node.id] = 1; });
      });
    });
    (XREFS.nodes || []).forEach(function (node) { if (!loadedIds[node.id]) all.push(node); });
    all.forEach(function (n) { N[n.id] = n; OUT[n.id] = []; IN[n.id] = []; });

    EDGES = [];
    Object.keys(CORPUS_DOCS).forEach(function (slug) {
      EDGES = EDGES.concat(CORPUS_DOCS[slug].edges || []);
    });
    EDGES = EDGES.concat(XREFS.edges || []);
    EDGES.forEach(function (e) {
      if (!N[e.s] || !N[e.t]) return;
      OUT[e.s].push(e);
      IN[e.t].push(e);
    });

    // Defined terms, longest first so "high-risk AI system" wins over "AI system".
    var terms = DATA.definitions
      .filter(function (d) { return d.term.length >= 6; })
      .slice()
      .sort(function (a, b) { return b.term.length - a.term.length; });
    terms.forEach(function (d) { TERM_BY_KEY[d.term.toLowerCase()] = d; });
    if (terms.length) {
      TERM_RE = new RegExp(
        "\\b(" + terms.map(function (d) { return escRe(d.term); }).join("|") + ")(s|es)?\\b",
        "gi"
      );
    }

    SEARCH = all.map(function (n) {
      return {
        id: n.id, type: n.type, label: n.label, title: n.title || "",
        hay: (n.label + " " + (n.title || "") + " " + (n.titleDe || "") + " " +
          n.text + " " + (n.textDe || "")).toLowerCase(),
        // Cross-corpus endpoints are deliberately lightweight and may not
        // carry a full text field. Their label remains a useful result and
        // must never make snippet rendering fail.
        text: n.textDe ? n.text + " · " + n.textDe : (n.text || n.title || n.label || "")
      };
    });
  }

  function mergeCorpus(slug, doc) {
    CORPUS_DOCS[slug] = doc;
    if (slug === "gdpr") {
      DATA.gdpr = doc.gdpr || []; DATA.gdprMeta = doc.meta || {}; DATA.gdprChapters = doc.gdprChapters || [];
    } else if (slug === "kimig") {
      DATA.kimig = doc.kimig || []; DATA.kimigMeta = doc.meta || {}; DATA.kimigParts = doc.kimigParts || [];
    } else if (slug === "bafin-ai") {
      DATA.guidance = (DATA.guidance || []).concat(doc.guidance || []);
      DATA.guidanceDocs = (DATA.guidanceDocs || []).concat(doc.guidanceDocs || []);
    }
    index();
    syncRailHead(); paintToc();
  }

  function loadCorpus(slug) {
    if (!slug || slug === "aia" || CORPUS_DOCS[slug]) return Promise.resolve();
    if (LOADS[slug]) return LOADS[slug];
    var entry = (REGISTRY.corpora || []).filter(function (x) { return x.slug === slug && x.dataFile; })[0];
    if (!entry) return Promise.resolve();
    LOADS[slug] = json(entry.dataFile).then(function (doc) { mergeCorpus(slug, doc); });
    return LOADS[slug];
  }

  function routeCorpus() {
    var bits = (location.hash || "#/aia").replace(/^#\/?/, "").split("/");
    if (bits[0] === "map") return null;
    if (bits[0] === "changes" || bits[0] === "graph" || !bits[0]) return "aia";
    if ({ article: 1, recital: 1, annex: 1, term: 1, guidance: 1, kimig: 1, gdpr: 1 }[bits[0]]) return bits[0] === "gdpr" ? "gdpr" : bits[0] === "kimig" ? "kimig" : "aia";
    return bits[0];
  }

  function renderAsync() {
    var slug = routeCorpus();
    loadCorpus(slug).then(render).catch(function (err) {
      el.doc.innerHTML = '<div class="boot"><p><strong>The document could not be loaded.</strong></p><p>' + esc(err.message) + '</p></div>';
    });
  }

  /* ── routing ──────────────────────────────────────────────── */

  var ROUTE_TO_ID = { article: "art_", recital: "rct_", annex: "anx_", term: "def_", guidance: "gdl_", section: "par_", module: "module_" };
  var ID_TO_ROUTE = { art_: "article", rct_: "recital", anx_: "annex", def_: "term", gdl_: "guidance", par_: "section", module_: "module", omr_: "recital" };

  function routeOf(id) {
    if (id.indexOf("ext:") === 0) return (N[id] && N[id].externalUrl) || "#/map";
    var split = id.split(":"), corpus = split.shift(), local = split.join(":");
    var p = Object.keys(ID_TO_ROUTE).filter(function (prefix) { return local.indexOf(prefix) === 0; })[0];
    return "#/" + corpus + "/" + (ID_TO_ROUTE[p] || "node") + "/" + encodeURIComponent(local.slice((p || "").length));
  }

  function parseHash() {
    var h = (location.hash || "#/").replace(/^#\/?/, "");
    if (!h || h === "aia") return { kind: "home" };
    var bits = h.split("/");
    if (bits[0] === "guidance") {
      if (bits[1] && bits[1].indexOf("bafin") === 0) {
        var bsec = bits[1].replace(/^bafin-?/, "");
        location.replace(bsec ? "#/bafin-ai/guidance/" + bsec : "#/bafin-ai");
      } else {
        location.replace("#/aia/guidance/" + (bits[1] || "pp"));
      }
      return { kind: "loading" };
    }
    if (bits[0] === "map") return { kind: "map" };
    if (bits[0] === "matrix" || bits[0] === "topic") {
      location.replace("#/map");
      return { kind: "loading" };
    }
    if (bits[0] === "graph") {
      var gf = bits[1] ? decodeURIComponent(bits[1]) : null;
      return { kind: "graph", focus: gf && N[gf] ? gf : null };
    }
    if (bits[0] === "changes") return { kind: "changes", focus: bits[1] || null };
    if (bits[0] === "aia" && bits[1] === "guidance" && bits[2] && guidanceDoc(bits[2])) {
      if (bits[2].indexOf("-") < 0) return { kind: "doc", doc: "gdl-" + bits[2] };
    }
    // Permanent redirects for the routes published before namespacing.
    if ({ article: 1, recital: 1, annex: 1, term: 1 }[bits[0]] && bits[1]) {
      location.replace("#/aia/" + bits[0] + "/" + bits[1] + (bits[2] ? "/" + bits[2] : ""));
      return { kind: "loading" };
    }
    if ((bits[0] === "gdpr" || bits[0] === "kimig") && bits[1] && !ROUTE_TO_ID[bits[1]]) {
      location.replace("#/" + bits[0] + "/" + (bits[0] === "gdpr" ? "article" : "section") + "/" + bits[1] + (bits[2] ? "/" + bits[2] : ""));
      return { kind: "loading" };
    }
    var corpus = bits[0];
    if (!bits[1]) {
      var entry = registryEntry(corpus);
      return entry && entry.menu === false ? { kind: "map" } : CORPUS_DOCS[corpus] ? { kind: "doc", doc: corpus } : { kind: "home" };
    }
    var pref = ROUTE_TO_ID[bits[1]];
    if (!pref || !bits[2]) return { kind: "doc", doc: corpus };
    var id = corpus + ":" + pref + decodeURIComponent(bits[2]);
    if (!N[id]) return { kind: "home" };
    return { kind: "node", id: id, para: bits[3] || null };
  }

  function docRoute(doc) {
    if (doc.indexOf("gdl-") === 0) return "#/aia/guidance/" + doc.slice(4);
    return "#/" + doc;
  }

  /* The hash that reopens a route — where closing the graph overlay returns. */
  function hashOf(route) {
    if (!route) return "#/";
    if (route.kind === "map") return "#/map";
    if (route.kind === "changes") return "#/changes" + (route.focus ? "/" + encodeURIComponent(route.focus) : "");
    if (route.kind === "doc") return docRoute(route.doc);
    return route.id ? routeOf(route.id) : "#/";
  }

  function go(hash) {
    if (/^https?:\/\//.test(hash)) { window.open(hash, "_blank", "noopener"); return; }
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  function render() {
    var r = parseHash();
    if (r.kind === "loading") return;

    if (r.kind === "graph") {
      // Opening a focused graph URL cold: render the provision behind the
      // overlay so closing it lands on the article, not the home page.
      if (r.focus && (!state.route || state.route.id !== r.focus)) {
        state.route = { kind: "node", id: r.focus };
        renderNode(N[r.focus], null);
        renderGraphFor(r.focus);
        followToc(N[r.focus]);
        markToc(r.focus);
      } else if (!state.route) {
        state.route = { kind: "home" };
        renderHome();
      }
      openOverlay(r.focus);
      syncPrimaryNav("graph");
      return;
    }
    if (!el.overlay.hidden) closeOverlay(true);

    state.route = r;
    closeRails();
    document.body.classList.toggle("portal-wide", r.kind === "map" || r.kind === "changes");
    document.body.classList.toggle("changes-wide", r.kind === "changes");
    syncPrimaryNav(r.kind);

    if (r.kind === "map") {
      renderMap(); renderGraphFor(null); el.conn.innerHTML = ""; markToc(null);
      document.title = "Interaction map — AI Act Browser";
    } else if (r.kind === "changes") {
      renderChanges(r.focus);
      renderGraphFor(null);
      el.conn.innerHTML = "";
      markToc(null);
      document.title = "What changed in 2026 — AI Act Browser";
    } else if (r.kind === "home") {
      renderHome();
      renderGraphFor(null);
      el.conn.innerHTML = "";
      showInToc("aia", tocTab);
      markToc(null);
      document.title = "AI Act Browser — Regulation (EU) 2024/1689";
    } else if (r.kind === "doc") {
      renderDocHome(r.doc);
      renderGraphFor(null);
      el.conn.innerHTML = "";
      showInToc(r.doc, tocTab);
      markToc(null);
      document.title = docTitle(r.doc) + " — AI Act Browser";
    } else {
      renderNode(N[r.id], r.para);
      renderGraphFor(r.id);
      followToc(N[r.id]);
      markToc(r.id);
      document.title = N[r.id].label + " — AI Act Browser";
    }
    el.doc.parentNode.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  function syncPrimaryNav(kind) {
    var map = $("#btn-map"), changes = $("#btn-changes"), graph = $("#btn-graph");
    [map, changes].forEach(function (item) {
      item.classList.remove("is-current");
      item.removeAttribute("aria-current");
    });
    if (kind === "map") { map.classList.add("is-current"); map.setAttribute("aria-current", "page"); }
    if (kind === "changes") { changes.classList.add("is-current"); changes.setAttribute("aria-current", "page"); }
    graph.setAttribute("aria-pressed", kind === "graph" || !el.overlay.hidden ? "true" : "false");
  }

  /* ── contents rail ────────────────────────────────────────── */

  /* The rail shows one document at a time: the Act, split into its parts by
     the tabs, or one of the documents attached to it. tocTab is remembered
     while another document is showing, so coming back lands where you were. */
  var tocDoc = "aia", tocTab = "act";
  var TAB_FOR = { article: "act", recital: "recitals", annex: "annexes", definition: "defs" };

  function docList() {
    var instruments = (REGISTRY.corpora || []).filter(function (entry) {
      return entry.kind === "instrument" && entry.status === "in" && entry.dataFile && entry.menu !== false && entry.slug !== "commission-guidance";
    }).map(function (entry) {
      return { id: entry.slug, group: entry.layer, type: entry.slug === "gdpr" ? "gdpr" :
        entry.slug === "kimig" ? "kimig" : entry.slug === "marisk" ? "module" :
        entry.bindingLevel.indexOf("guidance") >= 0 ? "guidance" : "article",
        name: entry.shortTitle, sub: entry.citation || entry.bindingLevel,
        badge: entry.bindingLevel.indexOf("guidance") >= 0 ? "non-binding" : "in force" };
    });
    var guidance = [];
    (DATA.guidanceDocs || []).filter(function (d) { return d.authority !== "BaFin"; }).forEach(function (d) {
      guidance.push({ id: "gdl-" + d.slug, group: "EU guidance", type: "guidance", name: d.name,
                      sub: d.draft ? "Draft guidelines" : "Guidelines", badge: d.draft ? "draft" : "adopted", draft: d.draft });
    });
    var ordered = instruments.concat(guidance);
    var order = ["aia", "gdl-pp", "gdl-hr", "kimig", "marisk", "bafin-ai", "gdpr", "dora", "dora-rts-rmf"];
    ordered.forEach(function (entry) { if (entry.id === "kimig") entry.name = "KI-MIG"; });
    return ordered.sort(function (a, b) {
      var ai = order.indexOf(a.id), bi = order.indexOf(b.id);
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    });
  }

  function docTitle(doc) {
    if (doc === "kimig") return (DATA.kimigMeta || {}).abbr || "KI-MIG";
    if (doc === "gdpr") return "GDPR";
    var d = doc.indexOf("gdl-") === 0 && guidanceDoc(doc.slice(4));
    if (d) return d.title;
    var entry = registryEntry(doc);
    return entry ? entry.shortTitle : doc;
  }

  function docOf(n) {
    if (n.type === "guidance" && n.corpus === "aia") return "gdl-" + n.doc;
    if (corpusOf(n) !== "aia") return corpusOf(n);
    if (n.type === "kimig") return "kimig";
    if (n.type === "gdpr") return "gdpr";
    return "aia";
  }

  /* Follow the reader: opening a recital switches the rail to the recital
     list, opening a KI-MIG section to the KI-MIG. */
  function followToc(n) { showInToc(docOf(n), TAB_FOR[n.type] || tocTab); }

  function showInToc(doc, tab) {
    if (doc === tocDoc && tab === tocTab) return;
    tocDoc = doc; tocTab = tab;
    syncRailHead();
    paintToc();
  }

  function buildToc() {
    el.docBtn = $("#doc-btn"); el.docMenu = $("#doc-menu"); el.railTabs = $("#rail-tabs");

    el.railTabs.querySelectorAll(".rail-tab").forEach(function (b) {
      b.addEventListener("click", function () {
        tocTab = b.dataset.tab;
        syncRailHead();
        paintToc();
        markToc(state.route && state.route.id);
      });
      b.addEventListener("keydown", function (ev) {
        var tabs = [].slice.call(el.railTabs.querySelectorAll(".rail-tab"));
        var at = tabs.indexOf(b), next = null;
        if (ev.key === "ArrowRight" || ev.key === "ArrowDown") next = (at + 1) % tabs.length;
        else if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") next = (at - 1 + tabs.length) % tabs.length;
        else if (ev.key === "Home") next = 0;
        else if (ev.key === "End") next = tabs.length - 1;
        if (next !== null) {
          ev.preventDefault();
          tabs[next].focus();
          tabs[next].click();
        }
      });
    });

    el.docBtn.addEventListener("click", function () {
      if (el.docMenu.hidden) openDocMenu(); else closeDocMenu(false);
    });
    el.docBtn.addEventListener("keydown", function (ev) {
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); openDocMenu(); }
    });
    el.docMenu.addEventListener("keydown", docMenuKey);
    el.docMenu.addEventListener("click", function (ev) {
      var o = ev.target.closest(".doc-opt");
      if (!o) return;
      // Consume clicks on nested labels and badges here, before the document
      // click handler closes the picker, then route through the app router.
      ev.preventDefault();
      ev.stopPropagation();
      chooseDoc(o.dataset.doc);
    });
    document.addEventListener("click", function (ev) {
      if (!el.docMenu.hidden && !ev.target.closest("#doc-pick")) closeDocMenu(false);
    });

    syncRailHead();
    paintToc();
  }

  function docFace(d) {
    return '<span class="doc-dot" data-type="' + d.type + '"></span>' +
      '<span class="doc-face"><b>' + esc(d.name) + '</b><span class="doc-sub"><i>' + esc(d.sub) + "</i>" +
      (d.badge ? '<span class="gdoc-badge" data-draft="' + (d.draft ? "1" : "0") + '">' +
        esc(d.badge) + "</span>" : "") + "</span></span>";
  }

  function syncRailHead() {
    var d = docList().filter(function (x) { return x.id === tocDoc; })[0];
    el.docBtn.innerHTML = docFace(d) +
      '<svg class="doc-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
    el.docBtn.setAttribute("aria-label", "Contents of " + d.name + " — open another document");
    var act = tocDoc === "aia";
    el.railTabs.hidden = !act;
    el.docBtn.parentNode.classList.toggle("is-alone", !act);
    el.railTabs.querySelectorAll(".rail-tab").forEach(function (b) {
      var on = b.dataset.tab === tocTab;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    });
  }

  function openDocMenu() {
    var h = "", group = null;
    docList().forEach(function (d) {
      if (d.group !== group) {
        if (group !== null) h += "</div>";
        group = d.group;
        h += '<div role="group" aria-label="' + esc(group) + '">' +
          '<div class="doc-group" aria-hidden="true">' + esc(group) + "</div>";
      }
      h += '<div class="doc-opt" role="option" tabindex="-1" data-doc="' + d.id + '"' +
        ' aria-label="' + esc(d.name + ", " + d.sub + (d.badge ? ", " + d.badge : "")) + '"' +
        ' aria-selected="' + (d.id === tocDoc) + '">' + docFace(d) + "</div>";
    });
    el.docMenu.innerHTML = h + "</div>";
    el.docMenu.hidden = false;
    el.docBtn.setAttribute("aria-expanded", "true");
    el.docMenu.querySelector('[aria-selected="true"]').focus();
  }

  function closeDocMenu(refocus) {
    el.docMenu.hidden = true;
    el.docBtn.setAttribute("aria-expanded", "false");
    if (refocus) el.docBtn.focus();
  }

  /* Picking a document opens its home page; render() brings the rail along. */
  function chooseDoc(id) {
    closeDocMenu(true);
    if (id !== tocDoc) el.toc.scrollTop = 0;
    // Route explicitly instead of relying on the menu item's default browser
    // behaviour. This also makes lazily loaded corpora such as GDPR reliable.
    go(id === "aia" ? "#/" : docRoute(id));
  }

  function docMenuKey(ev) {
    var opts = [].slice.call(el.docMenu.querySelectorAll(".doc-opt"));
    var at = opts.indexOf(document.activeElement);
    var to = null;
    if (ev.key === "ArrowDown") to = Math.min(at + 1, opts.length - 1);
    else if (ev.key === "ArrowUp") to = Math.max(at - 1, 0);
    else if (ev.key === "Home") to = 0;
    else if (ev.key === "End") to = opts.length - 1;
    else if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      if (at >= 0) chooseDoc(opts[at].dataset.doc);
      return;
    } else if (ev.key === "Escape") {
      // Close the menu only — not the drawer it sits in.
      ev.preventDefault(); ev.stopPropagation();
      closeDocMenu(true);
      return;
    } else if (ev.key === "Tab") {
      closeDocMenu(false);
      return;
    }
    if (to !== null) { ev.preventDefault(); opts[to].focus(); }
  }

  function paintToc() {
    var h = "";

    if (tocDoc === "aia" && tocTab === "act") {
      h = chapterToc(DATA.chapters, DATA.articles);
    } else if (tocDoc === "gdpr") {
      h = chapterToc(DATA.gdprChapters, DATA.gdpr);
    } else if (CORPUS_DOCS[tocDoc] && CORPUS_DOCS[tocDoc].articles) {
      h = chapterToc(CORPUS_DOCS[tocDoc].chapters || [], CORPUS_DOCS[tocDoc].articles || []);
    } else if (tocDoc === "aia" && tocTab === "recitals") {
      DATA.recitals.forEach(function (r) {
        h += tocLink(r.id, String(r.num), lede(r.text, 70));
      });
    } else if (tocDoc === "aia" && tocTab === "annexes") {
      DATA.annexes.forEach(function (a) {
        h += tocLink(a.id, a.roman, a.title);
      });
    } else if (tocDoc.indexOf("gdl-") === 0) {
      // One guidelines document, grouped the way its own contents page groups it.
      var slug = tocDoc.slice(4), seenPart = null;
      DATA.guidance.filter(function (g) { return g.doc === slug; }).forEach(function (g) {
        if (g.part !== seenPart) {
          if (seenPart !== null) h += "</div></div>";
          seenPart = g.part;
          h += '<div class="chap"><button class="chap-btn" type="button">' +
            '<span class="chap-name">' + esc(g.part) + "</span>" +
            '<svg class="chap-caret" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>' +
            "</button>" + '<div class="chap-list">';
        }
        h += tocLink(g.id, "§ " + g.sec, g.title);
      });
      if (seenPart !== null) h += "</div></div>";
    } else if (tocDoc === "kimig") {
      var de = kimigLang === "de";
      (DATA.kimigParts || []).forEach(function (p) {
        var secs = (DATA.kimig || []).filter(function (s) { return s.part === p.label; });
        h += '<div class="chap"><button class="chap-btn" type="button">' +
          '<span class="chap-num">' + p.num + '</span>' +
          '<span class="chap-name"' + (de && p.titleDe ? ' lang="de"' : "") + ">" +
          esc(de && p.titleDe ? p.titleDe : p.title) + '</span>' +
          '<svg class="chap-caret" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>' +
          '</button><div class="chap-list">';
        var seenSub = null;
        secs.forEach(function (s) {
          if (s.sub && s.sub !== seenSub) {
            seenSub = s.sub;
            h += '<div class="sec-name">' + esc(kField(s, "sub")) + ' · ' +
              esc(kField(s, "subTitle") || "") + "</div>";
          }
          h += tocLink(s.id, "§ " + s.key, kField(s, "title"));
        });
        h += "</div></div>";
      });
    } else if (tocDoc === "marisk") {
      (CORPUS_DOCS.marisk.modules || []).forEach(function (m) { h += tocLink(m.id, m.key, m.title); });
    } else if (tocDoc === "bafin-ai") {
      (CORPUS_DOCS["bafin-ai"].guidance || []).forEach(function (g) { h += tocLink(g.id, "§ " + g.sec, g.title); });
    } else {
      DATA.definitions.forEach(function (d) {
        h += tocLink(d.id, String(d.num), d.term);
      });
    }

    el.toc.innerHTML = h;

    el.toc.querySelectorAll(".chap-btn").forEach(function (b) {
      b.addEventListener("click", function () { b.parentNode.classList.toggle("is-open"); });
    });
    el.toc.querySelectorAll(".tl").forEach(function (b) {
      b.addEventListener("click", function () { go(routeOf(b.dataset.id)); });
    });
  }

  /* A regulation's articles under its chapters and sections. */
  function chapterToc(chapters, articles) {
    var h = "";
    chapters.forEach(function (c) {
      var arts = articles.filter(function (a) { return a.chapter === c.roman; });
      h += '<div class="chap" data-chap="' + c.roman + '">' +
        '<button class="chap-btn" type="button">' +
        '<span class="chap-num">' + esc(c.roman) + '</span>' +
        '<span class="chap-name">' + esc(c.title) + '</span>' +
        '<svg class="chap-caret" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>' +
        '</button><div class="chap-list">';

      var seenSection = null;
      arts.forEach(function (a) {
        if (a.sectionLabel && a.sectionLabel !== seenSection) {
          seenSection = a.sectionLabel;
          h += '<div class="sec-name">' + esc(a.sectionLabel) + ' · ' + esc(a.sectionTitle || "") + "</div>";
        }
        h += tocLink(a.id, "Art. " + artKey(a), a.title, a.status);
      });
      h += "</div></div>";
    });
    return h;
  }

  function tocLink(id, num, name, status) {
    return '<button class="tl" type="button" data-id="' + id + '">' +
      '<span class="tl-num">' + esc(num) + '</span>' +
      '<span class="tl-name">' + esc(name || "") + "</span>" +
      (status ? '<span class="tl-chg" data-status="' + status + '" title="' +
        esc(STATUS_LABEL[status]) + '">' + (status === "inserted" ? "new" : "amd") + "</span>" : "") +
      "</button>";
  }

  function markToc(id) {
    el.toc.querySelectorAll(".tl").forEach(function (b) {
      b.classList.toggle("is-on", b.dataset.id === id);
    });
    if (!id) return;
    var on = el.toc.querySelector(".tl.is-on");
    if (!on) return;
    var chap = on.closest(".chap");
    if (chap) chap.classList.add("is-open");
    if (on.scrollIntoView) on.scrollIntoView({ block: "nearest" });
  }

  /* ── reader ───────────────────────────────────────────────── */

  function renderHome() {
    var m = DATA.meta, c = m.counts;
    var h = '<div class="home-hero">' +
      '<p class="home-eyebrow">' + esc(m.source) + "</p>" +
      "<h1>The EU AI Act</h1>" +
      "<p>AI Act Browser is a research interface for navigating the EU AI Act in a financial-services context, alongside DORA, GDPR, MaRisk, BaFin guidance on ICT risks in AI, and related implementing rules. Search the text, follow citations and definitions, and trace how individual provisions connect across the regulatory framework.</p>" +
      checkedOn() + "</div>";

    h += '<a class="banner" href="#/changes">' +
      '<span class="banner-tag">In force ' + esc(m.inForce) + "</span>" +
      "<span class="+'"banner-text"'+">Amended by the " + esc(m.amendedBy.short) + ": <b>" +
      c.changed + " provisions</b> added or rewritten.</span>" +
      '<span class="banner-go">See what changed →</span></a>';

    h += '<div class="portal-actions"><a class="portal-card" href="#/map"><b>Legal relationship map</b><span>Connections between the AI Act, GDPR, DORA, KI-MIG and supervisory guidance →</span></a></div>';

    /* the GDPR, which the Act defines its data terms by */
    if (DATA.gdpr && DATA.gdpr.length) {
      var gm = DATA.gdprMeta || {};
      var reached = DATA.gdpr.filter(function (a) { return citedFromAct(a).length; }).length;
      h += '<div class="block"><div class="block-head"><h2>Related regulation</h2>' +
        '<span class="block-count">' + DATA.gdpr.length + "</span>" +
        '<span class="block-note">linked wherever the Act cites it</span></div>' +
        '<div class="gcards">' +
        '<button class="gcard" type="button" data-kind="gdpr" data-route="#/gdpr">' +
        '<span class="gcard-top"><span class="gcard-name">' + esc(gm.abbr) + "</span>" +
        '<span class="gdoc-badge" data-draft="0">applies ' + esc(gm.applies) + "</span></span>" +
        '<span class="gcard-title">' + esc(gm.title) + "</span>" +
        '<span class="gcard-sub">' + esc(gm.cite) + " · " + DATA.gdpr.length + " articles · " +
        reached + " cited by the Act and its guidance</span>" +
        "</button></div></div>";
    }

    /* the Commission's own reading of Articles 5 and 6, section by section */
    var commission = (DATA.guidanceDocs || []).filter(function (d) { return d.authority !== "BaFin"; });
    var commissionSecs = (DATA.guidance || []).filter(function (g) {
      return commission.some(function (d) { return d.slug === g.doc; });
    });
    if (commissionSecs.length) {
      h += '<div class="block"><div class="block-head"><h2>Commission guidance</h2>' +
        '<span class="block-count">' + commissionSecs.length + "</span></div>" +
        '<div class="gcards">';
      commission.forEach(function (d) {
        var secs = DATA.guidance.filter(function (g) { return g.doc === d.slug; });
        h += '<button class="gcard" type="button" data-route="' + docRoute("gdl-" + d.slug) + '">' +
          '<span class="gcard-top"><span class="gcard-name">' + esc(d.name) + "</span>" +
          '<span class="gdoc-badge" data-draft="' + (d.draft ? "1" : "0") + '">' +
          (d.draft ? "draft" : "adopted") + "</span></span>" +
          '<span class="gcard-title">' + esc(d.title) + "</span>" +
          '<span class="gcard-sub">' + esc(d.cite) + " · " + secs.length + " sections</span>" +
          "</button>";
      });
      h += "</div></div>";
    }

    /* supervisory guidance: BaFin on DORA and AI, related to the Act editorially */
    (DATA.guidanceDocs || []).filter(function (d) { return d.authority === "BaFin"; }).forEach(function (d) {
      var secs = DATA.guidance.filter(function (g) { return g.doc === d.slug; });
      var related = reach(secs, { concords: 1 }).length;
      h += '<div class="block"><div class="block-head"><h2>Supervisory guidance</h2>' +
        '<span class="block-count">' + secs.length + "</span>" +
        '<span class="block-note">related to the Act’s requirements, editorially</span></div>' +
        '<div class="gcards">' +
        '<button class="gcard" type="button" data-route="' + docRoute("gdl-" + d.slug) + '">' +
        '<span class="gcard-top"><span class="gcard-name">' + esc(d.short) + " · Germany</span>" +
        '<span class="gdoc-badge" data-draft="0">non-binding</span></span>' +
        '<span class="gcard-title">' + esc(d.title) + "</span>" +
        '<span class="gcard-sub">' + esc(d.cite) + " · " + secs.length + " sections · related to " +
        related + " requirements of the Act</span>" +
        "</button></div></div>";
    });

    /* the German implementing law, cited into the Act provision by provision */
    if (DATA.kimig && DATA.kimig.length) {
      var km = DATA.kimigMeta || {};
      var cited = {};
      DATA.kimig.forEach(function (s) {
        OUT[s.id].forEach(function (e) { if (corpusOf(N[e.t]) === "aia") cited[e.t] = 1; });
      });
      h += '<div class="block"><div class="block-head"><h2>National implementation</h2>' +
        '<span class="block-count">' + DATA.kimig.length + "</span>" +
        '<span class="block-note">linked to the provisions it cites</span></div>' +
        '<div class="gcards">' +
        '<button class="gcard" type="button" data-kind="kimig" data-route="#/kimig">' +
        '<span class="gcard-top"><span class="gcard-name">' + esc(km.abbr) + " · Germany</span>" +
        '<span class="gdoc-badge" data-draft="0">in force ' + esc(km.inForce) + "</span></span>" +
        '<span class="gcard-title">' + esc(km.titleEn || km.title) + "</span>" +
        '<span class="gcard-sub">' + esc(km.cite) + " · " + DATA.kimig.length + " sections · cites " +
        Object.keys(cited).length + " provisions of the Act" +
        (km.translation ? " · in English, with the German original" : "") + "</span>" +
        "</button></div></div>";
    }

    h += '<div class="block"><div class="block-head"><h2>Chapters</h2></div><div class="chapgrid">';
    DATA.chapters.forEach(function (ch) {
      var n = DATA.articles.filter(function (a) { return a.chapter === ch.roman; });
      h += '<button class="chapcard" type="button" data-goto="' + (n[0] ? n[0].id : "") + '">' +
        '<span class="chapcard-n">' + esc(ch.roman) + "</span>" +
        '<span class="chapcard-t">' + esc(ch.title) + "</span>" +
        '<span class="chapcard-c">' + n.length + (n.length === 1 ? " art." : " arts.") + "</span></button>";
    });
    h += "</div></div>";

    el.doc.innerHTML = h;
    wireHome();
  }

  function wireHome() {
    el.doc.querySelectorAll("[data-goto]").forEach(function (b) {
      b.addEventListener("click", function () { if (b.dataset.goto) go(routeOf(b.dataset.goto)); });
    });
    el.doc.querySelectorAll("[data-route]").forEach(function (b) {
      b.addEventListener("click", function () { go(b.dataset.route); });
    });
    wireLinks(el.doc);
  }

  /* ── document home pages ──────────────────────────────────── */

  /* A document's parts, as the Act home lists its chapters. */
  function partGrid(type, parts, unit) {
    unit = unit || "sec";
    return '<div class="chapgrid" data-type="' + type + '">' + parts.map(function (p) {
      return '<button class="chapcard" type="button" data-goto="' + p.first + '">' +
        '<span class="chapcard-n">' + esc(p.n) + "</span>" +
        '<span class="chapcard-t"' + (p.lang ? ' lang="' + p.lang + '"' : "") + ">" + esc(p.title) + "</span>" +
        '<span class="chapcard-c">' + p.count + " " + unit + (p.count === 1 ? "." : "s.") + "</span></button>";
    }).join("") + "</div>";
  }

  /* Order provisions the way the Act does: articles, annexes, then terms. */
  var DOC_ORDER = null;
  function actOrder(a, b) {
    if (!DOC_ORDER) {
      DOC_ORDER = {};
      ["articles", "recitals", "annexes", "definitions"].forEach(function (c, ci) {
        DATA[c].forEach(function (n, i) { DOC_ORDER[n.id] = ci * 10000 + i; });
      });
    }
    return (DOC_ORDER[a.id] != null ? DOC_ORDER[a.id] : 1e6) - (DOC_ORDER[b.id] != null ? DOC_ORDER[b.id] : 1e6);
  }

  /* The provisions a document's sections reach by edges of the given kinds,
     each with the sections that reach it. */
  function reach(secs, kinds) {
    var by = {};
    secs.forEach(function (s) {
      OUT[s.id].forEach(function (e) {
        var t = N[e.t];
        if (!t || !kinds[e.k] || t.type === s.type) return;
        var from = by[t.id] || (by[t.id] = []);
        if (from.indexOf(s) < 0) from.push(s);
      });
    });
    return Object.keys(by).map(function (id) { return { n: N[id], from: by[id] }; })
      .sort(function (a, b) { return actOrder(a.n, b.n); });
  }

  function renderDocHome(doc) {
    el.doc.innerHTML = doc === "kimig" ? kimigHome()
      : doc === "gdpr" ? gdprHome()
      : doc.indexOf("gdl-") === 0 ? guidanceHome(guidanceDoc(doc.slice(4)))
      : genericDocHome(doc);
    wireHome();
  }

  function registryEntry(slug) {
    return (REGISTRY.corpora || []).filter(function (entry) { return entry.slug === slug; })[0];
  }

  function genericDocHome(slug) {
    if (["marisk", "dora", "dora-rts-rmf"].indexOf(slug) >= 0) return doraAiHome(slug);
    var doc = CORPUS_DOCS[slug] || {}, meta = doc.meta || {}, entry = registryEntry(slug) || {};
    var nodes = (doc.articles || doc.guidance || doc.modules || []);
    var h = '<nav class="crumb"><a href="#/">The portal</a><i>›</i><span>' + esc(entry.shortTitle || meta.shortTitle || slug) + '</span></nav>' +
      '<span class="kicker" data-type="' + (nodes[0] ? nodes[0].type : "article") + '">' + esc(entry.bindingLevel || "Document") + '</span>' +
      '<h1 class="doc-title">' + esc(meta.title || entry.title || slug) + '</h1>' +
      '<p class="doc-num">' + esc(meta.cite || meta.celex || entry.citation || "") + '</p>' +
      '<ul class="doc-facts"><li><b>' + nodes.length + '</b> provisions</li>' +
      (meta.inForce ? '<li>In force <b>' + esc(meta.inForce) + '</b></li>' : '') +
      (meta.sourceUrl ? '<li><a href="' + esc(meta.sourceUrl) + '" target="_blank" rel="noopener">Official source ↗</a></li>' : '') + '</ul>';
    if (doc.chapters && doc.articles) {
      var parts = doc.chapters.map(function (c) {
        var arts = doc.articles.filter(function (a) { return a.chapter === c.roman; });
        return { n: c.roman || "—", title: c.title, first: arts[0] && arts[0].id, count: arts.length };
      }).filter(function (p) { return p.count; });
      h += '<div class="block"><div class="block-head"><h2>Structure</h2><span class="block-count">' + parts.length + '</span></div>' + partGrid(slug, parts, "art") + '</div>';
    } else {
      h += '<div class="block"><div class="block-head"><h2>Contents</h2><span class="block-count">' + nodes.length + '</span></div><div class="links">' +
        nodes.map(function (n) { return linkRow(n, ""); }).join("") + '</div></div>';
    }
    return h;
  }

  function doraAiHome(slug) {
    var lens = RELATIONS.doraAiLens || {}, entry = registryEntry(slug) || {};
    var cards = (lens.cards || []).filter(function (card) { return card.corpora.indexOf(slug) >= 0; });
    var title = slug === "dora" ? (lens.title || "DORA for fintech AI") : (entry.shortTitle || slug) + " for fintech AI";
    var h = '<nav class="crumb"><a href="#/">The portal</a><i>›</i><span>' + esc(entry.shortTitle || slug) + '</span></nav>' +
      '<p class="home-eyebrow">Fintech AI lens</p><h1 class="doc-title">' + esc(title) + '</h1>' +
      '<p class="dora-ai-scope">' + esc(lens.scope || "Curated DORA requirements for AI used by financial entities.") + '</p>' +
      '<aside class="dora-ai-caveat"><b>How to read this</b><span>' + esc(lens.caveat || "Applicability depends on the entity and its use of the system.") + '</span></aside>' +
      '<div class="block dora-ai-block"><div class="block-head"><h2>What matters for an AI use case</h2><span class="block-count">' + cards.length + '</span></div>' +
      '<div class="dora-ai-cards">' + cards.map(function (card) {
        return '<article><h3>' + esc(card.title) + '</h3><p class="dora-ai-when"><b>When it matters</b>' + esc(card.applies_when) + '</p><p>' + esc(card.why) + '</p><div class="relation-basis"><b>Read the provisions</b>' + card.grounding.map(groundingLink).join("") + '</div></article>';
      }).join("") + '</div></div>' +
      '<p class="dora-ai-browse">The document rail still provides the complete ' + esc(entry.shortTitle || "DORA") + ' corpus when you need the wider legal context.</p>';
    return h;
  }

  function guidanceHome(d) {
    var secs = DATA.guidance.filter(function (g) { return g.doc === d.slug; });
    var paras = Math.max.apply(null, secs.map(function (g) { return g.paras ? g.paras[1] : 0; }));

    // The note below names the citation and status, so this line doesn't.
    var h = '<nav class="crumb"><a href="#/">The Act</a><i>›</i><span>Guidance</span>' +
      "<i>›</i><span>" + esc(d.name) + "</span></nav>" +
      '<span class="kicker" data-type="guidance">' +
        (d.authority === "BaFin" ? "Supervisory guidance" : "Commission guidance") + "</span>" +
      '<h1 class="doc-title">' + esc(d.title) + "</h1>" +
      '<p class="doc-num">' + secs.length + " sections" +
      (paras > 0 ? " · paras (1)–(" + paras + ")" : "") + "</p>" +
      guidanceNote(d);

    var parts = [];
    secs.forEach(function (g) {
      var p = parts[parts.length - 1];
      if (!p || p.title !== g.part) parts.push(p = { n: "§ " + g.sec, title: g.part, first: g.id, count: 0 });
      p.count++;
    });
    h += '<div class="block"><div class="block-head"><h2>Parts</h2>' +
      '<span class="block-count">' + parts.length + "</span></div>" + partGrid("guidance", parts) + "</div>";

    // The editorial mapping — what the Commission set out to interpret.
    var about = reach(secs, { interprets: 1 });
    if (about.length) {
      h += '<div class="block"><div class="block-head"><h2>Interprets</h2>' +
        '<span class="block-count">' + about.length + "</span>" +
        '<span class="block-note">the provisions and terms these guidelines explain</span></div>' +
        '<div class="links">' + about.map(function (x) {
          return linkRow(x.n, x.from.length + (x.from.length === 1 ? " section" : " sections"));
        }).join("") + "</div></div>";
    }

    // BaFin's instead: the Act's requirements its subjects meet, not a reading of the Act.
    var related = reach(secs, { concords: 1 });
    if (related.length) {
      h += '<div class="block"><div class="block-head"><h2>Related requirements in the Act</h2>' +
        '<span class="block-count">' + related.length + "</span>" +
        '<span class="block-note">editorial — what a section’s subject meets in the Act, not a citation</span></div>' +
        '<div class="links">' + related.map(function (x) {
          return linkRow(x.n, x.from.map(function (s) { return "§ " + s.sec; }).join(", "));
        }).join("") + "</div></div>";
    }
    return h;
  }

  function kimigHome() {
    var km = DATA.kimigMeta || {}, de = kimigLang === "de";

    var h = '<nav class="crumb"><a href="#/">The Act</a><i>›</i><span>' +
      esc(km.abbr || "KI-MIG") + "</span></nav>" +
      '<span class="kicker" data-type="kimig">German implementing law</span>' +
      '<h1 class="doc-title"' + (de ? ' lang="de"' : "") + ">" +
      esc(de ? km.title : km.titleEn || km.title) + "</h1>" +
      '<p class="doc-num">' + esc(km.abbr || "") + " · " + esc(km.cite || "") + "</p>";
    if (km.titleEn) {
      // the name in the other language, so both are always on the page
      h += '<p class="doc-alt"' + (de ? "" : ' lang="de"') + ">" + esc(de ? km.titleEn : km.title) + "</p>";
    }

    h += '<ul class="doc-facts" data-type="kimig">' +
      (km.adopted ? "<li>Adopted <b>" + esc(km.adopted) + "</b></li>" : "") +
      (km.inForce ? "<li>In force <b>" + esc(km.inForce) + "</b></li>" : "") +
      "<li><b>" + DATA.kimig.length + "</b> sections</li>" +
      (km.translation ? "<li>English (translation) · Deutsch (original text) on every section</li>" : "") +
      (km.sourceUrl ? '<li><a href="' + esc(km.sourceUrl) + '" target="_blank" rel="noopener">' +
        "gesetze-im-internet.de ↗</a></li>" : "") +
      "</ul>";

    var parts = (DATA.kimigParts || []).map(function (p) {
      var secs = DATA.kimig.filter(function (s) { return s.part === p.label; });
      return { n: String(p.num), title: de && p.titleDe ? p.titleDe : p.title,
               lang: de && p.titleDe ? "de" : "", first: secs[0] && secs[0].id, count: secs.length };
    }).filter(function (p) { return p.count; });
    h += '<div class="block"><div class="block-head"><h2>Parts</h2>' +
      '<span class="block-count">' + parts.length + "</span></div>" + partGrid("kimig", parts) + "</div>";

    var cited = reach(DATA.kimig, { cites: 1 });
    if (cited.length) {
      h += '<div class="block"><div class="block-head"><h2>Where it meets the Act</h2>' +
        '<span class="block-count">' + cited.length + "</span>" +
        '<span class="block-note">provisions of the Act it cites, and from where</span></div>' +
        '<div class="links">' + cited.map(function (x) {
          return linkRow(x.n, x.from.map(function (s) { return "§ " + s.key; }).join(", "));
        }).join("") + "</div></div>";
    }
    return h;
  }

  function gdprHome() {
    var gm = DATA.gdprMeta || {};

    var h = '<nav class="crumb"><a href="#/">The Act</a><i>›</i><span>' + esc(gm.abbr) + "</span></nav>" +
      '<span class="kicker" data-type="gdpr">Related regulation</span>' +
      '<h1 class="doc-title">' + esc(gm.title) + "</h1>" +
      '<p class="doc-num">' + esc(gm.abbr) + " · " + esc(gm.cite) + " · " + esc(gm.oj) + "</p>" +
      '<p class="doc-alt">' + esc(gm.longTitle) + "</p>";

    h += '<ul class="doc-facts" data-type="gdpr">' +
      "<li>Adopted <b>" + esc(gm.adopted) + "</b></li>" +
      "<li>Applies from <b>" + esc(gm.applies) + "</b></li>" +
      "<li><b>" + DATA.gdpr.length + "</b> articles</li>" +
      "<li>As corrected, " + esc(gm.corrigendum) + "</li>" +
      '<li><a href="' + esc(gm.sourceUrl) + '" target="_blank" rel="noopener">EUR-Lex ↗</a></li>' +
      "</ul>";

    var parts = (DATA.gdprChapters || []).map(function (c) {
      var arts = DATA.gdpr.filter(function (a) { return a.chapter === c.roman; });
      return { n: c.roman, title: c.title, first: arts[0] && arts[0].id, count: arts.length };
    });
    h += '<div class="block"><div class="block-head"><h2>Chapters</h2>' +
      '<span class="block-count">' + parts.length + "</span></div>" + partGrid("gdpr", parts, "art") + "</div>";

    // The KI-MIG cites the Act; here the Act cites the GDPR, so the list runs
    // the other way: GDPR articles, and the texts of the Act that reach them.
    var cited = DATA.gdpr.map(function (a) { return { n: a, from: citedFromAct(a) }; })
      .filter(function (x) { return x.from.length; });
    if (cited.length) {
      h += '<div class="block"><div class="block-head"><h2>Where the Act cites it</h2>' +
        '<span class="block-count">' + cited.length + "</span>" +
        '<span class="block-note">GDPR articles the Act and its guidance cite, and from where</span></div>' +
        '<div class="links">' + cited.map(function (x) {
          var from = x.from.map(function (e) { return shortLabel(N[e.s]); });
          return linkRow(x.n, from.length > 3 ? from.slice(0, 3).join(", ") + " +" + (from.length - 3) : from.join(", "));
        }).join("") + "</div></div>";
    }
    return h;
  }

  /* The citations of a GDPR article from the Act's texts — provisions,
     recitals, guidance — in the Act's order. */
  function citedFromAct(n) {
    return IN[n.id]
      .filter(function (e) { return corpusOf(N[e.s]) === "aia"; })
      .sort(function (a, b) { return actOrder(N[a.s], N[b.s]); });
  }

  /* ── instrument map and requirement matrix ──────────────── */

  function renderMap() {
    var items = (REGISTRY.corpora || []).slice();
    // This is a relationship map, not a force graph: its geometry carries
    // meaning. The EU framework is read left-to-right on the left; the
    // financial-sector implementation stack is a separate, calmer cluster
    // on the right. That keeps the long cross-framework bridge deliberate.
    var width = 1300, height = 500;
    var positions = {
      "gdpr": { x: 545, y: 84 }, "aia": { x: 545, y: 230 },
      "authority:bafin": { x: 545, y: 394 }, "commission-guidance": { x: 180, y: 132 },
      "kimig": { x: 180, y: 282 }, "authority:bnetza": { x: 180, y: 414 },
      "marisk": { x: 865, y: 96 }, "bafin-ai": { x: 1110, y: 112 },
      "dora": { x: 985, y: 272 }, "dora-rts-rmf": { x: 775, y: 438 },
      "dora-rts-sub": { x: 985, y: 438 }, "dora-its-register": { x: 1190, y: 438 }
    };
    var networkNames = {
      "aia": ["EU AI Act"], "commission-guidance": ["Commission", "guidelines"],
      "kimig": ["KI-MIG"], "gdpr": ["GDPR"], "dora": ["DORA"], "marisk": ["MaRisk"], "authority:bafin": ["BaFin"],
      "authority:bnetza": ["Bundesnetzagentur"],
      "bafin-ai": ["ICT risks in AI"], "dora-rts-rmf": ["RTS RMF"],
      "dora-rts-sub": ["RTS Subcontracting"], "dora-its-register": ["ITS Register"]
    };
    function edgePoint(from, to) {
      var dx = to.x - from.x, dy = to.y - from.y;
      var tx = dx ? 88 / Math.abs(dx) : Infinity, ty = dy ? 28 / Math.abs(dy) : Infinity;
      var t = Math.min(tx, ty);
      return { x: from.x + dx * t, y: from.y + dy * t };
    }
    function pathFor(rel, a, b) {
      var start = edgePoint(a, b), end = edgePoint(b, a);
      var key = rel.from + ":" + rel.to;
      // The routes that leave their cluster use a shallow, intentional curve;
      // all other routes stay close to their source and destination. This
      // avoids the accidental criss-crossing caused by a collection of lines.
      var routes = {
        "commission-guidance:aia": "M268 132 C355 132 397 218 457 218",
        "kimig:aia": "M268 282 C350 282 390 258 457 244",
        "aia:gdpr": "M545 202 L545 112",
        "aia:authority:bafin": "M530 258 C526 305 526 335 526 366",
        "kimig:authority:bafin": "M268 294 C360 312 412 356 457 382",
        "kimig:authority:bnetza": "M180 310 L180 386",
        "kimig:dora": "M268 282 C485 306 695 306 897 282",
        "marisk:aia": "M777 96 C685 96 692 202 633 218",
        "marisk:dora": "M865 124 C865 185 895 218 897 258",
        "bafin-ai:dora": "M1110 140 C1105 200 1080 231 1073 258",
        "dora-rts-rmf:dora": "M775 410 C790 350 845 313 897 286",
        "dora-rts-sub:dora": "M985 410 L985 300",
        "dora-its-register:dora": "M1190 410 C1170 350 1115 313 1073 286"
      };
      return routes[key] || ("M" + start.x + " " + start.y + " L" + end.x + " " + end.y);
    }
    var relations = RELATIONS.relations || [];
    var lines = relations.map(function (rel, index) {
      var a = positions[rel.from], b = positions[rel.to];
      if (!a || !b) return "";
      var route = pathFor(rel, a, b);
      return '<g class="imap-relation" data-relation="' + index + '" role="button" tabindex="0" aria-label="Show how ' + esc((networkNames[rel.from] || [rel.from]).join(" ")) + ' relates to ' + esc((networkNames[rel.to] || [rel.to]).join(" ")) + '"><path class="imap-edge-hit" d="' + route + '"></path><path class="imap-edge imap-legal" marker-end="url(#imap-arrow)" d="' + route + '"><title>' + esc(rel.explanation) + '</title></path></g>';
    }).join("");
    var nodes = items.map(function (item) {
      var p = positions[item.slug]; if (!p) return "";
      var cls = item.slug === "aia" ? " is-root" : item.slug === "dora" ? " is-hub" : item.status === "stub" ? " is-stub" : item.kind === "authority" ? " is-authority" : "";
      var labels = networkNames[item.slug] || [item.shortTitle];
      var label = labels.map(function (text, i) { return '<tspan x="0" dy="' + (i ? 14 : labels.length > 1 ? -4 : 4) + '">' + esc(text) + '</tspan>'; }).join("");
      var body = '<rect x="-88" y="-28" width="176" height="56" rx="2"></rect><text text-anchor="middle">' + label + '</text>';
      if (item.route) {
        return '<a class="imap-node' + cls + '" href="' + esc(item.route) + '" data-route="' + esc(item.route) + '" aria-label="Open ' + esc(item.shortTitle) + ' corpus" transform="translate(' + p.x + ' ' + p.y + ')" tabindex="0">' + body + '</a>';
      }
      return '<g class="imap-node is-static' + cls + '" aria-label="' + esc(item.shortTitle) + ' — no corpus available" transform="translate(' + p.x + ' ' + p.y + ')" tabindex="0">' + body + '</g>';
    }).join("");
    var kindNames = {
      interprets: "Explains how to apply", implements: "Implements nationally",
      "builds-on": "Reuses existing compliance work", designates: "Names the competent authority",
      "carves-out": "Sets a legal boundary", "deems-fulfilled": "Recognises equivalent compliance",
      specifies: "Adds detailed requirements", applies: "Applies sector rules to AI",
      "recognises-ai": "Expressly brings AI into model governance"
    };
    var relationList = relations.map(function (rel, index) {
      return '<button class="map-rel-btn" type="button" data-relation="' + index + '" aria-pressed="false"><span>' +
        esc((networkNames[rel.from] || [rel.from]).join(" ")) + ' <b aria-hidden="true">→</b> ' +
        esc((networkNames[rel.to] || [rel.to]).join(" ")) + '</span><small>' +
        esc(kindNames[rel.kind] || rel.kind.replace(/-/g, " ")) + '</small></button>';
    }).join("");
    el.doc.innerHTML = '<div class="home-hero portal-hero"><p class="home-eyebrow">Reference map</p><h1>Legal relationships between instruments</h1></div>' +
      '<div class="block map-network-block"><div class="block-head"><h2>Relationships</h2><span class="block-note">Direction indicates legal effect; citations appear in the detail view</span></div>' +
      '<div class="map-key" aria-label="Map key"><span><i class="key-line legal"></i><b>Directed legal relationship</b></span><span><b>Large node</b> — relationship hub</span></div>' +
      '<div class="imap-wrap"><svg class="imap" role="group" aria-labelledby="imap-title imap-desc" viewBox="0 0 ' + width + ' ' + height + '"><title id="imap-title">Legal relationships between instruments</title><desc id="imap-desc">Interactive map grouped into EU framework and financial-sector governance. Focus a relationship for its legal basis.</desc><defs><marker id="imap-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker></defs><g class="imap-clusters"><rect class="imap-band imap-band-eu" x="24" y="24" width="672" height="452" rx="2"></rect><text class="imap-band-label" x="52" y="58">EU framework &amp; national implementation</text><rect class="imap-band imap-band-finance" x="724" y="24" width="552" height="452" rx="2"></rect><text class="imap-band-label" x="752" y="58">Financial-sector governance</text></g>' + lines + nodes + '</svg></div>' +
      '<div class="map-rel-list" aria-label="Legal relationships">' + relationList + '</div>' +
      '<section class="map-detail" id="map-detail" aria-live="polite"><p class="map-detail-prompt">Select a relationship to inspect its legal basis and relevant provisions.</p></section></div>';
    wireMapDetails(relations, networkNames, kindNames);
    wireMapNodes();
  }

  function wireMapNodes() {
    el.doc.querySelectorAll(".imap-node[data-route]").forEach(function (node) {
      function open(event) {
        event.preventDefault();
        go(node.dataset.route);
      }
      node.addEventListener("click", open);
      node.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") open(event);
      });
    });
  }

  function wireMapDetails(relations, names, kindNames) {
    var detail = el.doc.querySelector("#map-detail"), edges = [].slice.call(el.doc.querySelectorAll(".imap-relation"));
    var listButtons = [].slice.call(el.doc.querySelectorAll(".map-rel-btn"));
    var locked = null;
    function title(slug) { return (names[slug] || [(registryEntry(slug) || {}).shortTitle || slug]).join(" "); }
    function clear() {
      if (locked !== null) return;
      edges.forEach(function (edge) { edge.classList.remove("is-active"); });
      listButtons.forEach(function (button) { button.classList.remove("is-active"); button.setAttribute("aria-pressed", "false"); });
      detail.innerHTML = '<p class="map-detail-prompt">Select a relationship to inspect its legal basis and relevant provisions.</p>';
    }
    function show(index, shouldLock) {
      var relation = relations[index]; if (!relation) return;
      if (shouldLock && locked === index) { locked = null; clear(); return; }
      if (shouldLock) locked = index;
      edges.forEach(function (edge) { edge.classList.toggle("is-active", Number(edge.dataset.relation) === index); });
      listButtons.forEach(function (button) {
        var active = Number(button.dataset.relation) === index;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });
      var bridges = (RELATIONS.interactions || []).filter(function (bridge) {
        return bridge.from === relation.from && bridge.to === relation.to;
      });
      var mechanismHtml = bridges.length ? '<div class="map-detail-mechanisms"><h4>Representative mechanisms</h4>' + bridges.map(function (bridge) {
        return bridge.mechanisms.map(function (mechanism) {
          return '<article><h5>' + esc(mechanism.name) + '</h5><span>' + esc(mechanism.kind) + '</span><p>' + esc(mechanism.explanation) + '</p><div class="relation-basis"><b>Connected through</b>' + mechanism.grounding.map(groundingLink).join("") + '</div></article>';
        }).join("");
      }).join("") + '</div>' : "";
      detail.innerHTML = '<div class="map-detail-head"><p>' + esc(kindNames[relation.kind] || relation.kind.replace(/-/g, " ")) + '</p><h3>' + esc(title(relation.from)) + ' <span aria-hidden="true">→</span> ' + esc(title(relation.to)) + '</h3></div><p class="map-detail-copy">' + esc(relation.explanation) + '</p><div class="relation-basis"><b>Legal basis</b>' + relation.grounding.map(groundingLink).join("") + '</div>' + mechanismHtml + (locked === index ? '<p class="map-detail-state">Selected — click the highlighted arrow again to clear.</p>' : "");
    }
    edges.forEach(function (edge) {
      var index = Number(edge.dataset.relation);
      edge.addEventListener("mouseenter", function () { if (locked === null) show(index, false); });
      edge.addEventListener("mouseleave", clear);
      edge.addEventListener("focus", function () { if (locked === null) show(index, false); });
      edge.addEventListener("blur", clear);
      edge.addEventListener("click", function () { show(index, true); });
      edge.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); show(index, true); }
      });
    });
    listButtons.forEach(function (button) {
      var index = Number(button.dataset.relation);
      button.addEventListener("click", function () {
        show(index, true);
        detail.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    });
  }

  function groundingLink(ref) {
    var parts = ref.split("/"), id = parts[0], node = N[id];
    var split = id.split(":"), corpus = split[0], local = split.slice(1).join(":");
    var entry = registryEntry(corpus) || {}, prefix = entry.shortTitle || corpus.toUpperCase();
    var fallback = local.indexOf("art_") === 0 ? prefix + " Art. " + local.slice(4)
      : local.indexOf("par_") === 0 ? prefix + " § " + local.slice(4)
      : local.indexOf("module_") === 0 ? prefix + " " + local.slice(7)
      : local.indexOf("anx_") === 0 ? prefix + " Annex " + local.slice(4)
      : local;
    var label = node ? shortLabel(node) : fallback;
    if (node && node.type === "definition") label = "AI Act " + (node.label || node.term || label);
    else if (node && node.corpus === "aia" && node.type === "article") label = "AI Act " + label;
    if (parts[1]) {
      var m = /^(pt|p)(.+)$/.exec(parts[1]);
      label += m ? (m[1] === "p" ? ", para. " : ", point ") + m[2] : ", " + parts[1];
    }
    return '<a href="' + provisionRoute(ref) + '">' + esc(label) + '</a>';
  }

  function provisionRoute(ref) {
    var parts = ref.split("/"), id = parts.shift();
    return routeOf(id) + (parts.length ? "/" + parts.join("/") : "");
  }

  function renderTopicContext(root, node) {
    var own = TOPICS.tags.filter(function (tag) { return tag.provision === node.id; });
    if (!own.length) return;
    var related = [];
    own.forEach(function (tag) {
      TOPICS.tags.forEach(function (other) {
        if (other.topic === tag.topic && other.provision !== node.id && related.indexOf(other) < 0) related.push(other);
      });
    });
    var names = {};
    own.forEach(function (tag) { names[tag.topic] = (TOPICS.topics.filter(function (t) { return t.slug === tag.topic; })[0] || {}).name; });
    root.insertAdjacentHTML("beforeend", '<div class="block"><div class="block-head"><h2>Same topic in other instruments</h2><span class="block-count">' + related.length + '</span></div><div class="topic-badges">' + Object.keys(names).map(function (slug) { return '<span>' + esc(names[slug]) + '</span>'; }).join("") + '</div><div class="links">' + related.map(function (tag) { return '<a class="link" href="' + provisionRoute(tag.provision) + '"><span class="link-id">' + esc(tag.label) + '</span><span class="link-title">' + esc(tag.reason) + '</span></a>'; }).join("") + '</div></div>');
  }

  function renderLegalEffect(root, node) {
    var touching = (RELATIONS.relations || []).filter(function (rel) {
      return rel.grounding.some(function (ref) { return ref.split("/")[0] === node.id; });
    });
    if (!touching.length) return;
    root.insertAdjacentHTML("beforeend", '<div class="block legal-effect"><div class="block-head"><h2>Legal effect</h2><span class="block-count">' + touching.length + '</span></div>' + touching.map(function (rel) {
      var target = registryEntry(rel.to) || {};
      return '<article><b>' + esc(rel.kind.replace(/-/g, " ")) + ' · ' + esc(target.shortTitle || rel.to) + '</b><p>' + esc(rel.explanation) + '</p></article>';
    }).join("") + '</div>');
  }

  /* Where in its source a citation sits, as each text numbers it: an
     article's "para. 9", a guideline's "(371)". */
  function atLabel(e) {
    return (e.at || []).map(function (p) {
      var g = /^g(\d+)$/.exec(p);
      return g ? "(" + g[1] + ")" : "para. " + p.replace(/^p/, "");
    }).join(", ");
  }

  /* ── what changed in 2026 ─────────────────────────────────── */

  var CHANGES = null;          // lazily fetched; it is only needed on this page
  var changeFilter = "all";

  function renderChanges(focus) {
    if (CHANGES) return paintChanges(focus);

    el.doc.innerHTML = '<div class="boot"><div class="boot-bar"><span></span></div>' +
      "<p>Loading the amendments…</p></div>";

    fetch("/data/changes.json")
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (d) {
        CHANGES = d;
        d.recitals.forEach(function (r) { if (!N[r.id]) N[r.id] = r; });
        paintChanges(focus);
      })
      .catch(function (err) {
        el.doc.innerHTML = '<div class="boot"><p><strong>The amendments could not be loaded.</strong></p>' +
          "<p>" + esc(String(err.message || err)) + "</p>" +
          "<p>Run <code>python3 build/build.py</code> to regenerate <code>data/changes.json</code>.</p></div>";
      });
  }

  function paintChanges(focus) {
    var m = CHANGES.meta, c = m.counts, a = m.amendedBy;

    var h = '<div class="home-hero">' +
      '<p class="home-eyebrow">' + esc(a.title) + " · applies from " + esc(m.inForce) + "</p>" +
      "<h1>What the Digital Omnibus changed.</h1>" +
      "<p>" + esc(a.title) + " — the " + esc(a.short) + " of " + esc(a.date) +
      " — rewrote " + c.amended + " provisions of the AI Act and added " + c.inserted +
      ". Every change below is EUR-Lex's own annotation of the consolidated text, " +
      "shown against the Act as first published.</p></div>";

    h += '<div class="stats">' +
      statCell(c.inserted, "Added", "inserted") +
      statCell(c.amended, "Rewritten", "amended") +
      statCell(c.articles, "Articles touched", "") +
      statCell(c.recitals, "Omnibus recitals", "") +
      "</div>";

    h += '<div class="chips" role="group" aria-label="Filter changes">';
    [["all", "Everything", c.total], ["inserted", "Added", c.inserted],
     ["amended", "Rewritten", c.amended], ["article", "Articles", c.articles],
     ["annex", "Annexes", c.annexes], ["definition", "Terms", c.definitions]]
      .forEach(function (f) {
        if (!f[2]) return;
        h += '<button class="chip' + (changeFilter === f[0] ? " is-on" : "") +
          '" type="button" data-filter="' + f[0] + '" aria-pressed="' +
          (changeFilter === f[0] ? "true" : "false") + '">' +
          esc(f[1]) + '<span class="chip-n">' + f[2] + "</span></button>";
      });
    h += "</div>";

    var items = CHANGES.items.filter(matchFilter);
    h += '<div class="block"><div class="block-head"><h2>Provisions</h2>' +
      '<span class="block-count">' + items.length + "</span>" +
      '<span class="block-note">added first, then rewritten · click to expand</span></div>';

    h += '<div class="chg-list">' + items.map(changeCard).join("") + "</div></div>";

    h += '<p class="fineprint">Change annotations come from the EUR-Lex consolidated text ' +
      '(▼M1 markers), not from comparing the two documents — the two exports use different ' +
      'converters, so a raw comparison reports punctuation as amendment. The word-level ' +
      'redlines below are computed against ' +
      '<a href="' + esc(m.baseUrl) + '" target="_blank" rel="noopener">the Act as published in 2024</a>. ' +
      'Only the Official Journal text is authentic.</p>';

    el.doc.innerHTML = h;

    el.doc.querySelectorAll(".chip").forEach(function (b) {
      b.addEventListener("click", function () {
        changeFilter = b.dataset.filter;
        paintChanges(null);
      });
    });
    el.doc.querySelectorAll(".chg-head").forEach(function (b) {
      b.addEventListener("click", function () {
        var open = b.parentNode.classList.toggle("is-open");
        b.setAttribute("aria-expanded", open ? "true" : "false");
      });
    });
    el.doc.querySelectorAll("[data-open]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        ev.stopPropagation();
        go(routeOf(b.dataset.open));
      });
    });

    if (focus) {
      var card = el.doc.querySelector('.chg[data-id="' + cssEsc(focus) + '"]');
      if (card) {
        card.classList.add("is-open", "is-focus");
        card.querySelector(".chg-head").setAttribute("aria-expanded", "true");
        setTimeout(function () { card.scrollIntoView({ block: "center", behavior: "smooth" }); }, 40);
      }
    }
  }

  function matchFilter(i) {
    if (changeFilter === "all") return true;
    if (changeFilter === "inserted" || changeFilter === "amended") return i.status === changeFilter;
    return i.kind === changeFilter;
  }

  function statCell(n, k, status) {
    return '<div class="stat" ' + (status ? 'data-status="' + status + '"' : "") + ">" +
      '<div class="stat-n">' + n + '</div><div class="stat-k">' + esc(k) + "</div></div>";
  }

  function changeCard(i) {
    var h = '<article class="chg" data-id="' + esc(i.id) + '" data-status="' + i.status + '">' +
      '<button class="chg-head" type="button" aria-expanded="false">' +
      '<span class="chg-badge" data-status="' + i.status + '">' +
        (i.status === "inserted" ? "added" : i.status === "removed" ? "removed" : "rewritten") + "</span>" +
      '<span class="chg-id">' + esc(i.label) + "</span>" +
      '<span class="chg-title">' + esc(i.title) + "</span>";

    if (i.stats) {
      h += '<span class="chg-delta"><ins>+' + i.stats.added + "</ins> <del>−" +
        i.stats.removed + "</del></span>";
    }
    h += '<svg class="chg-caret" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>';

    h += '<div class="chg-body">';
    if (i.status === "inserted") {
      h += '<p class="chg-note">This provision did not exist in the 2024 Act.</p>' +
        '<p class="chg-preview">' + esc(i.preview) + "…</p>";
    } else if (i.status === "removed") {
      h += '<p class="chg-note">This provision was removed from the Act.</p>';
    } else if (i.diff) {
      h += '<div class="redline">' + i.diff.map(function (op) {
        var t = esc(op[1]);
        if (op[0] === 1) return "<ins>" + t + "</ins>";
        if (op[0] === -1) return "<del>" + t + "</del>";
        return "<span>" + t + "</span>";
      }).join("") + "</div>" +
        '<p class="chg-note">Unchanged runs are shortened with …</p>';
    }

    if (i.recitals && i.recitals.length) {
      h += '<div class="chg-why"><h4>Why</h4>' + i.recitals.map(function (r) {
        var rec = N[r.id];
        return '<p class="chg-rec"><b>Omnibus recital ' + esc(String(rec ? rec.num : "")) +
          "</b> " + esc(rec ? lede(rec.text, 260) : "") + "</p>";
      }).join("") + "</div>";
    }

    h += '<div class="chg-actions"><button class="btn" type="button" data-open="' +
      esc(i.id) + '">Open ' + esc(i.label) + " →</button></div>";
    h += "</div></article>";
    return h;
  }

  function cssEsc(s) { return String(s).replace(/["\\]/g, "\\$&"); }

  function renderNode(n, para) {
    var h = "";
    var corpus = n.corpus || (n.id.indexOf(":") > 0 ? n.id.split(":", 1)[0] : "aia");
    var corpusEntry = registryEntry(corpus) || {};

    /* breadcrumb */
    if (n.type === "article") {
      h += '<nav class="crumb"><a href="#/">The portal</a><i>›</i>' +
        (corpus !== "aia" ? '<a href="#/' + esc(corpus) + '">' + esc(corpusEntry.shortTitle || corpus) + '</a><i>›</i>' : '') +
        "<span>" + esc(n.chapterLabel) + ": " + esc(n.chapterTitle) + "</span>";
      if (n.sectionLabel) h += "<i>›</i><span>" + esc(n.sectionLabel) + ": " + esc(n.sectionTitle) + "</span>";
      h += "</nav>";
    } else if (n.type === "guidance") {
      h += '<nav class="crumb"><a href="#/">The Act</a><i>›</i><span>Guidance</span>' +
        '<i>›</i><a href="' + (corpus === "aia" ? docRoute("gdl-" + n.doc) : "#/" + corpus) + '">' + esc(n.docName) + "</a>" +
        "<i>›</i><span>" + esc(n.part) + "</span></nav>";
    } else if (n.type === "kimig") {
      h += '<nav class="crumb"><a href="#/">The Act</a><i>›</i><a href="#/kimig">' +
        esc((DATA.kimigMeta || {}).abbr || "KI-MIG") + "</a>" +
        "<i>›</i><span>" + esc(kField(n, "part") + ": " + kField(n, "partTitle")) + "</span>" +
        (n.sub ? "<i>›</i><span>" + esc(kField(n, "sub") + ": " + kField(n, "subTitle")) + "</span>" : "") +
        "</nav>";
    } else if (n.type === "gdpr") {
      h += '<nav class="crumb"><a href="#/">The Act</a><i>›</i><a href="#/gdpr">GDPR</a>' +
        "<i>›</i><span>" + esc(n.chapterLabel) + ": " + esc(n.chapterTitle) + "</span>" +
        (n.sectionLabel ? "<i>›</i><span>" + esc(n.sectionLabel) + ": " + esc(n.sectionTitle) + "</span>" : "") +
        "</nav>";
    } else if (n.type === "module") {
      h += '<nav class="crumb"><a href="#/">The portal</a><i>›</i><a href="#/marisk">MaRisk</a></nav>';
    } else {
      h += '<nav class="crumb"><a href="#/">The Act</a><i>›</i><span>' +
        esc(TYPE_LABEL[n.type]) + "</span></nav>";
    }

    h += '<span class="kicker" data-type="' + n.type + '">' + esc(kickerText(n)) + "</span>";
    if (n.status) {
      h += '<a class="kicker kicker-chg" data-status="' + n.status + '" href="#/changes/' +
        esc(n.id) + '">' + esc(STATUS_LABEL[n.status]) + " · see the change</a>";
    }
    if (n.amending) {
      h += '<span class="kicker kicker-chg" data-status="amended">From the amending Regulation</span>';
    }

    if (n.type === "definition") {
      h += '<h1 class="doc-title">‘' + esc(n.term) + "’</h1>" +
        '<p class="doc-num">Article 3, point (' + n.num + ")</p>";
    } else if (n.type === "guidance") {
      var gdoc = guidanceDoc(n.doc);
      h += '<h1 class="doc-title">' + esc(n.title) + "</h1>" +
        '<p class="doc-num">§ ' + esc(n.sec) + " · " + esc(gdoc ? gdoc.title : n.docName) +
        (n.paras ? " · paras (" + n.paras[0] + ")–(" + n.paras[1] + ")" : "") + "</p>";
      h += guidanceNote(gdoc || { draft: n.draft, cite: "" });
    } else if (n.type === "kimig") {
      var km = DATA.kimigMeta || {};
      var de = inGerman(n);
      h += '<h1 class="doc-title"' + (de ? ' lang="de"' : "") + ">" + esc(kField(n, "title")) + "</h1>" +
        '<p class="doc-num">§ ' + esc(n.key) + " " + esc(km.abbr || "KI-MIG") +
        " · " + esc(km.cite || "") + "</p>";
      if (n.lang === "en") {
        h += '<div class="seg lang-seg" role="group" aria-label="Language of the text">' +
          '<button class="seg-btn' + (de ? "" : " is-on") + '" type="button" data-lang="en" aria-pressed="' +
            !de + '">English (translation)</button>' +
          '<button class="seg-btn' + (de ? " is-on" : "") + '" type="button" data-lang="de" aria-pressed="' +
            de + '">Deutsch (original text)</button></div>';
      }
      if (n.pinned) {
        // The fines bite on the Act as first published; say so where the
        // consolidated text shown behind a link has since been rewritten.
        var moved = OUT[n.id]
          .map(function (e) { return N[e.t]; })
          .filter(function (t) { return t && t.status; });
        h += '<div class="gl-note" data-kind="kimig"><b>Cites the 2024 text.</b> This section ' +
          "refers to the Regulation “in der Fassung vom 13. Juni 2024” (in the version of " +
          "13 June 2024) — as first published. The links open the Act as amended in 2026" +
          (moved.length
            ? "; of the provisions cited, " + moved.map(function (t) {
                return '<a href="#/changes/' + esc(t.id) + '">' + esc(t.label) + "</a>";
              }).join(", ") + (moved.length === 1 ? " has" : " have") + " changed since."
            : ", but none of the provisions cited has changed since.") +
          "</div>";
      }
    } else if (n.type === "gdpr") {
      var gm = DATA.gdprMeta || {};
      h += '<h1 class="doc-title">' + esc(n.title) + "</h1>" +
        '<p class="doc-num">Article ' + esc(n.key) + " · " + esc(gm.cite || "") +
        (n.corrected ? " · as corrected, " + esc(gm.corrigendum || "") : "") + "</p>";
    } else if (n.type === "module") {
      h += '<h1 class="doc-title">' + esc(n.title) + '</h1><p class="doc-num">MaRisk ' + esc(n.key) + ' · page ' + esc(n.page) + '</p>';
    } else if (n.type === "external") {
      h += '<h1 class="doc-title">' + esc(n.label) + '</h1>' +
        (n.externalUrl ? '<p><a class="btn" href="' + esc(n.externalUrl) + '" target="_blank" rel="noopener">Open official source ↗</a></p>' : '');
    } else {
      h += '<h1 class="doc-title">' + esc(n.title || n.label) + "</h1>";
      if (n.type !== "recital") h += '<p class="doc-num">' + esc(n.label) + "</p>";
    }

    /* the text */
    h += '<div class="lawtext" id="lawtext"' + (inGerman(n) ? ' lang="de"' : "") + ">" +
      (n.type === "kimig" ? kField(n, "html") : (n.html || "")) + "</div>";

    el.doc.innerHTML = h;

    el.doc.querySelectorAll("[data-lang]").forEach(function (b) {
      b.addEventListener("click", function () { setKimigLang(b.dataset.lang, n); });
    });

    decorate($("#lawtext"), n.id);

    /* recitals — the layer the source sites leave out */
    if (n.type === "article" || n.type === "annex") {
      renderRecitals(el.doc, n);
    }
    if (n.type === "recital") {
      renderRecitalTargets(el.doc, n);
    }
    /* Commission guidance, grouped by document */
    if (n.type === "article" || n.type === "annex" || n.type === "definition") {
      renderGuidanceFor(el.doc, n);
      renderConcordsFor(el.doc, n);
      renderKimigFor(el.doc, n);
    }
    if (n.type === "guidance") {
      renderGuidanceNav(el.doc, n);
    }
    if (n.type === "kimig") {
      renderDocNav(el.doc, n, DATA.kimig, "§ ");
    }
    if (n.type === "gdpr") {
      renderCitedByAct(el.doc, n);
      renderDocNav(el.doc, n, DATA.gdpr, "Art. ");
    }
    if (n.type === "module") renderDocNav(el.doc, n, (CORPUS_DOCS.marisk || {}).modules || [], "");

    renderTopicContext(el.doc, n);
    renderLegalEffect(el.doc, n);

    if (para) {
      var t = el.doc.querySelector("#" + para);
      if (t) {
        t.classList.add("is-hit");
        setTimeout(function () { t.scrollIntoView({ block: "center", behavior: "smooth" }); }, 30);
      }
    }

    renderConnections(n);
  }

  function kickerText(n) {
    if (n.type === "article") return "Article " + artKey(n);
    if (n.type === "recital") return "Recital " + n.num;
    if (n.type === "annex") return "Annex " + n.roman;
    if (n.type === "guidance") {
      return (guidanceDoc(n.doc) || {}).authority === "BaFin" ? "Supervisory guidance" : "Commission guidance";
    }
    if (n.type === "kimig") return "German implementing law";
    if (n.type === "gdpr") return "GDPR · Article " + n.key;
    if (n.type === "module") return "MaRisk module " + n.key;
    if (n.type === "external") return "External provision";
    return "Defined term";
  }

  function guidanceNote(d) {
    if (d.authority === "BaFin") {
      return '<div class="gl-note" data-draft="0"><b>Supervisory guidance</b> — ' + esc(d.cite) +
        ". Non-binding advice on applying DORA to AI systems at financial entities; it does not " +
        "interpret the AI Act. Its references to DORA are not linked, and its links to " +
        "requirements of the Act are editorial.</div>";
    }
    return '<div class="gl-note" data-draft="' + (d.draft ? "1" : "0") + '">' +
      (d.draft
        ? "<b>Draft.</b> Published for stakeholder consultation and not yet adopted — " +
          "the final guidelines may differ."
        : "<b>Adopted</b> — " + esc(d.cite) + ".") +
      " Commission guidelines are not binding; only the Court of Justice can " +
      "interpret the Act authoritatively.</div>";
  }

  function guidanceDoc(slug) {
    var docs = DATA.guidanceDocs || [];
    for (var i = 0; i < docs.length; i++) if (docs[i].slug === slug) return docs[i];
    return null;
  }

  /* The guidance sections that interpret a provision, as a block after the
     recitals — same idea, one more layer: the Commission's own reading.
     Article 5 alone is read by a hundred-plus sections, so a long list
     folds into its document's own groups. */
  function renderGuidanceFor(root, n) {
    var gs = IN[n.id]
      .filter(function (e) { return e.k === "interprets" && N[e.s] && N[e.s].type === "guidance" && corpusOf(N[e.s]) === corpusOf(n); })
      .map(function (e) { return N[e.s]; })
      .sort(function (a, b) { return a.num - b.num; });
    if (!gs.length) return;

    var sec = document.createElement("section");
    sec.className = "block";
    var h = '<div class="block-head"><h2>Commission guidance</h2>' +
      '<span class="block-count">' + gs.length + "</span>" +
      '<span class="block-note">how the Commission reads this provision</span></div>';

    function row(g) {
      return '<button class="link" type="button" data-id="' + g.id + '">' +
        '<span class="link-id" data-type="guidance">§ ' + esc(g.sec) + "</span>" +
        '<span class="link-title">' + esc(g.title) + "</span></button>";
    }

    var flat = gs.length <= 8;
    var seenDoc = null;
    var groups = [], cur = null;
    gs.forEach(function (g) {
      if (!cur || cur.doc !== g.doc || cur.part !== g.part) {
        cur = { doc: g.doc, part: g.part, draft: g.draft, items: [] };
        groups.push(cur);
      }
      cur.items.push(g);
    });

    groups.forEach(function (grp) {
      if (grp.doc !== seenDoc) {
        seenDoc = grp.doc;
        var d = guidanceDoc(grp.doc);
        h += '<div class="gdoc-row"><span>' + esc(d ? d.name : "") + "</span>" +
          '<span class="gdoc-badge" data-draft="' + (grp.draft ? "1" : "0") + '">' +
          (grp.draft ? "draft" : "adopted") + "</span></div>";
      }
      if (flat) {
        h += '<div class="links">' + grp.items.map(row).join("") + "</div>";
      } else {
        h += '<div class="gl-group"><button class="gl-group-btn" type="button">' +
          '<span class="gl-group-name">' + esc(grp.part) + "</span>" +
          '<span class="gl-group-n">' + grp.items.length + "</span>" +
          '<svg class="chap-caret" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>' +
          "</button>" +
          '<div class="gl-group-list links">' + grp.items.map(row).join("") + "</div></div>";
      }
    });

    sec.innerHTML = h;
    root.appendChild(sec);
    sec.querySelectorAll(".gl-group-btn").forEach(function (b) {
      b.addEventListener("click", function () { b.parentNode.classList.toggle("is-open"); });
    });
    wireLinks(sec);
  }

  /* Read a guidance document like a book: what it interprets, then on to the
     next section without a trip back to the rail. */
  function renderGuidanceNav(root, n) {
    var tg = OUT[n.id]
      .filter(function (e) { return e.k === "interprets"; })
      .map(function (e) { return N[e.t]; })
      .filter(Boolean);
    var related = OUT[n.id].filter(function (e) { return e.k === "concords" && N[e.t]; });

    var sec = document.createElement("section");
    sec.className = "block";
    var h = "";
    // BaFin's sections interpret nothing in the Act (`act` null); the
    // Commission's always show what they interpret, even when it is nothing.
    if (!("act" in n)) {
      h += '<div class="block-head"><h2>Interprets</h2>' +
        '<span class="block-count">' + tg.length + "</span></div>";
      if (tg.length) {
        h += '<div class="links">' + tg.map(function (x) { return linkRow(x, ""); }).join("") + "</div>";
      }
    }
    if (related.length) {
      h += '<div class="block-head"><h2>Related requirements in the AI Act</h2>' +
        '<span class="block-count">' + related.length + "</span>" +
        '<span class="block-note">editorial, not a citation</span></div>' +
        '<div class="links">' + related.map(function (e) { return concordRow(N[e.t], e.why); }).join("") + "</div>";
    }

    var sibs = DATA.guidance.filter(function (g) { return g.doc === n.doc; });
    var at = sibs.findIndex(function (g) { return g.id === n.id; });
    var prev = at > 0 ? sibs[at - 1] : null;
    var next = at >= 0 && at < sibs.length - 1 ? sibs[at + 1] : null;
    if (prev || next) {
      h += '<div class="gl-nav">' +
        (prev ? '<a class="gl-nav-a" href="' + routeOf(prev.id) + '">← § ' + esc(prev.sec) +
          ' <span>' + esc(lede(prev.title, 46)) + "</span></a>" : "<span></span>") +
        (next ? '<a class="gl-nav-a gl-nav-next" href="' + routeOf(next.id) + '">§ ' + esc(next.sec) +
          ' <span>' + esc(lede(next.title, 46)) + "</span> →</a>" : "") +
        "</div>";
    }
    sec.innerHTML = h;
    root.appendChild(sec);
    wireLinks(sec);
  }

  /* Where German law picks a provision up: the KI-MIG sections citing it. */
  function renderKimigFor(root, n) {
    var ks = IN[n.id]
      .filter(function (e) { return corpusOf(N[e.s]) === "kimig"; })
      .map(function (e) { return N[e.s]; })
      .sort(function (a, b) { return a.num - b.num; });
    if (!ks.length) return;

    var sec = document.createElement("section");
    sec.className = "block";
    sec.innerHTML = '<div class="block-head"><h2>German implementing law</h2>' +
      '<span class="block-count">' + ks.length + "</span>" +
      '<span class="block-note">KI-MIG sections that cite this ' +
      (n.type === "definition" ? "term" : "provision") + "</span></div>" +
      '<div class="links">' + ks.map(function (k) { return linkRow(k, ""); }).join("") + "</div>";
    root.appendChild(sec);
    wireLinks(sec);
  }

  /* Supervisory guidance whose subject meets this provision. The link is
     editorial, so each row carries its reason. */
  function renderConcordsFor(root, n) {
    var rel = IN[n.id]
      .filter(function (e) { return e.k === "concords" && N[e.s]; })
      .sort(function (a, b) { return N[a.s].num - N[b.s].num; });
    if (!rel.length) return;
    var sec = document.createElement("section");
    sec.className = "block";
    sec.innerHTML = '<div class="block-head"><h2>Supervisory guidance</h2>' +
      '<span class="block-count">' + rel.length + "</span>" +
      '<span class="block-note">related by subject, editorially — not a citation</span></div>' +
      '<div class="links">' + rel.map(function (e) { return concordRow(N[e.s], e.why); }).join("") + "</div>";
    root.appendChild(sec);
    wireLinks(sec);
  }

  /* An editorial link to a related requirement, and the reason for it. */
  function concordRow(n, why) {
    return '<div class="concord">' + linkRow(n, "") + '<p class="concord-why">' + esc(why) + "</p></div>";
  }

  /* The Act's side of a GDPR article: the provisions, recitals and guidance
     sections that cite it. */
  function renderCitedByAct(root, n) {
    var from = citedFromAct(n);
    if (!from.length) return;
    var sec = document.createElement("section");
    sec.className = "block";
    sec.innerHTML = '<div class="block-head"><h2>Cited by the AI Act</h2>' +
      '<span class="block-count">' + from.length + "</span>" +
      '<span class="block-note">provisions, recitals and guidance that cite this article</span></div>' +
      '<div class="links">' + from.map(function (e) {
        // straight to the paragraph that cites it, not the top of the provision
        return linkRow(N[e.s], atLabel(e), e.at && e.at[0]);
      }).join("") + "</div>";
    root.appendChild(sec);
    wireLinks(sec);
  }

  function setKimigLang(lang, n) {
    if (lang === kimigLang) return;
    kimigLang = lang;
    try { sessionStorage.setItem("aiact-kimig-lang", lang); } catch (e) {}
    renderNode(n, null);
    if (tocDoc === "kimig") { paintToc(); markToc(n.id); }
    var btn = el.doc.querySelector('[data-lang="' + lang + '"]');
    if (btn) btn.focus();
  }

  /* Previous and next, so a KI-MIG or GDPR reads through without the rail. */
  function renderDocNav(root, n, list, mark) {
    var at = list.findIndex(function (s) { return s.id === n.id; });
    var prev = at > 0 ? list[at - 1] : null;
    var next = at >= 0 && at < list.length - 1 ? list[at + 1] : null;
    if (!prev && !next) return;
    var sec = document.createElement("section");
    sec.className = "block";
    sec.innerHTML = '<div class="gl-nav">' +
      (prev ? '<a class="gl-nav-a" href="' + routeOf(prev.id) + '">← ' + esc(mark + prev.key) +
        ' <span>' + esc(lede(nodeTitle(prev), 46)) + "</span></a>" : "<span></span>") +
      (next ? '<a class="gl-nav-a gl-nav-next" href="' + routeOf(next.id) + '">' + esc(mark + next.key) +
        ' <span>' + esc(lede(nodeTitle(next), 46)) + "</span> →</a>" : "") +
      "</div>";
    root.appendChild(sec);
  }


  function recitalsFor(id) {
    return IN[id]
      .filter(function (e) { return e.k === "explains" || e.k === "relates"; })
      .filter(function (e) { return N[e.s] && N[e.s].type === "recital" && corpusOf(N[e.s]) === corpusOf(N[id]); })
      .map(function (e) { return { r: N[e.s], k: e.k }; })
      .sort(function (a, b) { return a.r.num - b.r.num; });
  }

  function renderRecitals(root, n) {
    var recs = recitalsFor(n.id);
    var sec = document.createElement("section");
    sec.className = "block";
    var explicit = recs.filter(function (x) { return x.k === "explains"; }).length;

    var h = '<div class="block-head"><h2>Recitals</h2>' +
      '<span class="block-count">' + recs.length + "</span>";
    if (recs.length) {
      h += '<span class="block-note">' + explicit + " name this provision" +
        (explicit < recs.length ? " · others matched by topic" : "") + "</span>";
    }
    h += "</div>";

    if (!recs.length) {
      h += '<p class="empty">No recital in the preamble matches this provision.</p>';
    } else {
      recs.forEach(function (x) {
        h += '<article class="rec" data-id="' + x.r.id + '">' +
          '<button class="rec-btn" type="button">' +
          '<span class="rec-n">(' + x.r.num + ")</span>" +
          '<span class="rec-lede">' + esc(lede(x.r.text, 190)) + "</span>" +
          (x.k === "explains" ? '<span class="rec-why" data-k="explains">names it</span>' : "") +
          "</button>" +
          '<div class="rec-full">' + x.r.html +
          '<a class="rec-goto" href="' + routeOf(x.r.id) + '">Open recital ' + x.r.num + " →</a></div>" +
          "</article>";
      });
    }
    sec.innerHTML = h;
    root.appendChild(sec);

    sec.querySelectorAll(".rec-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        var card = b.parentNode;
        card.classList.toggle("is-open");
        if (card.classList.contains("is-open") && !card.dataset.done) {
          card.dataset.done = "1";
          decorate(card.querySelector(".rec-full"), card.dataset.id);
        }
      });
    });
  }

  function renderRecitalTargets(root, n) {
    var tg = OUT[n.id]
      .filter(function (e) { return e.k === "explains" || e.k === "relates"; })
      .map(function (e) { return { n: N[e.t], k: e.k }; })
      .filter(function (x) { return x.n; });

    var sec = document.createElement("section");
    sec.className = "block";
    var h = '<div class="block-head"><h2>Explains</h2>' +
      '<span class="block-count">' + tg.length + "</span></div>";
    if (!tg.length) {
      h += '<p class="empty">This recital is general — it maps to no single provision.</p>';
    } else {
      h += '<div class="links">';
      tg.forEach(function (x) {
        h += linkRow(x.n, x.k === "explains" ? "names it" : "topical");
      });
      h += "</div>";
    }
    sec.innerHTML = h;
    root.appendChild(sec);
    wireLinks(sec);
  }

  /* connections rail ------------------------------------------ */

  var connTab = "out";

  // Outgoing and backlinks are tabbed rather than stacked: an article with 15
  // outgoing links would otherwise push its backlinks off the bottom of the rail.
  function renderConnections(n) {
    var outs = OUT[n.id].slice().sort(edgeSort);
    var ins = IN[n.id].slice().sort(edgeSort);

    var h = '<div class="conn-tabs" role="tablist">' +
      '<button class="conn-tab' + (connTab === "out" ? " is-on" : "") + '" data-conn="out" role="tab"' +
        ' aria-selected="' + (connTab === "out") + '">Outgoing<span class="conn-n">' + outs.length + "</span></button>" +
      '<button class="conn-tab' + (connTab === "in" ? " is-on" : "") + '" data-conn="in" role="tab"' +
        ' aria-selected="' + (connTab === "in") + '">Backlinks<span class="conn-n">' + ins.length + "</span></button>" +
      "</div>";

    h += '<div class="conn-pane" data-pane="out"' + (connTab === "out" ? "" : " hidden") + ">" +
      (outs.length ? '<div class="links">' + outs.map(function (e) {
        return linkRow(N[e.t], KIND_LABEL[e.k] || e.k);
      }).join("") + "</div>" : '<p class="empty">Cites nothing else.</p>') + "</div>";

    h += '<div class="conn-pane" data-pane="in"' + (connTab === "in" ? "" : " hidden") + ">" +
      (ins.length ? '<div class="links">' + ins.map(function (e) {
        return linkRow(N[e.s], KIND_LABEL[e.k] || e.k, e.at && e.at[0]);
      }).join("") + "</div>" : '<p class="empty">Nothing points here.</p>') + "</div>";

    el.conn.innerHTML = h;

    el.conn.querySelectorAll(".conn-tab").forEach(function (b) {
      b.addEventListener("click", function () {
        connTab = b.dataset.conn;
        el.conn.querySelectorAll(".conn-tab").forEach(function (x) {
          var on = x.dataset.conn === connTab;
          x.classList.toggle("is-on", on);
          x.setAttribute("aria-selected", on ? "true" : "false");
        });
        el.conn.querySelectorAll(".conn-pane").forEach(function (p) {
          p.hidden = p.dataset.pane !== connTab;
        });
        el.conn.scrollTop = 0;
      });
    });

    wireLinks(el.conn);
    el.conn.scrollTop = 0;
  }

  var KIND_ORDER = { interprets: 0, cites: 1, xcites: 2, annex: 3, explains: 4, relates: 5, uses: 6, concords: 7 };

  function edgeSort(a, b) {
    var oa = a.k in KIND_ORDER ? KIND_ORDER[a.k] : 9;
    var ob = b.k in KIND_ORDER ? KIND_ORDER[b.k] : 9;
    var d = oa - ob;
    if (d) return d;
    var na = N[a.t] || N[a.s], nb = N[b.t] || N[b.s];
    if (!na || !nb) return 0;
    return (na.num - nb.num) || String(na.id).localeCompare(String(nb.id));
  }

  function linkRow(n, kind, para) {
    if (!n) return "";
    return '<button class="link" type="button" data-id="' + n.id + '"' +
      (para ? ' data-para="' + esc(para) + '"' : "") + ">" +
      '<span class="link-id" data-type="' + n.type + '">' + esc(shortLabel(n)) + "</span>" +
      '<span class="link-title">' + esc(nodeTitle(n, 60)) + "</span>" +
      (kind ? '<span class="link-kind">' + esc(kind) + "</span>" : "") +
      "</button>";
  }

  // Articles inserted in 2026 are lettered — 4a, 60a, 75a…75d — so the key,
  // not the number, is what identifies and labels an article.
  function artKey(n) { return n.key || String(n.num); }

  function shortLabel(n) {
    var corpus = n.corpus || (n.id.indexOf(":") > 0 ? n.id.split(":")[0] : "aia");
    var prefix = corpus === "aia" ? "" : ((registryEntry(corpus) || {}).shortTitle || corpus.toUpperCase()) + " ";
    if (n.type === "article") return prefix + "Art. " + artKey(n);
    if (n.type === "recital") return (n.amending ? "Omni. " : "Rec. ") + n.num;
    if (n.type === "annex") return "Annex " + n.roman;
    if (n.type === "guidance") return ((guidanceDoc(n.doc) || {}).short || "") + " § " + n.sec;
    if (n.type === "kimig") return "KI-MIG § " + n.key;
    if (n.type === "gdpr") return "GDPR Art. " + n.key;
    if (n.type === "module") return "MaRisk " + n.key;
    if (n.type === "external") return n.label;
    return "Term " + n.num;
  }

  var STATUS_LABEL = {
    inserted: "New in 2026",
    amended: "Amended in 2026",
    removed: "Removed in 2026"
  };

  function wireLinks(root) {
    root.querySelectorAll(".link").forEach(function (b) {
      b.addEventListener("click", function () {
        go(routeOf(b.dataset.id) + (b.dataset.para ? "/" + b.dataset.para : ""));
      });
      b.addEventListener("mouseenter", function (ev) { tipForNode(N[b.dataset.id], ev); });
      b.addEventListener("mouseleave", function () { tipForNode(null); });
    });
  }

  /* ── in-text decoration ───────────────────────────────────── */

  var ROMAN_ORD = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12, XIII: 13 };

  function decorate(root, selfId) {
    if (!root) return;
    linkifyRefs(root, selfId);
    // The German KI-MIG has none of the Act's English terms to find; its
    // references to the Act arrive already linked in either language. The
    // GDPR has the words but not the meanings: its 'personal data' is its own
    // Article 4, not the Act's definition that points there. Nor does BaFin
    // use the Act's vocabulary: its 'provider' is a cloud service provider.
    var self = N[selfId];
    if (!(self && (inGerman(self) || self.type === "gdpr" || ("act" in self && self.act !== "aia")))) {
      linkifyTerms(root, selfId);
    }
    root.querySelectorAll(".xref").forEach(function (a) {
      a.addEventListener("mouseenter", function (ev) { tipForNode(N[a.dataset.node], ev); });
      a.addEventListener("mouseleave", function () { tipForNode(null); });
    });
    root.querySelectorAll(".term").forEach(function (a) {
      a.addEventListener("mouseenter", function (ev) { tipForTerm(N[a.dataset.node], ev); });
      a.addEventListener("mouseleave", function () { tipForTerm(null); });
      // Clicking follows the href to the definition page — unchanged.
    });
  }

  function textNodes(root) {
    var out = [], w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (t) {
        var p = t.parentNode;
        while (p && p !== root) {
          var tag = p.nodeName;
          if (tag === "A" || tag === "SUP" || (p.classList &&
              (p.classList.contains("xref") || p.classList.contains("term")))) {
            return NodeFilter.FILTER_REJECT;
          }
          p = p.parentNode;
        }
        return t.nodeValue && t.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    var t;
    while ((t = w.nextNode())) out.push(t);
    return out;
  }

  var REF_RE = /\bArticles?\s+(\d{1,3})(\(\d{1,2}\))?|\bAnnexes?\s+(X{0,3}(?:IX|IV|V?I{0,3}))\b|\bRecitals?\s+(\d{1,3})\b|\bSections?\s+(\d{1,2}(?:\.\d{1,2}){1,3})\b/g;

  // "Article 4(4) of Regulation (EU) 2016/679" is the GDPR, not the Act. This
  // is parse.py's DEFLECT_RE and cited_act(), so the links on the page are the
  // edges in the graph: what may follow a reference and hand it to an act.
  var DEFLECT_RE = /^(?:\(\d+\)|\([a-z]+\)|,|first|second|third|fourth|subparagraph|points?|and|or|to|Articles?|\d{1,3}|\s)*(?:(?:of|to)\s+(?:(that)\s+|the\s+[A-Z]{2,8}\s+)?(?:Delegated\s+|Implementing\s+)?(?:Regulation|Directive|Decision|the\s+Charter|the\s+Treaty|Council)|(?:(?:of|under|in)\s+(?:the\s+)?(?:EU\s+)?)?\(?(TFEU|TEU|GDPR|EUDPR|LED|DSA|DMA|UCPD|CCD|ECHR|CER|Charter|DORA|RTS|ITS|RMF|AI\s+Act)\b|(thereof))/;
  var CORPUS_CELEX = { "2024/1689": "aia", "2016/679": "gdpr", "2022/2554": "dora", "2024/1774": "dora-rts-rmf", "2025/532": "dora-rts-sub", "2024/2956": "dora-its-register" };
  var CORPUS_ABBR = { "GDPR": "gdpr", "AI Act": "aia", "DORA": "dora", "RTS": "dora-rts-rmf", "RMF": "dora-rts-rmf", "ITS": "dora-its-register", "DSA": "dsa", "DMA": "dma", "UCPD": "ucpd", "LED": "led", "EUDPR": "eudpr", "TFEU": "tfeu", "TEU": "teu", "Charter": "charter", "ECHR": "echr", "CER": "cer" };

  /* "self" when a reference names no act, "aia" or "gdpr" when it names one
     in the corpus, null for any other act. */
  function citedAct(tail, amending) {
    var m = DEFLECT_RE.exec(tail.slice(0, 90));
    if (!m) return "self";
    if (m[2]) return CORPUS_ABBR[m[2].replace(/\s+/g, " ")] || null;
    if (m[1] || m[3]) return amending ? "self" : null;
    var named = tail.slice(m[0].length, m[0].length + 20);
    for (var celex in CORPUS_CELEX) if (named.indexOf(celex) >= 0) return CORPUS_CELEX[celex];
    return null;
  }

  // The Act cites GDPR definitions by point: "Article 4, point (4), of …".
  var POINT_RE = /^,?\s*point\s+\((\d{1,2})\)/;

  function linkifyRefs(root, selfId) {
    var self = N[selfId];
    var selfDoc = self && self.type === "guidance" ? self.doc : null;
    // The act a reference naming none belongs to. BaFin's are DORA's, which
    // the corpus does not hold (`act` null), so those stay plain text.
    var ownAct = !self ? "aia" : self.corpus || (self.type === "gdpr" ? "gdpr" : "act" in self ? self.act : "aia");
    textNodes(root).forEach(function (t) {
      var s = t.nodeValue;
      REF_RE.lastIndex = 0;
      if (!REF_RE.test(s)) return;
      REF_RE.lastIndex = 0;

      var frag = document.createDocumentFragment(), last = 0, m;
      while ((m = REF_RE.exec(s))) {
        var id = null, para = null;
        var tail = s.slice(m.index + m[0].length);
        var act = m[5] ? null : citedAct(tail, self && self.amending);
        if (act === "self") act = ownAct;
        if (m[1] && act === "gdpr") {
          id = "gdpr:art_" + parseInt(m[1], 10);
          var pt = POINT_RE.exec(tail);
          var num = m[2] ? parseInt(m[2].slice(1, -1), 10) : pt && pt[1];
          // Article 4 numbers points, not paragraphs: "Article 4(4) GDPR" is
          // its point (4).
          if (num) para = N[id] && (N[id].html || "").indexOf('id="p' + num + '"') >= 0 ? "p" + num : "pt" + num;
        } else if (m[1] && act) {
          id = act + ":art_" + parseInt(m[1], 10);
          if (!N[id]) id = "ext:" + act + ":art_" + parseInt(m[1], 10);
          if (m[2]) para = "p" + parseInt(m[2].slice(1, -1), 10);
        } else if (m[3] && act && ROMAN_ORD[m[3]]) {
          id = act + ":anx_" + m[3];
        } else if (m[4] && act) {
          id = act + ":rct_" + parseInt(m[4], 10);
        } else if (m[5] && selfDoc) {
          // Inside the guidelines, "Section 2.7.1" is a section of the same
          // document; elsewhere the word means a Section of the Act itself.
          id = (self.corpus || "aia") + ":gdl_" + selfDoc + "-" + m[5];
        }
        if (!id || !N[id] || id === selfId) continue;

        if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
        var a = document.createElement("a");
        a.className = "xref";
        a.dataset.node = id;
        a.dataset.type = N[id].type;
        a.href = routeOf(id) + (para ? "/" + para : "");
        a.textContent = m[0];
        frag.appendChild(a);
        last = m.index + m[0].length;
      }
      if (!last) return;
      if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
      t.parentNode.replaceChild(frag, t);
    });
  }

  // Marking every occurrence turns the page into a field of underlines, so a term
  // is linked once per block — the first time the reader meets it there.
  function blockOf(node, root) {
    var p = node.parentNode;
    while (p && p !== root) {
      if (p.classList && (p.classList.contains("para") || p.classList.contains("point") ||
          p.classList.contains("doc-p"))) return p;
      p = p.parentNode;
    }
    return root;
  }

  // Defined terms that are also everyday words, and the context that marks
  // the everyday use: "subject (exclusively) to Article 10" is not Article
  // 3(58)'s 'subject'.
  var NOT_A_TERM = { subject: /^\s+(?:[a-z]+ly\s+)?to\b/i };

  function linkifyTerms(root, selfId) {
    if (!TERM_RE) return;
    var seen = new Map();

    textNodes(root).forEach(function (t) {
      var s = t.nodeValue;
      TERM_RE.lastIndex = 0;
      if (!TERM_RE.test(s)) return;
      TERM_RE.lastIndex = 0;

      var block = blockOf(t, root);
      if (!seen.has(block)) seen.set(block, {});
      var done = seen.get(block);

      var frag = document.createDocumentFragment(), last = 0, m;
      while ((m = TERM_RE.exec(s))) {
        var key = m[1].toLowerCase();
        var d = TERM_BY_KEY[key];
        if (!d || d.id === selfId || done[key]) continue;
        if (NOT_A_TERM[key] && NOT_A_TERM[key].test(s.slice(m.index + m[0].length))) continue;
        done[key] = 1;
        if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
        var a = document.createElement("a");
        a.className = "term";
        a.dataset.node = d.id;
        a.href = routeOf(d.id);
        a.textContent = m[0];
        frag.appendChild(a);
        last = m.index + m[0].length;
      }
      if (!last) return;
      if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
      t.parentNode.replaceChild(frag, t);
    });
  }

  /* ── graph wiring ─────────────────────────────────────────── */

  function nodeR(id) {
    var d = (OUT[id] ? OUT[id].length : 0) + (IN[id] ? IN[id].length : 0);
    return Math.max(3.6, Math.min(3.2 + Math.sqrt(d) * 1.15, 13));
  }

  // KI-MIG sections are leaves for the same reason as terms and guidance:
  // § 3 alone cites nine provisions of the Act.
  var LEAF_TYPES = { definition: 1, guidance: 1, kimig: 1 };

  function neighbourhood(id, depth, show) {
    var keep = {}, frontier = [id];
    var focusCorpus = N[id].corpus || N[id].id.split(":")[0];
    keep[id] = 0;
    for (var d = 1; d <= depth; d++) {
      var next = [];
      frontier.forEach(function (cur) {
        (OUT[cur] || []).concat(IN[cur] || []).filter(edgeVisible).forEach(function (e) {
          var other = e.s === cur ? e.t : e.s;
          if (keep[other] != null || !N[other]) return;
          if (!show[N[other].type]) return;
          keep[other] = d;
          // Defined terms and guidance sections are leaves, never routes.
          // 'provider' is used by 161 provisions and a guidance section can
          // cite thirty articles, so hopping through either would drag in
          // most of the Act and call it a neighbourhood.
          // The GDPR is a statute of its own: the walk does not cross into it
          // from the Act, nor out of it into the Act.
          if (!LEAF_TYPES[N[other].type] && (N[other].corpus || N[other].id.split(":")[0]) === focusCorpus) next.push(other);
        });
      });
      frontier = next;
    }
    var ids = Object.keys(keep);
    var set = {};
    ids.forEach(function (i) { set[i] = 1; });
    var nodes = ids.map(function (i) {
      return {
        id: i, type: N[i].type, label: shortLabel(N[i]), title: N[i].title,
        r: i === id ? Math.max(nodeR(i), 8) : nodeR(i), rank: keep[i]
      };
    });
    var edges = EDGES.filter(function (e) { return set[e.s] && set[e.t] && edgeVisible(e); });
    return { nodes: nodes, edges: edges };
  }

  function renderGraphFor(id) {
    if (!mini) return;
    var title = $("#gtitle"), depth = $("#depth");

    var doc = !id && state.route && state.route.kind === "doc" ? state.route.doc : null;
    if (doc) {
      // A document's home: its sections and everything they link to.
      title.textContent = "The document and its links";
      depth.hidden = true;
      var dg = docGraph(doc, state.show);
      mini.setFocus(null).setData(dg.nodes, dg.edges);
      el.gempty.hidden = dg.nodes.length > 0;
      updateLegend(docGraph(doc, ALL_TYPES).nodes);
      return;
    }
    if (!id) {
      // Nothing is open: the rail shows the Act entire, and hop depth is moot.
      title.textContent = "The whole Act";
      depth.hidden = true;
      var sample = wholeGraph(state.show);
      mini.setFocus(null).setData(sample.nodes, sample.edges);
      el.gempty.hidden = sample.nodes.length > 0;
      updateLegend(wholeGraph(ALL_TYPES).nodes);
      return;
    }
    title.textContent = "Neighbourhood";
    depth.hidden = false;
    var g = neighbourhood(id, state.depth, state.show);
    mini.setFocus(id).setData(g.nodes, g.edges);
    el.gempty.hidden = g.nodes.length > 1;
    // Count what is *there*, not what is currently drawn — a legend chip that
    // reads 0 because it is switched off tells the reader nothing.
    updateLegend(neighbourhood(id, state.depth, ALL_TYPES).nodes);
  }

  var COLLECTION = {
    article: "articles", recital: "recitals",
    annex: "annexes", definition: "definitions", guidance: "guidance",
    kimig: "kimig", gdpr: "gdpr", module: "modules", external: "external"
  };

  function docGraph(doc, show) {
    var corpusDoc = CORPUS_DOCS[doc];
    var own = doc === "kimig" || doc === "gdpr" ? DATA[doc]
      : doc.indexOf("gdl-") === 0 ? DATA.guidance.filter(function (g) { return "gdl-" + g.doc === doc; })
      : corpusDoc ? [].concat(corpusDoc.articles || [], corpusDoc.recitals || [], corpusDoc.annexes || [], corpusDoc.definitions || [], corpusDoc.guidance || [], corpusDoc.modules || []) : [];
    var set = {};
    own.forEach(function (n) {
      if (show[n.type]) set[n.id] = 1;
      (OUT[n.id] || []).concat(IN[n.id] || []).filter(edgeVisible).forEach(function (e) {
        var other = e.s === n.id ? e.t : e.s;
        if (N[other] && show[N[other].type]) set[other] = 1;
      });
    });
    var nodes = Object.keys(set).map(function (i) {
      return { id: i, type: N[i].type, label: shortLabel(N[i]), title: N[i].title, r: nodeR(i) };
    });
    var edges = EDGES.filter(function (e) { return set[e.s] && set[e.t] && edgeVisible(e); });
    return { nodes: nodes, edges: edges };
  }

  function wholeGraph(show) {
    var nodes = [], set = {};
    TYPES.forEach(function (t) {
      if (!show[t]) return;
      Object.keys(N).map(function (id) { return N[id]; }).filter(function (n) { return n.type === t; }).forEach(function (n) {
        set[n.id] = 1;
        nodes.push({ id: n.id, type: n.type, label: shortLabel(n), title: n.title, r: nodeR(n.id) });
      });
    });
    var edges = EDGES.filter(function (e) { return set[e.s] && set[e.t] && edgeVisible(e); });
    return { nodes: nodes, edges: edges };
  }

  function edgeFamily(edge) {
    if (edge.k === "xcites") return "cross";
    if (edge.k === "concords") return "editorial";
    if (edge.k === "relates") return "derived";
    return "cited";
  }
  function edgeVisible(edge) { return state.edgeShow[edgeFamily(edge)] !== false; }

  function buildLegend() {
    el.legend.innerHTML = TYPES.map(function (t) {
      return '<button class="lg' + (state.show[t] ? "" : " is-off") + '" type="button" data-type="' + t + '"' +
        ' aria-pressed="' + (state.show[t] ? "true" : "false") + '">' +
        '<span class="lg-dot"></span><span>' + TYPE_LABEL[t] + '</span>' +
        '<span class="lg-n" data-n="' + t + '"></span></button>';
    }).join("");

    el.legend.querySelectorAll(".lg").forEach(function (b) {
      b.addEventListener("click", function () {
        var t = b.dataset.type;
        state.show[t] = !state.show[t];
        b.classList.toggle("is-off", !state.show[t]);
        b.setAttribute("aria-pressed", state.show[t] ? "true" : "false");
        renderGraphFor(state.route && state.route.id);
      });
    });
  }

  function updateLegend(nodes) {
    var count = {};
    nodes.forEach(function (n) { count[n.type] = (count[n.type] || 0) + 1; });
    el.legend.querySelectorAll("[data-n]").forEach(function (s) {
      s.textContent = count[s.dataset.n] || 0;
    });
  }

  function buildOverlayFilters() {
    el.ovFilters.innerHTML = TYPES.map(function (t) {
      return '<button class="lg' + (state.ovShow[t] ? "" : " is-off") + '" type="button" data-type="' + t + '"' +
        ' data-type-color="' + t + '" aria-pressed="' + (state.ovShow[t] ? "true" : "false") + '">' +
        '<span class="lg-dot"></span><span>' + TYPE_LABEL[t] + "</span></button>";
    }).join("") + '<span class="ov-family-label">Connections</span>' +
      [{id:"cited",label:"Cited"},{id:"cross",label:"Cross-corpus"},{id:"editorial",label:"Editorial"},{id:"derived",label:"Topical"}].map(function (f) {
        return '<button class="edge-filter" type="button" data-family="' + f.id + '" aria-pressed="true">' + f.label + '</button>';
      }).join("");
    el.ovFilters.querySelectorAll(".lg").forEach(function (b) {
      b.setAttribute("data-type", b.dataset.type);
      b.addEventListener("click", function () {
        var t = b.dataset.type;
        state.ovShow[t] = !state.ovShow[t];
        b.classList.toggle("is-off", !state.ovShow[t]);
        b.setAttribute("aria-pressed", state.ovShow[t] ? "true" : "false");
        paintOverlay();
      });
    });
    el.ovFilters.querySelectorAll("[data-family]").forEach(function (b) {
      b.addEventListener("click", function () {
        var family = b.dataset.family; state.edgeShow[family] = !state.edgeShow[family];
        b.classList.toggle("is-off", !state.edgeShow[family]);
        b.setAttribute("aria-pressed", state.edgeShow[family] ? "true" : "false");
        paintOverlay(); renderGraphFor(state.route && state.route.id);
      });
    });
  }

  function paintOverlay(seed) {
    var focus = state.ovFocus;
    var scoped = state.ovScope === "focus" && focus && N[focus];

    $("#ov-depth").hidden = !scoped;
    $("#ov-scope").querySelectorAll(".seg-btn").forEach(function (b) {
      b.classList.toggle("is-on", b.dataset.scope === (scoped ? "focus" : "all"));
    });
    $("#ov-scope").querySelector('[data-scope="focus"]').disabled = !focus;

    var g;
    if (scoped) {
      g = neighbourhood(focus, state.ovDepth, state.ovShow);
      $("#ov-title").textContent = N[focus].label;
      el.ovSub.textContent = state.ovDepth + (state.ovDepth === 1 ? " hop · " : " hops · ") +
        g.nodes.length + " provisions · " + g.edges.length + " connections";
    } else {
      g = wholeGraph(state.ovShow);
      $("#ov-title").textContent = "Citation graph";
      el.ovSub.textContent = "The whole Act · " + g.nodes.length + " provisions · " +
        g.edges.length + " connections";
    }

    full.pinFocus = !!scoped;
    full.setFocus(scoped ? focus : (state.route && state.route.id));
    full.setData(g.nodes, g.edges);
    paintGraphList(g);
    syncOverlayView();

    // Grow out of the layout the reader was just looking at, rather than
    // scattering and re-solving from nothing.
    if (seed && scoped) seedFromMini();
  }

  function paintGraphList(g) {
    var nodes = g.nodes.slice().sort(function (a, b) {
      return TYPES.indexOf(a.type) - TYPES.indexOf(b.type) || a.label.localeCompare(b.label, undefined, { numeric: true });
    });
    $("#gfull-list").innerHTML = '<p class="graph-list-intro">' + nodes.length +
      ' provisions in this view. Open a provision to inspect its outgoing links and backlinks.</p><div class="graph-list-grid">' +
      nodes.map(function (node) {
        return '<button class="graph-list-node" type="button" data-id="' + esc(node.id) + '">' +
          '<span class="link-id" data-type="' + node.type + '">' + esc(node.label) + '</span>' +
          '<span class="link-title">' + esc(node.title || node.label) + '</span></button>';
      }).join("") + '</div>';
  }

  function syncOverlayView() {
    var list = state.ovView === "list";
    $("#gfull").hidden = list;
    $("#gfull-list").hidden = !list;
    $(".ov-hint").hidden = list;
    $("#ov-view").querySelectorAll(".seg-btn").forEach(function (button) {
      var on = button.dataset.view === state.ovView;
      button.classList.toggle("is-on", on);
      button.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function seedFromMini() {
    if (!mini || !mini.nodes.length || !full.w) return;
    var s = Math.min(full.w / (mini.w || 1), full.h / (mini.h || 1));
    var moved = 0;
    full.nodes.forEach(function (n) {
      var m = mini.byId[n.id];
      if (!m) return;
      n.x = full.w / 2 + (m.x - mini.w / 2) * s;
      n.y = full.h / 2 + (m.y - mini.h / 2) * s;
      moved++;
    });
    if (moved) { full.fit(); full.kick(0.35); }
  }

  var overlayReturnFocus = null;

  function openOverlay(focus) {
    var wasOpen = !el.overlay.hidden;
    // Expanding from a provision opens on that provision; the top-bar Graph
    // button opens the whole Act. Either way, if a provision is open behind the
    // overlay it stays the focus target, so the Neighbourhood toggle works
    // instead of sitting disabled.
    state.ovFocus = focus || (state.route && state.route.id) || null;
    state.ovScope = focus ? "focus" : "all";
    state.ovDepth = focus ? (state.depth || 1) : (state.ovDepth || 1);
    syncOvDepth();
    if (wasOpen) { paintOverlay(true); return; }

    overlayReturnFocus = document.activeElement;
    el.overlay.hidden = false;
    $(".topbar").inert = true;
    $(".layout").inert = true;
    $("#btn-close").focus();
    requestAnimationFrame(function () {
      full.resize();
      paintOverlay(true);
    });
    document.addEventListener("keydown", escClose);
  }

  function syncOvDepth() {
    $("#ov-depth").querySelectorAll(".seg-btn").forEach(function (b) {
      b.classList.toggle("is-on", +b.dataset.ovdepth === state.ovDepth);
    });
  }

  function closeOverlay(silent) {
    if (el.overlay.hidden) return;
    el.overlay.hidden = true;
    $(".topbar").inert = false;
    $(".layout").inert = false;
    document.removeEventListener("keydown", escClose);
    tipForNode(null);
    if (overlayReturnFocus && overlayReturnFocus.focus) overlayReturnFocus.focus();
    overlayReturnFocus = null;
    if (!silent && /^#\/graph(\/|$)/.test(location.hash)) {
      history.replaceState(null, "", hashOf(state.route));
    }
  }

  function escClose(ev) {
    if (ev.key === "Escape") { closeOverlay(); render(); return; }
    if (ev.key !== "Tab") return;
    var focusable = [].slice.call(el.overlay.querySelectorAll('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'))
      .filter(function (item) { return !item.hidden && item.offsetParent !== null; });
    if (!focusable.length) return;
    var first = focusable[0], last = focusable[focusable.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  }

  /* ── tooltip ──────────────────────────────────────────────── */

  var tipTimer = null;

  function hideTip() {
    if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; }
    el.tip.hidden = true;
  }

  function placeTip(x, y) {
    var r = el.tip.getBoundingClientRect();
    var left = x + 14, top = y + 18;
    if (left + r.width > innerWidth - 8) left = innerWidth - r.width - 8;
    if (top + r.height > innerHeight - 8) top = y - r.height - 14;
    el.tip.style.left = Math.max(8, left) + "px";
    el.tip.style.top = Math.max(8, top) + "px";
  }

  function tipFor(n, ev) { tipForNode(n ? N[n.id] : null, ev); }

  function tipForNode(n, ev) {
    if (!n) { hideTip(); return; }
    if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; }
    el.tip.innerHTML =
      '<div class="tip-id" style="color:var(--c-' + n.type + ')">' + esc(n.label) + "</div>" +
      '<div class="tip-title">' + esc(n.type === "definition" ? "‘" + n.term + "’" : nodeTitle(n, 90)) + "</div>" +
      '<div class="tip-sub">' + (OUT[n.id].length) + " out · " + (IN[n.id].length) + " in</div>";
    el.tip.hidden = false;
    placeTip(ev ? ev.clientX : 0, ev ? ev.clientY : 0);
  }

  // Hovering a defined term shows the definition itself. The short delay stops
  // cards flashing as the cursor sweeps a paragraph; clicking still opens it.
  var TERM_TIP_DELAY = 130;

  function tipForTerm(d, ev) {
    if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; }
    if (!d) { hideTip(); return; }

    var x = ev.clientX, y = ev.clientY;
    tipTimer = setTimeout(function () {
      tipTimer = null;
      var used = IN[d.id].length;
      el.tip.innerHTML =
        '<div class="tip-id" style="color:var(--c-definition)">Article 3, point (' + d.num + ")</div>" +
        '<div class="tip-def">' + esc(d.text) + "</div>" +
        '<div class="tip-sub">Click to open · used by ' + used +
          (used === 1 ? " provision" : " provisions") + "</div>";
      el.tip.hidden = false;
      placeTip(x, y);
    }, TERM_TIP_DELAY);
  }

  /* ── search ───────────────────────────────────────────────── */

  var cursor = -1, hits = [];

  function setSearchCursor(next) {
    cursor = next;
    var rows = el.results.querySelectorAll(".res");
    rows.forEach(function (r, i) {
      var on = i === cursor;
      r.classList.toggle("is-cursor", on);
      r.setAttribute("aria-selected", on ? "true" : "false");
    });
    el.q.setAttribute("aria-activedescendant", cursor >= 0 && rows[cursor] ? rows[cursor].id : "");
    if (rows[cursor]) rows[cursor].scrollIntoView({ block: "nearest" });
  }

  function runSearch(raw) {
    var q = raw.trim().toLowerCase();
    if (q.length < 2) { el.results.hidden = true; el.q.setAttribute("aria-expanded", "false"); return; }

    var words = q.split(/\s+/).filter(Boolean);
    hits = [];

    for (var i = 0; i < SEARCH.length; i++) {
      var s = SEARCH[i], score = 0, ok = true;
      for (var w = 0; w < words.length; w++) {
        var at = s.hay.indexOf(words[w]);
        if (at < 0) { ok = false; break; }
        score += at < s.label.length + s.title.length + 2 ? 60 : 8;
        if (s.title.toLowerCase().indexOf(words[w]) >= 0) score += 40;
        if (s.label.toLowerCase().indexOf(q) >= 0) score += 120;
      }
      if (!ok) continue;
      if (s.type === "article") score += 6;
      hits.push({ s: s, score: score });
    }

    hits.sort(function (a, b) { return b.score - a.score || a.s.id.localeCompare(b.s.id); });
    hits = hits.slice(0, 40);
    cursor = -1;
    el.q.setAttribute("aria-activedescendant", "");

    if (!hits.length) {
      el.results.innerHTML = '<p class="res-empty">Nothing matches “' + esc(raw) + "”.</p>";
    } else {
      el.results.innerHTML = hits.map(function (h, i) {
        var n = N[h.s.id];
        return '<button class="res" id="result-' + i + '" role="option" aria-selected="false" tabindex="-1" type="button" data-i="' + i + '" data-id="' + n.id + '">' +
          '<div class="res-top"><span class="res-id" data-type="' + n.type + '">' + esc(shortLabel(n)) + "</span>" +
          '<span class="res-title">' + esc(n.type === "definition" ? "‘" + n.term + "’" : (nodeTitle(n, 90) || n.label)) + "</span></div>" +
          '<div class="res-snip">' + snippet(h.s.text, words) + "</div></button>";
      }).join("");
      el.results.querySelectorAll(".res").forEach(function (b) {
        b.addEventListener("click", function () { pick(b.dataset.id); });
      });
    }
    el.results.hidden = false;
    el.q.setAttribute("aria-expanded", "true");
  }

  function pick(id) {
    el.results.hidden = true;
    el.q.setAttribute("aria-expanded", "false");
    el.q.setAttribute("aria-activedescendant", "");
    el.q.blur();
    go(routeOf(id));
  }

  // Window the snippet on the first term found, then mark every query term in it.
  function snippet(text, words) {
    var low = text.toLowerCase();
    var at = -1;
    for (var i = 0; i < words.length && at < 0; i++) at = low.indexOf(words[i]);
    if (at < 0) return esc(lede(text, 130));

    var from = Math.max(0, at - 55);
    var cut = text.slice(from, from + 170);
    var out = (from ? "…" : "") + cut + (from + 170 < text.length ? "…" : "");

    var re = new RegExp("(" + words.map(escRe).join("|") + ")", "ig");
    return esc(out).replace(re, "<mark>$1</mark>");
  }

  /* ── chrome ───────────────────────────────────────────────── */

  function wireChrome() {
    el.q.addEventListener("input", function () { runSearch(el.q.value); });
    el.q.addEventListener("focus", function () { if (el.q.value.trim().length > 1) runSearch(el.q.value); });

    el.q.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") {
        el.results.hidden = true;
        el.q.setAttribute("aria-expanded", "false");
        el.q.setAttribute("aria-activedescendant", "");
        el.q.blur();
        return;
      }
      if (el.results.hidden || !hits.length) return;
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        cursor += ev.key === "ArrowDown" ? 1 : -1;
        if (cursor < 0) cursor = hits.length - 1;
        if (cursor >= hits.length) cursor = 0;
        setSearchCursor(cursor);
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        pick(hits[Math.max(cursor, 0)].s.id);
      }
    });

    document.addEventListener("click", function (ev) {
      if (!ev.target.closest(".search")) {
        el.results.hidden = true;
        el.q.setAttribute("aria-expanded", "false");
        el.q.setAttribute("aria-activedescendant", "");
      }
    });

    document.addEventListener("keydown", function (ev) {
      if (ev.key === "/" && document.activeElement !== el.q &&
          !/^(INPUT|TEXTAREA)$/.test(document.activeElement.nodeName)) {
        ev.preventDefault(); el.q.focus(); el.q.select();
      }
      if (ev.key === "g" && ev.target === document.body) go("#/graph");
      if (ev.key === "Escape" && el.overlay.hidden) closeRails();
    });

    // Scoped to the rail's own group: a bare ".seg-btn" also matches the
    // overlay's scope and hop controls, whose buttons carry no data-depth.
    $("#depth").querySelectorAll(".seg-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        var d = +b.dataset.depth;
        if (!d) return;
        $("#depth").querySelectorAll(".seg-btn").forEach(function (x) {
          x.classList.remove("is-on");
        });
        b.classList.add("is-on");
        state.depth = d;
        renderGraphFor(state.route && state.route.id);
      });
    });

    // Expand keeps what you are reading in view; the top-bar button is the
    // whole Act.
    $("#btn-expand").addEventListener("click", function () {
      var id = state.route && state.route.id;
      go(id ? "#/graph/" + encodeURIComponent(id) : "#/graph");
    });
    $("#btn-graph").addEventListener("click", function (ev) {
      ev.preventDefault();
      go("#/graph");
    });

    $("#ov-scope").addEventListener("click", function (ev) {
      var b = ev.target.closest(".seg-btn");
      if (!b || b.disabled) return;
      state.ovScope = b.dataset.scope;
      paintOverlay(false);
    });
    $("#ov-depth").addEventListener("click", function (ev) {
      var b = ev.target.closest(".seg-btn");
      if (!b) return;
      state.ovDepth = +b.dataset.ovdepth;
      syncOvDepth();
      paintOverlay(false);
    });
    $("#ov-view").addEventListener("click", function (ev) {
      var b = ev.target.closest(".seg-btn");
      if (!b) return;
      state.ovView = b.dataset.view;
      syncOverlayView();
      if (state.ovView === "list") $("#gfull-list").focus();
    });
    $("#gfull-list").addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-id]");
      if (!b) return;
      closeOverlay();
      go(routeOf(b.dataset.id));
    });
    $("#btn-close").addEventListener("click", function () { closeOverlay(); render(); });
    $("#btn-theme").addEventListener("click", toggleTheme);

    // A fixed-position card would drift away from its word once the page moves.
    document.addEventListener("scroll", hideTip, true);
    window.addEventListener("blur", hideTip);

    $("#btn-toc").addEventListener("click", function () { toggleRail("show-toc"); });
    $("#btn-links").addEventListener("click", function () { toggleRail("show-graph"); });
    $("#scrim").addEventListener("click", closeRails);
  }

  /* On narrow screens the two rails slide over the reader, one at a time. */
  function toggleRail(cls) {
    var on = document.body.classList.contains(cls);
    closeRails();
    if (!on) {
      document.body.classList.add(cls);
      $("#scrim").hidden = false;
      if (cls === "show-graph" && mini) mini.resize();
    }
    syncRailButtons();
  }

  function closeRails() {
    document.body.classList.remove("show-toc", "show-graph");
    $("#scrim").hidden = true;
    syncRailButtons();
  }

  function syncRailButtons() {
    $("#btn-toc").setAttribute("aria-expanded",
      document.body.classList.contains("show-toc") ? "true" : "false");
    $("#btn-links").setAttribute("aria-expanded",
      document.body.classList.contains("show-graph") ? "true" : "false");
  }

  /* ── theme ────────────────────────────────────────────────── */

  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem("aiact-theme"); } catch (e) {}
    if (!saved) {
      saved = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.dataset.theme = saved;
  }

  function toggleTheme() {
    var next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("aiact-theme", next); } catch (e) {}
    if (mini) mini.draw();
    if (full) full.draw();
  }

  /* ── helpers ──────────────────────────────────────────────── */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  function lede(t, n) {
    t = String(t || "");
    return t.length <= n ? t : t.slice(0, t.lastIndexOf(" ", n) > 0 ? t.lastIndexOf(" ", n) : n) + "…";
  }

  function checkedOn() {
    var value = REGISTRY.generated;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return "";
    var parts = value.split("-"), months = ["January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"];
    var label = (+parts[2]) + " " + months[(+parts[1]) - 1] + " " + parts[0];
    return '<p class="data-checked">Corpus data checked on <time datetime="' + value + '">' + label + "</time>.</p>";
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var a = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, a); }, ms);
    };
  }
})();
