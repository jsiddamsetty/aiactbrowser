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

  var TYPES = ["article", "recital", "annex", "definition"];
  var TYPE_LABEL = { article: "Articles", recital: "Recitals", annex: "Annexes", definition: "Terms" };
  var KIND_LABEL = {
    cites: "cites", annex: "annex", uses: "defined term",
    explains: "cites", relates: "topical"
  };

  var state = {
    route: null,
    depth: 1,
    show: { article: true, recital: true, annex: true, definition: false },
    ovShow: { article: true, recital: true, annex: true, definition: true }
  };

  var el = {};
  var mini = null, full = null;

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
          '<p>Run <code>python3 build/parse.py</code> to regenerate <code>data/aiact.json</code>.</p></div>';
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
    var all = DATA.articles.concat(DATA.recitals, DATA.annexes, DATA.definitions);
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
        hay: (n.label + " " + (n.title || "") + " " + n.text).toLowerCase(),
        text: n.text
      };
    });
  }

  /* ── routing ──────────────────────────────────────────────── */

  var ROUTE_TO_ID = { article: "art_", recital: "rct_", annex: "anx_", term: "def_" };
  var ID_TO_ROUTE = { art_: "article", rct_: "recital", anx_: "annex", def_: "term" };

  function routeOf(id) {
    var p = id.slice(0, 4);
    return "#/" + ID_TO_ROUTE[p] + "/" + id.slice(4);
  }

  function parseHash() {
    var h = (location.hash || "#/").replace(/^#\/?/, "");
    if (!h) return { kind: "home" };
    var bits = h.split("/");
    if (bits[0] === "graph") return { kind: "graph" };
    var pref = ROUTE_TO_ID[bits[0]];
    if (!pref || !bits[1]) return { kind: "home" };
    var id = pref + decodeURIComponent(bits[1]);
    if (!N[id]) return { kind: "home" };
    return { kind: "node", id: id, para: bits[2] || null };
  }

  function go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  function render() {
    var r = parseHash();

    if (r.kind === "graph") {
      if (!state.route) { state.route = { kind: "home" }; renderHome(); }
      openOverlay();
      return;
    }
    if (!el.overlay.hidden) closeOverlay(true);

    state.route = r;
    closeRails();

    if (r.kind === "home") {
      renderHome();
      renderGraphFor(null);
      el.conn.innerHTML = "";
      markToc(null);
      document.title = "AI Act Browser — Regulation (EU) 2024/1689";
    } else {
      renderNode(N[r.id], r.para);
      renderGraphFor(r.id);
      showTocTab(TAB_FOR[N[r.id].type]);
      markToc(r.id);
      document.title = N[r.id].label + " — AI Act Browser";
    }
    el.doc.parentNode.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  /* ── contents rail ────────────────────────────────────────── */

  var tocTab = "act";
  var TAB_FOR = { article: "act", recital: "recitals", annex: "annexes", definition: "defs" };

  /* Follow the reader: opening a recital switches the rail to the recital list. */
  function showTocTab(tab) {
    if (!tab || tab === tocTab) return;
    var btn = document.querySelector('.rail-tab[data-tab="' + tab + '"]');
    if (btn) btn.click();
  }

  function buildToc() {
    document.querySelectorAll(".rail-tab").forEach(function (b) {
      b.addEventListener("click", function () {
        document.querySelectorAll(".rail-tab").forEach(function (x) { x.classList.remove("is-on"); });
        b.classList.add("is-on");
        tocTab = b.dataset.tab;
        paintToc();
        markToc(state.route && state.route.id);
      });
    });
    paintToc();
  }

  function paintToc() {
    var h = "";

    if (tocTab === "act") {
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
          h += tocLink(a.id, "Art. " + a.num, a.title);
        });
        h += "</div></div>";
      });
    } else if (tocTab === "recitals") {
      DATA.recitals.forEach(function (r) {
        h += tocLink(r.id, String(r.num), lede(r.text, 70));
      });
    } else if (tocTab === "annexes") {
      DATA.annexes.forEach(function (a) {
        h += tocLink(a.id, a.roman, a.title);
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

  function tocLink(id, num, name) {
    return '<button class="tl" type="button" data-id="' + id + '">' +
      '<span class="tl-num">' + esc(num) + '</span>' +
      '<span class="tl-name">' + esc(name || "") + "</span></button>";
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
      "<h1>The AI Act, with its recitals attached.</h1>" +
      "<p>Every article carries the recitals that explain it, the provisions it cites, " +
      "the provisions that cite back, and the defined terms it turns on — with a graph " +
      "big enough to actually navigate.</p></div>";

    h += '<div class="stats">';
    [["article", c.articles, "Articles"], ["recital", c.recitals, "Recitals"],
     ["annex", c.annexes, "Annexes"], ["definition", c.definitions, "Defined terms"]]
      .forEach(function (s) {
        h += '<button class="stat" type="button" data-type="' + s[0] + '" data-tab="' +
          (s[0] === "article" ? "act" : s[0] === "definition" ? "defs" : s[0] + "s") + '">' +
          '<div class="stat-n">' + s[1] + "</div><div class=\"stat-k\">" + s[2] + "</div></button>";
      });
    h += '<button class="stat" type="button" data-open="graph">' +
      '<div class="stat-n">' + c.edges + '</div><div class="stat-k">Connections</div></button>';
    h += "</div>";

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

    el.doc.querySelectorAll("[data-goto]").forEach(function (b) {
      b.addEventListener("click", function () { if (b.dataset.goto) go(routeOf(b.dataset.goto)); });
    });
    el.doc.querySelectorAll(".stat[data-tab]").forEach(function (b) {
      b.addEventListener("click", function () {
        var t = document.querySelector('.rail-tab[data-tab="' + b.dataset.tab + '"]');
        if (t) t.click();
        document.body.classList.add("show-toc");
      });
    });
    var og = el.doc.querySelector('[data-open="graph"]');
    if (og) og.addEventListener("click", function () { go("#/graph"); });
  }

  function renderNode(n, para) {
    var h = "";

    /* breadcrumb */
    if (n.type === "article") {
      h += '<nav class="crumb"><a href="#/">The Act</a><i>›</i>' +
        "<span>" + esc(n.chapterLabel) + ": " + esc(n.chapterTitle) + "</span>";
      if (n.sectionLabel) h += "<i>›</i><span>" + esc(n.sectionLabel) + ": " + esc(n.sectionTitle) + "</span>";
      h += "</nav>";
    } else {
      h += '<nav class="crumb"><a href="#/">The Act</a><i>›</i><span>' +
        esc(TYPE_LABEL[n.type]) + "</span></nav>";
    }

    h += '<span class="kicker" data-type="' + n.type + '">' + esc(kickerText(n)) + "</span>";

    if (n.type === "definition") {
      h += '<h1 class="doc-title">‘' + esc(n.term) + "’</h1>" +
        '<p class="doc-num">Article 3, point (' + n.num + ")</p>";
    } else {
      h += '<h1 class="doc-title">' + esc(n.title || n.label) + "</h1>";
      if (n.type !== "recital") h += '<p class="doc-num">' + esc(n.label) + "</p>";
    }

    /* meta strip */
    var outs = OUT[n.id], ins = IN[n.id];
    h += '<div class="meta">' +
      cell("Words", n.words) +
      cell("Outgoing", outs.length) +
      cell("Backlinks", ins.length);
    if (n.type === "article") {
      var recs = recitalsFor(n.id);
      h += cell("Recitals", recs.length);
    }
    h += "</div>";

    /* the text */
    h += '<div class="lawtext" id="lawtext">' + n.html + "</div>";

    el.doc.innerHTML = h;

    decorate($("#lawtext"), n.id);

    /* recitals — the layer the source sites leave out */
    if (n.type === "article" || n.type === "annex") {
      renderRecitals(el.doc, n);
    }
    if (n.type === "recital") {
      renderRecitalTargets(el.doc, n);
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
    if (n.type === "article") return "Article " + n.num;
    if (n.type === "recital") return "Recital " + n.num;
    if (n.type === "annex") return "Annex " + n.roman;
    return "Defined term";
  }

  function cell(k, v) {
    return '<div class="meta-cell"><div class="meta-k">' + k + '</div><div class="meta-v">' + v + "</div></div>";
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
      h += '<span class="block-note">' +
        (explicit ? explicit + " name this provision · " : "") +
        "others matched by topic</span>";
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

  function renderConnections(n) {
    var outs = OUT[n.id].slice().sort(edgeSort);
    var ins = IN[n.id].slice().sort(edgeSort);

    var h = "";
    h += '<section class="block"><div class="block-head"><h2>Outgoing</h2>' +
      '<span class="block-count">' + outs.length + "</span></div>";
    h += outs.length ? '<div class="links">' + outs.map(function (e) {
      return linkRow(N[e.t], KIND_LABEL[e.k] || e.k);
    }).join("") + "</div>" : '<p class="empty">Cites nothing else.</p>';
    h += "</section>";

    h += '<section class="block"><div class="block-head"><h2>Backlinks</h2>' +
      '<span class="block-count">' + ins.length + "</span></div>";
    h += ins.length ? '<div class="links">' + ins.map(function (e) {
      return linkRow(N[e.s], KIND_LABEL[e.k] || e.k);
    }).join("") + "</div>" : '<p class="empty">Nothing points here.</p>';
    h += "</section>";

    el.conn.innerHTML = h;
    wireLinks(el.conn);
    el.conn.scrollTop = 0;
  }

  var KIND_ORDER = { cites: 0, annex: 1, explains: 2, relates: 3, uses: 4 };

  function edgeSort(a, b) {
    var oa = a.k in KIND_ORDER ? KIND_ORDER[a.k] : 9;
    var ob = b.k in KIND_ORDER ? KIND_ORDER[b.k] : 9;
    var d = oa - ob;
    if (d) return d;
    var na = N[a.t] || N[a.s], nb = N[b.t] || N[b.s];
    return (na && nb) ? na.num - nb.num : 0;
  }

  function linkRow(n, kind) {
    if (!n) return "";
    return '<button class="link" type="button" data-id="' + n.id + '">' +
      '<span class="link-id" data-type="' + n.type + '">' + esc(shortLabel(n)) + "</span>" +
      '<span class="link-title">' + esc(n.type === "definition" ? n.term : (n.title || lede(n.text, 60))) + "</span>" +
      (kind ? '<span class="link-kind">' + esc(kind) + "</span>" : "") +
      "</button>";
  }

  function shortLabel(n) {
    if (n.type === "article") return "Art. " + n.num;
    if (n.type === "recital") return "Rec. " + n.num;
    if (n.type === "annex") return "Annex " + n.roman;
    return "Term " + n.num;
  }

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
    linkifyTerms(root, selfId);
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

  var REF_RE = /\bArticles?\s+(\d{1,3})(\(\d{1,2}\))?|\bAnnexes?\s+(X{0,3}(?:IX|IV|V?I{0,3}))\b/g;

  function linkifyRefs(root, selfId) {
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
          next.push(other);
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

    if (!id) {
      // Nothing is open: the rail shows the Act entire, and hop depth is moot.
      title.textContent = "The whole Act";
      depth.hidden = true;
      var sample = wholeGraph(state.show);
      mini.setFocus(null).setData(sample.nodes, sample.edges);
      el.gempty.hidden = sample.nodes.length > 0;
      updateLegend(sample.nodes);
      return;
    }
    title.textContent = "Neighbourhood";
    depth.hidden = false;
    var g = neighbourhood(id, state.depth, state.show);
    mini.setFocus(id).setData(g.nodes, g.edges);
    el.gempty.hidden = g.nodes.length > 1;
    updateLegend(g.nodes);
  }

  var COLLECTION = {
    article: "articles", recital: "recitals",
    annex: "annexes", definition: "definitions"
  };

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

  function paintOverlay() {
    var g = wholeGraph(state.ovShow);
    full.setFocus(state.route && state.route.id).setData(g.nodes, g.edges);
    el.ovSub.textContent = g.nodes.length + " provisions · " + g.edges.length + " connections";
  }

  function openOverlay() {
    if (!el.overlay.hidden) return;
    el.overlay.hidden = false;
    requestAnimationFrame(function () {
      full.resize();
      paintOverlay();
      full.kick(1);
    });
    document.addEventListener("keydown", escClose);
  }

  function closeOverlay(silent) {
    if (el.overlay.hidden) return;
    el.overlay.hidden = true;
    document.removeEventListener("keydown", escClose);
    tipForNode(null);
    if (!silent && location.hash === "#/graph") {
      history.replaceState(null, "", state.route && state.route.id ? routeOf(state.route.id) : "#/");
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
      '<div class="tip-title">' + esc(n.type === "definition" ? "‘" + n.term + "’" : (n.title || lede(n.text, 90))) + "</div>" +
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
          '<span class="res-title">' + esc(n.type === "definition" ? "‘" + n.term + "’" : (n.title || n.label)) + "</span></div>" +
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

    document.querySelectorAll(".seg-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        document.querySelectorAll(".seg-btn").forEach(function (x) { x.classList.remove("is-on"); });
        b.classList.add("is-on");
        state.depth = +b.dataset.depth;
        renderGraphFor(state.route && state.route.id);
      });
    });

    $("#btn-expand").addEventListener("click", function () { go("#/graph"); });
    $("#btn-graph").addEventListener("click", function () { go("#/graph"); });
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
