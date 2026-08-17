/* ============================================================
   Force-directed citation graph on a 2D canvas.
   No dependencies: at this size (≤ 380 nodes, ≤ 2100 edges) an
   O(n²) repulsion pass is cheaper than a quadtree, and it keeps
   the whole thing under a few KB.
   ============================================================ */

(function (global) {
  "use strict";

  var REDUCED = global.matchMedia &&
    global.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function Graph(canvas, opts) {
    opts = opts || {};
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.nodes = [];
    this.edges = [];
    this.byId = {};
    this.focusId = null;

    this.tx = 0; this.ty = 0; this.scale = 1;
    this.alpha = 0;
    this.raf = null;
    this.hover = null;
    this.drag = null;
    this.panning = null;

    this.labelMode = opts.labelMode || "auto";   // "auto" | "focus" | "none"
    // Dimming everything but the focus reads well in the small rail; in the
    // full view it fights exploration, so there focus only gets a ring.
    this.dimFocus = opts.dimFocus !== false;
    // A "neighbourhood of X" view should keep X in the middle; letting the
    // simulation carry it to the edge defeats the point of the view.
    this.pinFocus = !!opts.pinFocus;
    this.onSelect = opts.onSelect || function () {};
    this.onHover = opts.onHover || function () {};
    this.colors = opts.colors || {};

    this._bind();
    this.resize();
  }

  /* ── data ─────────────────────────────────────────────────── */

  Graph.prototype.setData = function (nodes, edges, keepPositions) {
    var prev = keepPositions ? this.byId : {};
    var w = this.w || 600, h = this.h || 400;

    this.nodes = nodes.map(function (n, i) {
      var old = prev[n.id];
      var a = (i / nodes.length) * Math.PI * 2;
      var r = 40 + Math.sqrt(i) * 16;
      return {
        id: n.id, type: n.type, label: n.label, title: n.title,
        deg: n.deg || 1, rank: n.rank == null ? 2 : n.rank,
        r: n.r || 5,
        x: old ? old.x : w / 2 + Math.cos(a) * r + (Math.random() - 0.5),
        y: old ? old.y : h / 2 + Math.sin(a) * r + (Math.random() - 0.5),
        vx: 0, vy: 0
      };
    });

    this.byId = {};
    for (var i = 0; i < this.nodes.length; i++) this.byId[this.nodes[i].id] = this.nodes[i];

    // Label priority: the best-connected nodes keep their label longest as the
    // view zooms out, so a dense graph stays legible instead of going to mush.
    this.nodes.slice().sort(function (a, b) { return b.r - a.r; })
      .forEach(function (n, i) { n.lrank = i; });
    this._order = null;

    var self = this;
    this.edges = edges.filter(function (e) {
      return self.byId[e.s] && self.byId[e.t];
    }).map(function (e) {
      return { s: self.byId[e.s], t: self.byId[e.t], k: e.k };
    });

    this.userMoved = false;
    this.kick();
    return this;
  };

  Graph.prototype.setFocus = function (id) { this.focusId = id; this.draw(); return this; };

  /* ── simulation ───────────────────────────────────────────── */

  Graph.prototype.kick = function (a) {
    this.alpha = a == null ? 1 : a;
    if (REDUCED) {
      for (var i = 0; i < 260 && this.alpha > 0.004; i++) this.tick();
      this.fit();
      this.draw();
      return;
    }
    this.run();
  };

  Graph.prototype.run = function () {
    if (this.raf) return;
    var self = this, settled = 0;
    (function frame() {
      self.raf = requestAnimationFrame(frame);
      if (self.drag || self.alpha > 0.004) {
        self.tick();
        // Keep the whole layout framed while it settles — but the moment the
        // reader pans, zooms or drags, the view is theirs.
        if (!self.userMoved && self.alpha > 0.02) self.fit();
      } else if (!self.dirty) {
        cancelAnimationFrame(self.raf); self.raf = null;
      }
      self.dirty = false;
      self.draw();
    })();
  };

  Graph.prototype.tick = function () {
    var n = this.nodes, len = n.length, i, j, a, b;
    if (!len) return;

    var cx = this.w / 2, cy = this.h / 2;
    var big = len > 80;
    // Denser graphs need a longer natural edge length to stay readable.
    var spread = Math.sqrt((this.w * this.h) / Math.max(len, 1));
    var repel = spread * spread * (big ? 1.25 : 0.62);
    var linkLen = spread * (big ? 1.5 : len <= 25 ? 1.05 : 0.72);
    var linkK = big ? 0.022 : 0.045;
    var grav = big ? 0.005 : 0.014;
    var cutoff = repel * 900;

    for (i = 0; i < len; i++) {
      a = n[i];
      for (j = i + 1; j < len; j++) {
        b = n[j];
        var dx = b.x - a.x, dy = b.y - a.y;
        var d2 = dx * dx + dy * dy;
        if (d2 < 1e-4) { dx = (Math.random() - 0.5) * 0.4; dy = (Math.random() - 0.5) * 0.4; d2 = 0.16; }
        if (d2 > cutoff) continue;                 // far pairs contribute nothing
        var f = repel / d2;
        var d = Math.sqrt(d2);
        var ux = dx / d, uy = dy / d;
        a.vx -= ux * f; a.vy -= uy * f;
        b.vx += ux * f; b.vy += uy * f;
      }
    }

    for (i = 0; i < this.edges.length; i++) {
      var e = this.edges[i];
      a = e.s; b = e.t;
      var ex = b.x - a.x, ey = b.y - a.y;
      var ed = Math.sqrt(ex * ex + ey * ey) || 0.001;
      var k = (ed - linkLen) * linkK;
      var kx = (ex / ed) * k, ky = (ey / ed) * k;
      a.vx += kx; a.vy += ky;
      b.vx -= kx; b.vy -= ky;
    }

    for (i = 0; i < len; i++) {
      a = n[i];

      if (this.pinFocus && a.id === this.focusId && !(this.drag && this.drag.node === a)) {
        a.x = cx; a.y = cy; a.vx = 0; a.vy = 0;
        continue;
      }

      // Gentle pull to centre, stronger on the focus node so it sits mid-frame.
      var pull = a.id === this.focusId ? grav * 2.6 : grav;
      a.vx += (cx - a.x) * pull;
      a.vy += (cy - a.y) * pull;

      if (this.drag && this.drag.node === a) { a.vx = 0; a.vy = 0; continue; }
      a.vx *= 0.82; a.vy *= 0.82;
      var sp = Math.hypot(a.vx, a.vy);
      if (sp > 24) { a.vx = a.vx / sp * 24; a.vy = a.vy / sp * 24; }
      a.x += a.vx * this.alpha;
      a.y += a.vy * this.alpha;
    }

    this.alpha *= 0.982;
  };

  /* ── view ─────────────────────────────────────────────────── */

  Graph.prototype.resize = function () {
    var rect = this.canvas.getBoundingClientRect();
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    this.w = Math.max(rect.width, 1);
    this.h = Math.max(rect.height, 1);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dirty = true;
    this.draw();
  };

  Graph.prototype.fit = function (pad) {
    if (!this.nodes.length) return;
    pad = pad == null ? 42 : pad;

    // Frame the 2nd–98th percentile rather than the extremes: a handful of
    // loosely-attached nodes drifting outward should not shrink the whole view.
    var xs = this.nodes.map(function (n) { return n.x; }).sort(function (a, b) { return a - b; });
    var ys = this.nodes.map(function (n) { return n.y; }).sort(function (a, b) { return a - b; });
    var q = this.nodes.length > 30 ? 0.02 : 0;
    var lo = Math.floor(xs.length * q), hi = Math.ceil(xs.length * (1 - q)) - 1;
    var x0 = xs[lo], x1 = xs[hi], y0 = ys[lo], y1 = ys[hi];

    var bw = Math.max(x1 - x0, 1), bh = Math.max(y1 - y0, 1);
    var s = Math.min((this.w - pad * 2) / bw, (this.h - pad * 2) / bh);
    this.scale = Math.max(0.12, Math.min(s, 3.2));
    this.tx = this.w / 2 - ((x0 + x1) / 2) * this.scale;
    this.ty = this.h / 2 - ((y0 + y1) / 2) * this.scale;
    this.dirty = true;
  };

  Graph.prototype.toWorld = function (px, py) {
    return { x: (px - this.tx) / this.scale, y: (py - this.ty) / this.scale };
  };

  Graph.prototype.nodeAt = function (px, py) {
    var p = this.toWorld(px, py), best = null, bd = Infinity;
    for (var i = 0; i < this.nodes.length; i++) {
      var n = this.nodes[i];
      var d = Math.hypot(n.x - p.x, n.y - p.y);
      var hit = (n.r + 7) / Math.max(this.scale, 0.4);
      if (d < hit && d < bd) { bd = d; best = n; }
    }
    return best;
  };

  /* ── paint ────────────────────────────────────────────────── */

  Graph.prototype.draw = function () {
    var c = this.ctx;
    if (!c) return;
    c.clearRect(0, 0, this.w, this.h);
    if (!this.nodes.length) return;

    var css = getComputedStyle(document.documentElement);
    var col = {
      article: css.getPropertyValue("--c-article").trim(),
      recital: css.getPropertyValue("--c-recital").trim(),
      annex: css.getPropertyValue("--c-annex").trim(),
      definition: css.getPropertyValue("--c-definition").trim()
    };
    var inkMuted = css.getPropertyValue("--ink-3").trim();
    var ink = css.getPropertyValue("--ink").trim();
    var panel = css.getPropertyValue("--panel").trim();

    // Two strengths of highlight. Hovering is a deliberate probe, so it dims
    // the rest hard. A resting focus should still show its own edges lit —
    // otherwise the centred node looks unconnected — but only push the rest
    // gently back, so the graph stays explorable.
    var focusNode = (this.dimFocus || this.pinFocus) && this.focusId
      ? this.byId[this.focusId] : null;
    var hl = this.hover || focusNode;
    var hard = !!this.hover;
    var near = null;
    if (hl) {
      near = {};
      near[hl.id] = 1;
      for (var i = 0; i < this.edges.length; i++) {
        var e = this.edges[i];
        if (e.s === hl) near[e.t.id] = 1;
        if (e.t === hl) near[e.s.id] = 1;
      }
    }

    c.save();
    c.translate(this.tx, this.ty);
    c.scale(this.scale, this.scale);

    /* edges */
    c.lineWidth = 1 / this.scale;
    for (var j = 0; j < this.edges.length; j++) {
      var ed = this.edges[j];
      var lit = near && (near[ed.s.id] && near[ed.t.id]) &&
                (ed.s === hl || ed.t === hl);
      c.beginPath();
      c.moveTo(ed.s.x, ed.s.y);
      c.lineTo(ed.t.x, ed.t.y);
      if (lit) {
        c.strokeStyle = col[ed.t.type] || inkMuted;
        c.globalAlpha = 0.75;
        c.lineWidth = 1.6 / this.scale;
      } else {
        c.strokeStyle = inkMuted;
        var base = this.nodes.length < 60 ? 0.32 : 0.16;
        c.globalAlpha = near ? (hard ? 0.07 : 0.13) : base;
        c.lineWidth = 1 / this.scale;
      }
      c.stroke();
    }
    c.globalAlpha = 1;

    /* nodes */
    for (var k = 0; k < this.nodes.length; k++) {
      var n = this.nodes[k];
      var dim = near && !near[n.id];
      var isFocus = n.id === this.focusId;

      c.globalAlpha = dim ? (hard ? 0.2 : 0.6) : 1;
      c.beginPath();
      c.arc(n.x, n.y, n.r, 0, 6.2832);
      c.fillStyle = col[n.type] || inkMuted;
      c.fill();

      // A surface ring keeps overlapping marks separable.
      c.lineWidth = 1.5 / this.scale;
      c.strokeStyle = panel;
      c.stroke();

      if (isFocus) {
        c.globalAlpha = 1;
        c.beginPath();
        c.arc(n.x, n.y, n.r + 4.5 / this.scale + 2, 0, 6.2832);
        c.strokeStyle = col[n.type] || ink;
        c.lineWidth = 2 / this.scale;
        c.stroke();
      }
    }
    c.globalAlpha = 1;

    /* labels — a budget, spent on the best-connected nodes first, so a dense
       view never turns into overlapping text */
    if (this.labelMode !== "none") {
      var budget;
      if (this.nodes.length <= 40) budget = Infinity;
      else if (this.scale > 1.6) budget = Infinity;
      else if (this.scale > 1.0) budget = 90;
      else if (this.scale > 0.6) budget = 40;
      else budget = 16;

      c.textAlign = "center";
      c.textBaseline = "top";

      // Most important labels are placed first and later ones that would collide
      // are dropped, so text never stacks on text.
      if (!this._order || this._order.length !== this.nodes.length) {
        this._order = this.nodes.slice().sort(function (a, b) { return a.lrank - b.lrank; });
      }
      var placed = [];

      for (var m = 0; m < this._order.length; m++) {
        var q = this._order[m];
        var isF = q.id === this.focusId;
        var lit2 = near && near[q.id];
        // Hovering always reveals the neighbourhood's labels, budget or not.
        if (!isF && !lit2 && q.lrank >= budget) continue;
        if (hard && near && !near[q.id] && !isF) continue;

        var size = (isF ? 12 : 10.5) / this.scale;
        c.font = (isF ? "600 " : "500 ") + size + 'px "IBM Plex Mono", monospace';
        var txt = q.label;
        var tw = c.measureText(txt).width;
        var padx = 3 / this.scale;
        var bx = q.x - tw / 2 - padx, by = q.y + q.r + 3 / this.scale;
        var bw2 = tw + padx * 2, bh2 = size * 1.25;

        var clash = false;
        for (var z = 0; z < placed.length; z++) {
          var r2 = placed[z];
          if (bx < r2[0] + r2[2] && bx + bw2 > r2[0] && by < r2[1] + r2[3] && by + bh2 > r2[1]) {
            clash = true; break;
          }
        }
        if (clash && !isF) continue;
        placed.push([bx, by, bw2, bh2]);

        c.globalAlpha = near && !near[q.id] ? (hard ? 0.25 : 0.55) : 0.95;
        c.fillStyle = panel;
        c.fillRect(bx, by, bw2, bh2);
        c.fillStyle = isF ? ink : (col[q.type] || ink);
        c.fillText(txt, q.x, by + size * 0.1);
      }
      c.globalAlpha = 1;
    }

    c.restore();
  };

  /* ── interaction ──────────────────────────────────────────── */

  Graph.prototype._bind = function () {
    var self = this, cv = this.canvas;

    function pos(ev) {
      var r = cv.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    }

    cv.addEventListener("pointerdown", function (ev) {
      cv.setPointerCapture(ev.pointerId);
      var p = pos(ev);
      var n = self.nodeAt(p.x, p.y);
      if (n) {
        var w = self.toWorld(p.x, p.y);
        self.drag = { node: n, dx: n.x - w.x, dy: n.y - w.y, moved: 0 };
        self.userMoved = true;
        self.alpha = Math.max(self.alpha, 0.45);
        self.run();
      } else {
        self.panning = { x: p.x, y: p.y, tx: self.tx, ty: self.ty, moved: 0 };
        self.userMoved = true;
      }
    });

    cv.addEventListener("pointermove", function (ev) {
      var p = pos(ev);

      if (self.drag) {
        var w = self.toWorld(p.x, p.y);
        self.drag.node.x = w.x + self.drag.dx;
        self.drag.node.y = w.y + self.drag.dy;
        self.drag.moved++;
        self.dirty = true;
        return;
      }
      if (self.panning) {
        self.tx = self.panning.tx + (p.x - self.panning.x);
        self.ty = self.panning.ty + (p.y - self.panning.y);
        self.panning.moved++;
        self.dirty = true;
        self.draw();
        return;
      }

      var n = self.nodeAt(p.x, p.y);
      if (n !== self.hover) {
        self.hover = n;
        cv.style.cursor = n ? "pointer" : "grab";
        self.onHover(n, ev);
        self.draw();
      } else if (n) {
        self.onHover(n, ev);
      }
    });

    function release(ev) {
      if (self.drag) {
        if (self.drag.moved < 3) self.onSelect(self.drag.node);
        self.drag = null;
        self.alpha = Math.max(self.alpha, 0.2);
        self.run();
      }
      self.panning = null;
      if (ev && cv.hasPointerCapture && cv.hasPointerCapture(ev.pointerId)) {
        cv.releasePointerCapture(ev.pointerId);
      }
    }
    cv.addEventListener("pointerup", release);
    cv.addEventListener("pointercancel", release);

    cv.addEventListener("pointerleave", function () {
      if (self.hover) { self.hover = null; self.onHover(null); self.draw(); }
    });

    cv.addEventListener("wheel", function (ev) {
      ev.preventDefault();
      self.userMoved = true;
      var p = pos(ev);
      var f = Math.exp(-ev.deltaY * 0.0016);
      var s2 = Math.max(0.08, Math.min(self.scale * f, 6));
      f = s2 / self.scale;
      self.tx = p.x - (p.x - self.tx) * f;
      self.ty = p.y - (p.y - self.ty) * f;
      self.scale = s2;
      self.dirty = true;
      self.draw();
    }, { passive: false });

    cv.addEventListener("dblclick", function () { self.userMoved = false; self.fit(); self.draw(); });
  };

  Graph.prototype.destroy = function () {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  };

  global.Graph = Graph;
})(window);
