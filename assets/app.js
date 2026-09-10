/* ============================================================
   AI Act Browser — application
   ============================================================ */

(function () {
  "use strict";

  var DATA = null;
  var N = {};            // id -> node
  var OUT = {};          // id -> [edge]
  var IN = {};           // id -> [edge]
  var TERM_RE = null;    // defined terms, longest first
  var TERM_BY_KEY = {};
  var SEARCH = [];

  var TYPES = ["article", "recital", "annex", "definition", "guidance", "kimig"];
  var ALL_TYPES = { article: true, recital: true, annex: true, definition: true, guidance: true, kimig: true };
  var TYPE_LABEL = { article: "Articles", recital: "Recitals", annex: "Annexes", definition: "Terms", guidance: "Guidance", kimig: "KI-MIG" };
  var KIND_LABEL = {
    cites: "cites", annex: "annex", uses: "defined term",
    explains: "cites", relates: "topical", interprets: "interprets"
  };

  var state = {
    route: null,
    depth: 1,
    show: { article: true, recital: true, annex: true, definition: true, guidance: true, kimig: true },
    ovShow: { article: true, recital: true, annex: true, definition: true, guidance: true, kimig: true },
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

    fetch("/data/aiact.json")
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(start)
      .catch(function (err) {
        el.doc.innerHTML =
          '<div class="boot"><p><strong>The Act could not be loaded.</strong></p>' +
          '<p>' + esc(String(err.message || err)) + '</p>' +
          '<p>Run <code>python3 build/build.py</code> to regenerate <code>data/aiact.json</code>.</p></div>';
      });
  });

  function start(data) {
    DATA = data;
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

    window.addEventListener("hashchange", render);
    render();
  }

  function index() {
    var all = DATA.articles.concat(DATA.recitals, DATA.annexes, DATA.definitions,
      DATA.guidance || [], DATA.kimig || []);
    all.forEach(function (n) { N[n.id] = n; OUT[n.id] = []; IN[n.id] = []; });

    DATA.edges.forEach(function (e) {
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
        text: n.textDe ? n.text + " · " + n.textDe : n.text
      };
    });
  }

  /* ── routing ──────────────────────────────────────────────── */

  var ROUTE_TO_ID = { article: "art_", recital: "rct_", annex: "anx_", term: "def_", guidance: "gdl_", kimig: "kimig_" };
  var ID_TO_ROUTE = { art_: "article", rct_: "recital", anx_: "annex", def_: "term", gdl_: "guidance", kimig_: "kimig" };

  function routeOf(id) {
    var m = /^[a-z]+_/.exec(id);
    var p = m && ID_TO_ROUTE[m[0]] ? m[0] : id.slice(0, 4);
    return "#/" + ID_TO_ROUTE[p] + "/" + id.slice(p.length);
  }

  function parseHash() {
    var h = (location.hash || "#/").replace(/^#\/?/, "");
    if (!h) return { kind: "home" };
    var bits = h.split("/");
    if (bits[0] === "graph") {
      var gf = bits[1] ? decodeURIComponent(bits[1]) : null;
      return { kind: "graph", focus: gf && N[gf] ? gf : null };
    }
    if (bits[0] === "changes") return { kind: "changes", focus: bits[1] || null };
    // A document's own home page: #/kimig, #/guidance/pp. Section ids always
    // carry a number (pp-2.3), so a bare slug never collides with one.
    if (bits[0] === "kimig" && !bits[1] && DATA.kimig && DATA.kimig.length) return { kind: "doc", doc: "kimig" };
    if (bits[0] === "guidance" && bits[1] && guidanceDoc(bits[1])) return { kind: "doc", doc: "gdl-" + bits[1] };
    var pref = ROUTE_TO_ID[bits[0]];
    if (!pref || !bits[1]) return { kind: "home" };
    var id = pref + decodeURIComponent(bits[1]);
    if (!N[id]) return { kind: "home" };
    return { kind: "node", id: id, para: bits[2] || null };
  }

  function docRoute(doc) {
    return doc === "kimig" ? "#/kimig" : "#/guidance/" + doc.slice(4);
  }

  /* The hash that reopens a route — where closing the graph overlay returns. */
  function hashOf(route) {
    if (!route) return "#/";
    if (route.kind === "doc") return docRoute(route.doc);
    return route.id ? routeOf(route.id) : "#/";
  }

  function go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  function render() {
    var r = parseHash();

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
      return;
    }
    if (!el.overlay.hidden) closeOverlay(true);

    state.route = r;
    closeRails();

    if (r.kind === "changes") {
      renderChanges(r.focus);
      renderGraphFor(null);
      el.conn.innerHTML = "";
      markToc(null);
      document.title = "What changed in 2026 — AI Act Browser";
    } else if (r.kind === "home") {
      renderHome();
      renderGraphFor(null);
      el.conn.innerHTML = "";
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

  /* ── contents rail ────────────────────────────────────────── */

  /* The rail shows one document at a time: the Act, split into its parts by
     the tabs, or one of the documents attached to it. tocTab is remembered
     while another document is showing, so coming back lands where you were. */
  var tocDoc = "aia", tocTab = "act";
  var TAB_FOR = { article: "act", recital: "recitals", annex: "annexes", definition: "defs" };

  function docList() {
    var km = DATA.kimigMeta || {};
    var list = [{ id: "aia", group: "Regulation", type: "article",
                  name: "AI Act", sub: "Regulation (EU) 2024/1689" }];
    (DATA.guidanceDocs || []).forEach(function (d) {
      list.push({ id: "gdl-" + d.slug, group: "Commission guidance", type: "guidance",
                  name: d.name, sub: d.draft ? "Draft guidelines" : "Guidelines",
                  badge: d.draft ? "draft" : "adopted", draft: d.draft });
    });
    if (DATA.kimig && DATA.kimig.length) {
      list.push({ id: "kimig", group: "National implementation", type: "kimig",
                  name: km.abbr || "KI-MIG", sub: "German implementing law", badge: "in force" });
    }
    return list;
  }

  function docTitle(doc) {
    if (doc === "kimig") return (DATA.kimigMeta || {}).abbr || "KI-MIG";
    var d = guidanceDoc(doc.slice(4));
    return d ? d.title : doc;
  }

  function docOf(n) {
    if (n.type === "guidance") return "gdl-" + n.doc;
    if (n.type === "kimig") return "kimig";
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
      if (o) chooseDoc(o.dataset.doc);
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
    el.docBtn.setAttribute("aria-label", "Contents of " + d.name + " — choose another document");
    var act = tocDoc === "aia";
    el.railTabs.hidden = !act;
    el.docBtn.parentNode.classList.toggle("is-alone", !act);
    el.railTabs.querySelectorAll(".rail-tab").forEach(function (b) {
      var on = b.dataset.tab === tocTab;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
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

  function chooseDoc(id) {
    if (id !== tocDoc) {
      tocDoc = id;
      syncRailHead();
      paintToc();
      markToc(state.route && state.route.id);
      el.toc.scrollTop = 0;
    }
    closeDocMenu(true);
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
      DATA.chapters.forEach(function (c) {
        var arts = DATA.articles.filter(function (a) { return a.chapter === c.roman; });
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
      "<h1>The AI Act, with its recitals attached.</h1></div>";

    h += '<a class="banner" href="#/changes">' +
      '<span class="banner-tag">In force ' + esc(m.inForce) + "</span>" +
      "<span class="+'"banner-text"'+">Amended by the " + esc(m.amendedBy.short) + ": <b>" +
      c.changed + " provisions</b> added or rewritten.</span>" +
      '<span class="banner-go">See what changed →</span></a>';

    /* the Commission's own reading of Articles 5 and 6, section by section */
    if (DATA.guidance && DATA.guidance.length) {
      h += '<div class="block"><div class="block-head"><h2>Commission guidance</h2>' +
        '<span class="block-count">' + DATA.guidance.length + "</span>" +
        '<span class="block-note">attached to the provisions it interprets</span></div>' +
        '<div class="gcards">';
      (DATA.guidanceDocs || []).forEach(function (d) {
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

    /* the German implementing law, cited into the Act provision by provision */
    if (DATA.kimig && DATA.kimig.length) {
      var km = DATA.kimigMeta || {};
      var cited = {};
      DATA.kimig.forEach(function (s) {
        OUT[s.id].forEach(function (e) { if (N[e.t] && N[e.t].type !== "kimig") cited[e.t] = 1; });
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
  function partGrid(type, parts) {
    return '<div class="chapgrid" data-type="' + type + '">' + parts.map(function (p) {
      return '<button class="chapcard" type="button" data-goto="' + p.first + '">' +
        '<span class="chapcard-n">' + esc(p.n) + "</span>" +
        '<span class="chapcard-t"' + (p.lang ? ' lang="' + p.lang + '"' : "") + ">" + esc(p.title) + "</span>" +
        '<span class="chapcard-c">' + p.count + (p.count === 1 ? " sec." : " secs.") + "</span></button>";
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
    el.doc.innerHTML = doc === "kimig" ? kimigHome() : guidanceHome(guidanceDoc(doc.slice(4)));
    wireHome();
  }

  function guidanceHome(d) {
    var secs = DATA.guidance.filter(function (g) { return g.doc === d.slug; });
    var paras = Math.max.apply(null, secs.map(function (g) { return g.paras ? g.paras[1] : 0; }));

    // The note below names the citation and status, so this line doesn't.
    var h = '<nav class="crumb"><a href="#/">The Act</a><i>›</i><span>Guidance</span>' +
      "<i>›</i><span>" + esc(d.name) + "</span></nav>" +
      '<span class="kicker" data-type="guidance">Commission guidance</span>' +
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

    h += '<ul class="doc-facts">' +
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
      b.addEventListener("click", function () { b.parentNode.classList.toggle("is-open"); });
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
      '<button class="chg-head" type="button">' +
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

    /* breadcrumb */
    if (n.type === "article") {
      h += '<nav class="crumb"><a href="#/">The Act</a><i>›</i>' +
        "<span>" + esc(n.chapterLabel) + ": " + esc(n.chapterTitle) + "</span>";
      if (n.sectionLabel) h += "<i>›</i><span>" + esc(n.sectionLabel) + ": " + esc(n.sectionTitle) + "</span>";
      h += "</nav>";
    } else if (n.type === "guidance") {
      h += '<nav class="crumb"><a href="#/">The Act</a><i>›</i><span>Guidance</span>' +
        '<i>›</i><a href="' + docRoute("gdl-" + n.doc) + '">' + esc(n.docName) + "</a>" +
        "<i>›</i><span>" + esc(n.part) + "</span></nav>";
    } else if (n.type === "kimig") {
      h += '<nav class="crumb"><a href="#/">The Act</a><i>›</i><a href="#/kimig">' +
        esc((DATA.kimigMeta || {}).abbr || "KI-MIG") + "</a>" +
        "<i>›</i><span>" + esc(kField(n, "part") + ": " + kField(n, "partTitle")) + "</span>" +
        (n.sub ? "<i>›</i><span>" + esc(kField(n, "sub") + ": " + kField(n, "subTitle")) + "</span>" : "") +
        "</nav>";
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
    } else {
      h += '<h1 class="doc-title">' + esc(n.title || n.label) + "</h1>";
      if (n.type !== "recital") h += '<p class="doc-num">' + esc(n.label) + "</p>";
    }

    /* the text */
    h += '<div class="lawtext" id="lawtext"' + (inGerman(n) ? ' lang="de"' : "") + ">" +
      (n.type === "kimig" ? kField(n, "html") : n.html) + "</div>";

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
    /* Commission guidance attached to the provisions it interprets */
    if (n.type === "article" || n.type === "annex" || n.type === "definition") {
      renderGuidanceFor(el.doc, n);
      renderKimigFor(el.doc, n);
    }
    if (n.type === "guidance") {
      renderGuidanceNav(el.doc, n);
    }
    if (n.type === "kimig") {
      renderKimigNav(el.doc, n);
    }

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
    if (n.type === "guidance") return "Commission guidance";
    if (n.type === "kimig") return "German implementing law";
    return "Defined term";
  }

  function guidanceNote(d) {
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
      .filter(function (e) { return e.k === "interprets" && N[e.s] && N[e.s].type === "guidance"; })
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

    var sec = document.createElement("section");
    sec.className = "block";
    var h = '<div class="block-head"><h2>Interprets</h2>' +
      '<span class="block-count">' + tg.length + "</span></div>";
    if (tg.length) {
      h += '<div class="links">' + tg.map(function (x) { return linkRow(x, ""); }).join("") + "</div>";
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
      .filter(function (e) { return N[e.s] && N[e.s].type === "kimig"; })
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

  function setKimigLang(lang, n) {
    if (lang === kimigLang) return;
    kimigLang = lang;
    try { sessionStorage.setItem("aiact-kimig-lang", lang); } catch (e) {}
    renderNode(n, null);
    if (tocDoc === "kimig") { paintToc(); markToc(n.id); }
    var btn = el.doc.querySelector('[data-lang="' + lang + '"]');
    if (btn) btn.focus();
  }

  function renderKimigNav(root, n) {
    var at = DATA.kimig.findIndex(function (s) { return s.id === n.id; });
    var prev = at > 0 ? DATA.kimig[at - 1] : null;
    var next = at >= 0 && at < DATA.kimig.length - 1 ? DATA.kimig[at + 1] : null;
    if (!prev && !next) return;
    var sec = document.createElement("section");
    sec.className = "block";
    sec.innerHTML = '<div class="gl-nav">' +
      (prev ? '<a class="gl-nav-a" href="' + routeOf(prev.id) + '">← § ' + esc(prev.key) +
        ' <span>' + esc(lede(kField(prev, "title"), 46)) + "</span></a>" : "<span></span>") +
      (next ? '<a class="gl-nav-a gl-nav-next" href="' + routeOf(next.id) + '">§ ' + esc(next.key) +
        ' <span>' + esc(lede(kField(next, "title"), 46)) + "</span> →</a>" : "") +
      "</div>";
    root.appendChild(sec);
  }


  function recitalsFor(id) {
    return IN[id]
      .filter(function (e) { return e.k === "explains" || e.k === "relates"; })
      .filter(function (e) { return N[e.s] && N[e.s].type === "recital"; })
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
        return linkRow(N[e.s], KIND_LABEL[e.k] || e.k);
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

  var KIND_ORDER = { interprets: 0, cites: 1, annex: 2, explains: 3, relates: 4, uses: 5 };

  function edgeSort(a, b) {
    var oa = a.k in KIND_ORDER ? KIND_ORDER[a.k] : 9;
    var ob = b.k in KIND_ORDER ? KIND_ORDER[b.k] : 9;
    var d = oa - ob;
    if (d) return d;
    var na = N[a.t] || N[a.s], nb = N[b.t] || N[b.s];
    if (!na || !nb) return 0;
    return (na.num - nb.num) || String(na.id).localeCompare(String(nb.id));
  }

  function linkRow(n, kind) {
    if (!n) return "";
    return '<button class="link" type="button" data-id="' + n.id + '">' +
      '<span class="link-id" data-type="' + n.type + '">' + esc(shortLabel(n)) + "</span>" +
      '<span class="link-title">' + esc(nodeTitle(n, 60)) + "</span>" +
      (kind ? '<span class="link-kind">' + esc(kind) + "</span>" : "") +
      "</button>";
  }

  // Articles inserted in 2026 are lettered — 4a, 60a, 75a…75d — so the key,
  // not the number, is what identifies and labels an article.
  function artKey(n) { return n.key || String(n.num); }

  function shortLabel(n) {
    if (n.type === "article") return "Art. " + artKey(n);
    if (n.type === "recital") return (n.amending ? "Omni. " : "Rec. ") + n.num;
    if (n.type === "annex") return "Annex " + n.roman;
    if (n.type === "guidance") return (n.doc === "pp" ? "Proh." : "HR") + " § " + n.sec;
    if (n.type === "kimig") return "KI-MIG § " + n.key;
    return "Term " + n.num;
  }

  var STATUS_LABEL = {
    inserted: "New in 2026",
    amended: "Amended in 2026",
    removed: "Removed in 2026"
  };

  function wireLinks(root) {
    root.querySelectorAll(".link").forEach(function (b) {
      b.addEventListener("click", function () { go(routeOf(b.dataset.id)); });
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
    // references to the Act arrive already linked in either language.
    if (!(N[selfId] && inGerman(N[selfId]))) linkifyTerms(root, selfId);
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

  // "Article 4(4) of Regulation (EU) 2016/679" is the GDPR, not the Act.
  var OTHER_ACT_RE = /^\s*(?:\(\d+\)|\([a-z]+\)|,|and|or|to|first|second|third|subparagraphs?|points?|\d{1,3}|\s)*of\s+(?:Regulation|Directive|Decision|the\s+Charter|the\s+Treaty|Council)/;

  function linkifyRefs(root, selfId) {
    var selfDoc = N[selfId] && N[selfId].type === "guidance" ? N[selfId].doc : null;
    textNodes(root).forEach(function (t) {
      var s = t.nodeValue;
      REF_RE.lastIndex = 0;
      if (!REF_RE.test(s)) return;
      REF_RE.lastIndex = 0;

      var frag = document.createDocumentFragment(), last = 0, m;
      while ((m = REF_RE.exec(s))) {
        var id = null, para = null;
        if (m[1]) {
          id = "art_" + parseInt(m[1], 10);
          if (m[2]) para = "p" + parseInt(m[2].slice(1, -1), 10);
        } else if (m[3] && ROMAN_ORD[m[3]]) {
          id = "anx_" + m[3];
        } else if (m[4]) {
          id = "rct_" + parseInt(m[4], 10);
        } else if (m[5] && selfDoc) {
          // Inside the guidelines, "Section 2.7.1" is a section of the same
          // document; elsewhere the word means a Section of the Act itself.
          id = "gdl_" + selfDoc + "-" + m[5];
        }
        if (!id || !N[id] || id === selfId) continue;
        if ((m[1] || m[3] || m[4]) && OTHER_ACT_RE.test(s.slice(m.index + m[0].length))) continue;

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
    keep[id] = 0;
    for (var d = 1; d <= depth; d++) {
      var next = [];
      frontier.forEach(function (cur) {
        (OUT[cur] || []).concat(IN[cur] || []).forEach(function (e) {
          var other = e.s === cur ? e.t : e.s;
          if (keep[other] != null || !N[other]) return;
          if (!show[N[other].type]) return;
          keep[other] = d;
          // Defined terms and guidance sections are leaves, never routes.
          // 'provider' is used by 161 provisions and a guidance section can
          // cite thirty articles, so hopping through either would drag in
          // most of the Act and call it a neighbourhood.
          if (!LEAF_TYPES[N[other].type]) next.push(other);
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
    var edges = DATA.edges.filter(function (e) { return set[e.s] && set[e.t]; });
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
    kimig: "kimig"
  };

  function docGraph(doc, show) {
    var own = doc === "kimig" ? DATA.kimig
      : DATA.guidance.filter(function (g) { return "gdl-" + g.doc === doc; });
    var set = {};
    own.forEach(function (n) {
      if (show[n.type]) set[n.id] = 1;
      (OUT[n.id] || []).concat(IN[n.id] || []).forEach(function (e) {
        var other = e.s === n.id ? e.t : e.s;
        if (N[other] && show[N[other].type]) set[other] = 1;
      });
    });
    var nodes = Object.keys(set).map(function (i) {
      return { id: i, type: N[i].type, label: shortLabel(N[i]), title: N[i].title, r: nodeR(i) };
    });
    var edges = DATA.edges.filter(function (e) { return set[e.s] && set[e.t]; });
    return { nodes: nodes, edges: edges };
  }

  function wholeGraph(show) {
    var nodes = [], set = {};
    TYPES.forEach(function (t) {
      if (!show[t]) return;
      DATA[COLLECTION[t]].forEach(function (n) {
        set[n.id] = 1;
        nodes.push({ id: n.id, type: n.type, label: shortLabel(n), title: n.title, r: nodeR(n.id) });
      });
    });
    var edges = DATA.edges.filter(function (e) { return set[e.s] && set[e.t]; });
    return { nodes: nodes, edges: edges };
  }

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

    // Grow out of the layout the reader was just looking at, rather than
    // scattering and re-solving from nothing.
    if (seed && scoped) seedFromMini();
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

    el.overlay.hidden = false;
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
    document.removeEventListener("keydown", escClose);
    tipForNode(null);
    if (!silent && /^#\/graph(\/|$)/.test(location.hash)) {
      history.replaceState(null, "", hashOf(state.route));
    }
  }

  function escClose(ev) {
    if (ev.key === "Escape") { closeOverlay(); render(); }
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

    if (!hits.length) {
      el.results.innerHTML = '<p class="res-empty">Nothing matches “' + esc(raw) + "”.</p>";
    } else {
      el.results.innerHTML = hits.map(function (h, i) {
        var n = N[h.s.id];
        return '<button class="res" type="button" data-i="' + i + '" data-id="' + n.id + '">' +
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
      if (ev.key === "Escape") { el.results.hidden = true; el.q.blur(); return; }
      if (el.results.hidden || !hits.length) return;
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        cursor += ev.key === "ArrowDown" ? 1 : -1;
        if (cursor < 0) cursor = hits.length - 1;
        if (cursor >= hits.length) cursor = 0;
        var rows = el.results.querySelectorAll(".res");
        rows.forEach(function (r, i) { r.classList.toggle("is-cursor", i === cursor); });
        if (rows[cursor]) rows[cursor].scrollIntoView({ block: "nearest" });
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        pick(hits[Math.max(cursor, 0)].s.id);
      }
    });

    document.addEventListener("click", function (ev) {
      if (!ev.target.closest(".search")) {
        el.results.hidden = true;
        el.q.setAttribute("aria-expanded", "false");
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

  function debounce(fn, ms) {
    var t;
    return function () {
      var a = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, a); }, ms);
    };
  }
})();
