// Document map viewer (docs-kit site/src/lib/graph.ts writes data.js: window.DOCGRAPH = {nodes, kinds, areas}).
// A force-directed graph on a canvas (charge, links, centre, collision; like d3-force), no library.
// Hover: a document and its neighbours. Click: the panel (summary, links both ways, front matter relations,
// similar documents and why). 주변만: only documents within 1-3 steps of the selected one (Obsidian local graph).
// Nothing selected: the panel shows 점검 (documents with no connection, pairs worth linking).
(function () {
  "use strict";
  var D = window.DOCGRAPH;
  var $ = function (id) { return document.getElementById(id); };
  if (!D) return;
  $("status").hidden = true;
  var embed = document.documentElement.classList.contains("embed");
  var target = embed ? "_top" : "_self";
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  };
  var KIND = {}, KIND_ORDER = D.kinds.map(function (k) { return k[0]; });
  D.kinds.forEach(function (k, i) { KIND[k[0]] = { name: k[1], slot: k[0] === "list" ? 0 : i + 1 }; });
  // topics (roadmap tracks + 공통): the map's main grouping. Colour slots follow the ring order.
  var TOPICS = D.topics || [], TOPIC = {}, HAS_TOPICS = TOPICS.length > 0;
  TOPICS.forEach(function (t, i) { TOPIC[t[0]] = { name: t[1], slot: t[0] === "common" ? 0 : (i % 7) + 1 }; });
  function topicOf(n) { return (n.topics && n.topics[0]) || "common"; }
  var AREA_SLOT = {};
  D.areas.forEach(function (a, i) { AREA_SLOT[a] = (i % 7) + 1; });

  // ---- model ----
  var N = D.nodes;
  N.forEach(function (n, i) { n.i = i; n.inn = []; n.deg = 0; });
  N.forEach(function (n) { n.out.forEach(function (j) { N[j].inn.push(n.i); }); });
  var EDGES = [], seen = {};
  function addEdge(a, b, type, label) {
    var key = Math.min(a, b) + "-" + Math.max(a, b);
    var e = seen[key];
    if (!e) { e = seen[key] = { a: a, b: b, types: {}, labels: [] }; EDGES.push(e); }
    e.types[type] = true;
    if (label) e.labels.push(label);
  }
  N.forEach(function (n) {
    n.out.forEach(function (j) { addEdge(n.i, j, "link"); });
    n.rel.forEach(function (r) { addEdge(n.i, r.j, "rel", r.label); });
    n.sim.forEach(function (s) { addEdge(n.i, s.j, "sim"); });
  });
  EDGES.forEach(function (e) {
    e.type = e.types.rel ? "rel" : e.types.link ? "link" : "sim";
    if (e.type !== "sim") { N[e.a].deg++; N[e.b].deg++; }
  });
  N.forEach(function (n) { n.r = Math.min(17, 4 + 2.1 * Math.sqrt(n.deg)); });

  // ---- state ----
  var show = { kinds: {}, topics: {}, edges: { link: true, rel: true, sim: false } };  // 비슷한 내용: lines on demand
  KIND_ORDER.forEach(function (k) { show.kinds[k] = k !== "list"; });
  TOPICS.forEach(function (t) { show.topics[t[0]] = true; });
  var selected = null, hover = null, query = "", depth = 0;
  var colorBy = HAS_TOPICS ? "topic" : "k", group = HAS_TOPICS ? "topic" : "link";
  if (!HAS_TOPICS) {
    [].forEach.call(document.querySelectorAll('#color option[value="topic"], #group option[value="topic"]'),
      function (o) { o.remove(); });
  }
  $("color").value = colorBy; $("group").value = group;

  // ---- filters bar ----
  function count(k) { return N.filter(function (n) { return n.k === k; }).length; }
  function shapeOf(k) { return k === "list" ? "ring" : ""; }
  $("kinds").innerHTML = KIND_ORDER.map(function (k) {
    return '<span class="chip' + (show.kinds[k] ? "" : " off") + '" data-k="' + k + '" title="눌러서 보이기/숨기기">' +
      '<i class="sw ' + shapeOf(k) + '" style="--c:var(--s' + KIND[k].slot + ')"></i>' + esc(KIND[k].name) +
      ' <span class="n">' + count(k) + "</span></span>";
  }).join("");
  $("topics").innerHTML = TOPICS.map(function (t) {
    var n = N.filter(function (x) { return topicOf(x) === t[0] && x.k !== "list"; }).length;
    return '<span class="chip" data-t="' + t[0] + '" title="눌러서 보이기/숨기기"><i class="sw" style="--c:var(--s' +
      TOPIC[t[0]].slot + ')"></i>' + esc(t[1]) + ' <span class="n">' + n + "</span></span>";
  }).join("");
  $("topics").hidden = !HAS_TOPICS;
  $("edges").innerHTML = [["link", "본문 링크"], ["rel", "머리말 관계"], ["sim", "비슷한 내용"]].map(function (e) {
    return '<span class="chip' + (show.edges[e[0]] ? "" : " off") + '" data-e="' + e[0] + '"><i class="ln ' + e[0] + '"></i>' + e[1] + "</span>";
  }).join("");
  $("bar").addEventListener("click", function (ev) {
    var c = ev.target.closest(".chip");
    if (!c) return;
    if (c.dataset.k) { show.kinds[c.dataset.k] = !show.kinds[c.dataset.k]; c.classList.toggle("off"); }
    if (c.dataset.t) { show.topics[c.dataset.t] = !show.topics[c.dataset.t]; c.classList.toggle("off"); }
    if (c.dataset.e) { show.edges[c.dataset.e] = !show.edges[c.dataset.e]; c.classList.toggle("off"); }
    refresh(true);
  });
  $("group").onchange = function () { group = this.value; reheat(0.7, true); };
  $("color").onchange = function () { colorBy = this.value; draw(); paintLegend(); };
  $("depth").onchange = function () { depth = +this.value; refresh(true); };
  $("q").addEventListener("input", function () { query = this.value.trim().toLowerCase(); draw(); });
  $("q").addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter") return;
    var m = N.filter(function (n) { return n.vis && matches(n); });
    if (m.length) select(m[0].i, true);
  });
  function paintLegend() {
    [["kinds", "k"], ["topics", "topic"]].forEach(function (x) {
      [].forEach.call($(x[0]).querySelectorAll(".sw"), function (sw) { sw.classList.toggle("mute", colorBy !== x[1]); });
    });
  }
  function matches(n) {
    if (!query) return false;
    return (n.t + " " + n.short + " " + n.id).toLowerCase().indexOf(query) >= 0;
  }

  // ---- visibility ----
  var VIS = [], VE = [];
  function within(start, d) {
    var dist = {}, q = [start];
    dist[start] = 0;
    while (q.length) {
      var x = q.shift();
      if (dist[x] >= d) continue;
      EDGES.forEach(function (e) {
        if (!show.edges[e.type]) return;
        var y = e.a === x ? e.b : e.b === x ? e.a : -1;
        if (y >= 0 && dist[y] === undefined && show.kinds[N[y].k]) { dist[y] = dist[x] + 1; q.push(y); }
      });
    }
    return dist;
  }
  function refresh(heat) {
    var local = depth && selected !== null ? within(selected, depth) : null;
    N.forEach(function (n) {
      n.vis = show.kinds[n.k] && (!HAS_TOPICS || show.topics[topicOf(n)] !== false) && (!local || local[n.i] !== undefined);
      if (n.i === selected) n.vis = true;
    });
    VIS = N.filter(function (n) { return n.vis; });
    VE = EDGES.filter(function (e) { return show.edges[e.type] && N[e.a].vis && N[e.b].vis; });
    var cnt = {};
    VE.forEach(function (e) { cnt[e.a] = (cnt[e.a] || 0) + 1; cnt[e.b] = (cnt[e.b] || 0) + 1; });
    VE.forEach(function (e) { e.bias = cnt[e.a] / (cnt[e.a] + cnt[e.b]); e.str = 1 / Math.min(cnt[e.a], cnt[e.b]); });
    if (heat) reheat(0.5, true);
    else draw();
  }

  // ---- layout: a small d3-force ----
  var seed = 7;
  function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
  var anchors = {};
  KIND_ORDER.forEach(function (k, i) {
    var a = (i / KIND_ORDER.length) * Math.PI * 2;
    anchors[k] = { x: Math.cos(a) * 320, y: Math.sin(a) * 320 };
  });
  var tAnchor = {}, ring = TOPICS.filter(function (t) { return t[0] !== "common"; });
  ring.forEach(function (t, i) {
    var a = (i / ring.length) * Math.PI * 2 - Math.PI / 2;
    tAnchor[t[0]] = { x: Math.cos(a) * 580, y: Math.sin(a) * 430 };
  });
  tAnchor.common = { x: 0, y: 0 };
  function anchorOf(n) {
    if (ASK && ASK.rank[n.i] !== undefined) return ASK.spot[n.i];     // ranked by the question: near the centre
    if (group === "k") return anchors[n.k];
    if (group !== "topic" || !HAS_TOPICS) return null;
    var t = n.topics && n.topics.length ? n.topics : ["common"], a = tAnchor[t[0]] || tAnchor.common;
    if (t.length < 2 || !tAnchor[t[1]]) return a;
    var b = tAnchor[t[1]];                           // two topics: between them, nearer the first
    return { x: a.x * 0.62 + b.x * 0.38, y: a.y * 0.62 + b.y * 0.38 };
  }
  N.forEach(function (n) {
    var a = anchorOf(n) || anchors[n.k];
    n.x = a.x * 0.6 + (rnd() - 0.5) * 160; n.y = a.y * 0.6 + (rnd() - 0.5) * 160; n.vx = 0; n.vy = 0;
  });
  var alpha = 1, running = false;
  var DIST = { link: 70, rel: 55, sim: 95 }, LSTR = { link: 0.7, rel: 1, sim: 0.35 };
  function tick() {
    var i, j, a, b, dx, dy, l, k;
    // links
    VE.forEach(function (e) {
      a = N[e.a]; b = N[e.b];
      dx = b.x + b.vx - a.x - a.vx; dy = b.y + b.vy - a.y - a.vy;
      l = Math.sqrt(dx * dx + dy * dy) || 1e-6;
      l = (l - DIST[e.type] - a.r - b.r) / l * alpha * e.str * LSTR[e.type];
      dx *= l; dy *= l;
      b.vx -= dx * e.bias; b.vy -= dy * e.bias;
      a.vx += dx * (1 - e.bias); a.vy += dy * (1 - e.bias);
    });
    // charge (and collision)
    for (i = 0; i < VIS.length; i++) {
      a = VIS[i];
      for (j = i + 1; j < VIS.length; j++) {
        b = VIS[j];
        dx = b.x - a.x; dy = b.y - a.y;
        l = dx * dx + dy * dy;
        if (l < 1) { dx = rnd() - 0.5; dy = rnd() - 0.5; l = dx * dx + dy * dy; }
        if (l < 360000) {
          k = -260 * alpha / l;
          a.vx += dx * k; a.vy += dy * k; b.vx -= dx * k; b.vy -= dy * k;
        }
        var min = a.r + b.r + 6;
        if (l < min * min) {
          var d = Math.sqrt(l), push = (min - d) / d * 0.5;
          a.vx -= dx * push; a.vy -= dy * push; b.vx += dx * push; b.vy += dy * push;
        }
      }
    }
    // pull to the topic's (or kind's) place; with "링크만", only a weak pull to the centre
    VIS.forEach(function (n) {
      var a = anchorOf(n), tx = a ? a.x : 0, ty = a ? a.y : 0, s = a ? 0.2 : 0.03;
      if (ASK && ASK.rank[n.i] !== undefined) s = 0.5;
      else if (ASK) { var d0 = Math.sqrt(n.x * n.x + n.y * n.y) || 1; if (d0 < ASK.clear) { n.vx += n.x / d0 * 4 * alpha; n.vy += n.y / d0 * 4 * alpha; } }
      n.vx += (tx - n.x) * s * alpha; n.vy += (ty - n.y) * s * alpha;
    });
    VIS.forEach(function (n) {
      if (n.fx !== undefined) { n.x = n.fx; n.y = n.fy; n.vx = n.vy = 0; return; }
      n.vx *= 0.6; n.vy *= 0.6; n.x += n.vx; n.y += n.vy;
    });
    alpha += (0 - alpha) * 0.0228;
  }
  function reheat(a, follow) { alpha = Math.max(alpha, a); if (follow) fitFor(60); }

  // ---- view: a night sky ----
  var cv = $("cv"), ctx = cv.getContext("2d"), wrap = $("wrap");
  var view = { x: 0, y: 0, k: 1 }, W = 0, H = 0, dpr = window.devicePixelRatio || 1;
  var still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var STARS = [];
  for (var si = 0; si < 320; si++) {
    STARS.push({ x: rnd() * 2400, y: rnd() * 1600, r: rnd() < 0.08 ? 1.3 : 0.3 + rnd() * 0.7,
                 a: 0.15 + rnd() * 0.55, f: 0.4 + rnd() * 1.6, p: rnd() * 6.28, d: 0.03 + rnd() * 0.07 });
  }
  function resize() {
    W = wrap.clientWidth; H = wrap.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
  }
  function bounds() {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    VIS.forEach(function (n) {
      x0 = Math.min(x0, n.x - n.r); y0 = Math.min(y0, n.y - n.r); x1 = Math.max(x1, n.x + n.r); y1 = Math.max(y1, n.y + n.r);
    });
    var k = Math.max(0.15, Math.min((W - 80) / (x1 - x0 || 1), (H - 80) / (y1 - y0 || 1), 2.2));
    return { k: k, x: W / 2 - (x0 + x1) / 2 * k, y: H / 2 - (y0 + y1) / 2 * k };
  }
  function fit() { if (VIS.length) { var f = bounds(); view.k = f.k; view.x = f.x; view.y = f.y; } }
  function toScreen(n) { return [n.x * view.k + view.x, n.y * view.k + view.y]; }
  // The sky is dark in both themes; colours are the palette's hues, lifted to glow on it.
  var SKY = { k0: "#8d94b0", k1: "#5aa2ff", k2: "#ff8a52", k3: "#3fe0a6", k4: "#ffc53d", k5: "#ff8fc0",
              k6: "#45d16e", k7: "#ab9dff" };
  function readColors() {}
  function colorOf(n) {
    if (colorBy === "area") return n.area ? SKY["k" + AREA_SLOT[n.area]] : SKY.k0;
    if (colorBy === "topic") return SKY["k" + ((TOPIC[topicOf(n)] || { slot: 0 }).slot)];
    return SKY["k" + KIND[n.k].slot];
  }
  function rgba(hex, a) {
    var v = parseInt(hex.slice(1), 16);
    return "rgba(" + (v >> 16) + "," + ((v >> 8) & 255) + "," + (v & 255) + "," + a + ")";
  }
  function neighbours(i) {
    var s = {};
    s[i] = true;
    VE.forEach(function (e) { if (e.a === i) s[e.b] = true; if (e.b === i) s[e.a] = true; });
    return s;
  }
  var time = 0;
  function draw() {
    if (!W) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    // sky and stars (stars drift slower than the map: depth)
    var g = ctx.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.8);
    g.addColorStop(0, "#141c38"); g.addColorStop(0.55, "#0a0f22"); g.addColorStop(1, "#04060d");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    STARS.forEach(function (st) {
      var x = ((st.x + view.x * st.d) % 2400 + 2400) % 2400, y = ((st.y + view.y * st.d) % 1600 + 1600) % 1600;
      if (x > W || y > H) return;
      ctx.globalAlpha = st.a * (still ? 1 : 0.65 + 0.35 * Math.sin(time * st.f + st.p));
      ctx.fillStyle = "#dfe6ff";
      ctx.beginPath(); ctx.arc(x, y, st.r, 0, 6.283); ctx.fill();
    });
    var focus = hover !== null ? hover : selected;
    var near = focus !== null ? neighbours(focus) : null;
    var found = query ? {} : null;
    if (found) N.forEach(function (n) { if (n.vis && matches(n)) found[n.i] = true; });
    var ranked = ASK ? ASK.rank : null;
    var lit = function (i) { return (!near || near[i]) && (!found || found[i]) && (!ranked || near || ranked[i] !== undefined); };
    if (HAS_TOPICS && colorBy === "topic") nebulae(near || found ? 0.45 : 1);
    // edges: faint threads of light; the focus's edges glow in the colours of both ends
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    VE.forEach(function (e) {
      var a = N[e.a], b = N[e.b], p = toScreen(a), q = toScreen(b);
      var on = near ? (near[e.a] && near[e.b] && (e.a === focus || e.b === focus)) : !found;
      ctx.setLineDash(e.type === "sim" ? [3, 5] : []);
      if (near && on) {
        var lg = ctx.createLinearGradient(p[0], p[1], q[0], q[1]);
        lg.addColorStop(0, rgba(colorOf(a), 0.95)); lg.addColorStop(1, rgba(colorOf(b), 0.95));
        ctx.strokeStyle = lg; ctx.globalAlpha = 1; ctx.lineWidth = e.type === "rel" ? 2.2 : 1.4;
      } else {
        ctx.strokeStyle = "#c8d4ff";
        ctx.globalAlpha = (e.type === "rel" ? 0.26 : e.type === "sim" ? 0.2 : 0.11) * (on ? 1 : 0.25);
        ctx.lineWidth = e.type === "rel" ? 1.2 : 0.8;
      }
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
    });
    ctx.setLineDash([]);
    // documents: a soft glow and a plain dot (index pages hollow)
    VIS.forEach(function (n) {
      var target = (near && near[n.i]) || n.i === focus ? 1 : 0;
      n.h = (n.h || 0) + (target - (n.h || 0)) * 0.2;
      var p = toScreen(n), c = colorOf(n), on = lit(n.i);
      var r = Math.max(2.2, n.r * Math.sqrt(view.k) * 0.8) * (1 + 0.35 * n.h);
      var pulse = still ? 1 : 1 + 0.08 * Math.sin(time * 1.3 + n.i);
      var dim = on ? 1 : 0.12;
      ctx.globalCompositeOperation = "lighter";
      var glow = r * (3.2 + 1.6 * n.h) * pulse;
      var rg = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], glow);
      rg.addColorStop(0, rgba(c, 0.55 * dim)); rg.addColorStop(0.35, rgba(c, 0.18 * dim)); rg.addColorStop(1, rgba(c, 0));
      ctx.globalAlpha = 1; ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(p[0], p[1], glow, 0, 6.283); ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = dim;
      if (n.k === "list") {                        // index pages: a hollow ring
        ctx.strokeStyle = c; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 6.283); ctx.stroke();
      } else {
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 6.283); ctx.fill();
        var hg = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r);   // a softly brighter centre
        hg.addColorStop(0, "rgba(255,255,255,0.4)"); hg.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = hg;
        ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 6.283); ctx.fill();
      }
      if (ranked && ranked[n.i] !== undefined) {   // the rank of the document for the question
        var rk = ranked[n.i], br = 8;
        ctx.globalAlpha = 1; ctx.fillStyle = rk === 1 ? "#ffcf5a" : "#f0b47e";
        ctx.beginPath(); ctx.arc(p[0] + r + 4, p[1] - r - 4, br, 0, 6.283); ctx.fill();
        ctx.fillStyle = "#111"; ctx.font = "bold 10.5px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(String(rk), p[0] + r + 4, p[1] - r - 3.5);
      }
      if (n.i === selected) {
        var pr = r + 5;
        ctx.globalAlpha = 1; ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(p[0], p[1], pr, 0, 6.283); ctx.stroke();
      }
    });
    // labels: the brightest stars, the focus and its neighbours, matches; the rest fade in as you zoom
    var hubs = VIS.slice().sort(function (a, b) { return b.deg - a.deg; }).slice(0, Math.max(8, Math.round(VIS.length * 0.12)));
    var hubSet = {};
    hubs.forEach(function (n) { hubSet[n.i] = true; });
    ctx.globalCompositeOperation = "source-over";
    ctx.font = "11.5px " + getComputedStyle(document.body).fontFamily;
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    var boxes = [];
    var order = VIS.slice().sort(function (a, b) {
      var ra = ASK && ASK.rank[a.i] !== undefined ? 100 - ASK.rank[a.i] : 0, rb = ASK && ASK.rank[b.i] !== undefined ? 100 - ASK.rank[b.i] : 0;
      return (b.i === focus) - (a.i === focus) || rb - ra || (b.i === selected) - (a.i === selected) || b.deg - a.deg;
    });
    var zoomIn = Math.max(0, Math.min(1, (view.k - 1.5) / 0.6));   // like Obsidian: names fade in as you zoom
    order.forEach(function (n) {
      var a = near ? (near[n.i] ? 1 : 0) : found ? (found[n.i] ? 1 : 0) : ranked ? (ranked[n.i] !== undefined ? 1 : 0) :
        hubSet[n.i] ? 0.85 : 0.75 * zoomIn;
      if (a < 0.05 || !lit(n.i)) return;
      var p = toScreen(n), r = Math.max(2.2, n.r * Math.sqrt(view.k) * 0.8) * (1 + 0.35 * (n.h || 0));
      var label = (n.short ? n.short + " " : "") + n.t;
      if (label.length > 26) label = label.slice(0, 25) + "…";
      var w = ctx.measureText(label).width, ty = p[1] + r + 6, bx = [p[0] - w / 2 - 3, ty - 1, p[0] + w / 2 + 3, ty + 15];
      if (boxes.some(function (o) { return bx[0] < o[2] && bx[2] > o[0] && bx[1] < o[3] && bx[3] > o[1]; })) return;
      boxes.push(bx);
      ctx.globalAlpha = a;
      ctx.shadowColor = "rgba(0,0,0,0.9)"; ctx.shadowBlur = 6;
      ctx.fillStyle = n.i === focus ? "#ffffff" : "#dbe3ff";
      ctx.fillText(label, p[0], ty);
      ctx.shadowBlur = 0;
    });
    ctx.globalAlpha = 1;
  }

  // a faint cloud of each topic's colour behind its documents, and the topic's name above it
  function nebulae(f) {
    var groups = {};
    VIS.forEach(function (n) {
      var t = topicOf(n);
      if (t === "common" || n.k === "list") return;
      (groups[t] = groups[t] || []).push(n);
    });
    ctx.globalCompositeOperation = "lighter";
    Object.keys(groups).forEach(function (t) {
      var c = SKY["k" + TOPIC[t].slot], R = Math.max(40, 78 * view.k);
      groups[t].forEach(function (n) {
        var p = toScreen(n), g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], R);
        g.addColorStop(0, rgba(c, 0.075 * f)); g.addColorStop(1, rgba(c, 0));
        ctx.globalAlpha = 1; ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p[0], p[1], R, 0, 6.283); ctx.fill();
      });
    });
    ctx.globalCompositeOperation = "source-over";
    ctx.font = "600 15px " + getComputedStyle(document.body).fontFamily;
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    Object.keys(groups).forEach(function (t) {
      // above the group's core (members near its centre), so a stray member does not drag the name away
      var g = groups[t].map(toScreen), cx = 0, cy = 0, md = 0, x = 0, k = 0, y0 = Infinity;
      g.forEach(function (p) { cx += p[0] / g.length; cy += p[1] / g.length; });
      g.forEach(function (p) { md += Math.hypot(p[0] - cx, p[1] - cy) / g.length; });
      g.forEach(function (p) {
        if (Math.hypot(p[0] - cx, p[1] - cy) <= md * 1.2 + 1) { x += p[0]; k++; y0 = Math.min(y0, p[1]); }
      });
      x /= k || 1;
      ctx.globalAlpha = 0.8 * f;
      ctx.fillStyle = SKY["k" + TOPIC[t].slot];
      ctx.shadowColor = "rgba(0,0,0,0.9)"; ctx.shadowBlur = 8;
      ctx.fillText(TOPIC[t].name, x, y0 - 20);
      ctx.shadowBlur = 0;
    });
    ctx.globalAlpha = 1;
  }

  // one loop: settle the layout while it moves, keep the sky alive (stopped when the tab is hidden)
  var autoFit = 0, last = 0;                         // frames left in which the view follows the layout
  function fitFor(frames) { autoFit = Math.max(autoFit, frames); }
  function frame(ts) {
    requestAnimationFrame(frame);
    if (document.hidden || ts - last < 30) return;
    time += (ts - last) / 1000 * (last ? 1 : 0);
    last = ts;
    if (alpha > 0.004 || drag) { tick(); tick(); }
    if (autoFit && VIS.length) {
      var f = bounds();
      view.k += (f.k - view.k) * 0.12; view.x += (f.x - view.x) * 0.12; view.y += (f.y - view.y) * 0.12;
      if (alpha > 0.03) autoFit = Math.max(autoFit, 2);
      autoFit--;
    }
    draw();
  }

  // ---- interaction ----
  var drag = null, pan = null, moved = false;
  function pick(mx, my) {
    var best = null, bd = Infinity;
    VIS.forEach(function (n) {
      var p = toScreen(n), r = Math.max(6, n.r * Math.sqrt(view.k) + 3), d = (p[0] - mx) * (p[0] - mx) + (p[1] - my) * (p[1] - my);
      if (d < r * r && d < bd) { bd = d; best = n; }
    });
    return best;
  }
  function pos(ev) { var b = cv.getBoundingClientRect(); return [ev.clientX - b.left, ev.clientY - b.top]; }
  cv.addEventListener("pointerdown", function (ev) {
    var m = pos(ev), n = pick(m[0], m[1]);
    cv.setPointerCapture(ev.pointerId);
    moved = false;
    if (n) { drag = n; n.fx = n.x; n.fy = n.y; }
    else pan = { x: m[0] - view.x, y: m[1] - view.y };
    cv.classList.add("dragging");
  });
  cv.addEventListener("pointermove", function (ev) {
    var m = pos(ev);
    if (drag) {
      moved = true;
      drag.fx = (m[0] - view.x) / view.k; drag.fy = (m[1] - view.y) / view.k;
      reheat(0.25);
      return;
    }
    if (pan) { moved = true; autoFit = 0; view.x = m[0] - pan.x; view.y = m[1] - pan.y; draw(); return; }
    var n = pick(m[0], m[1]);
    var h = n ? n.i : null;
    cv.classList.toggle("on-node", !!n);
    if (h !== hover) { hover = h; draw(); }
    var tip = $("tip");
    if (n) {
      tip.hidden = false;
      tip.innerHTML = "<div>" + esc((n.short ? n.short + " · " : "") + n.t) + '</div><div class="k">' + esc(topicText(n)) + " · " + esc(KIND[n.k].name) +
        (n.area ? " · " + esc(n.area) : "") + " · 연결 " + n.deg + "</div>";
      tip.style.left = Math.min(m[0] + 14, W - 330) + "px"; tip.style.top = (m[1] + 14) + "px";
    } else tip.hidden = true;
  });
  function up(ev) {
    var m = pos(ev);
    if (drag) {
      if (!moved) select(drag.i === selected ? null : drag.i);
      delete drag.fx; delete drag.fy; drag = null;
    } else if (pan && !moved && !pick(m[0], m[1])) select(null);
    pan = null;
    cv.classList.remove("dragging");
  }
  cv.addEventListener("pointerup", up);
  cv.addEventListener("pointerleave", function () { if (hover !== null) { hover = null; draw(); } $("tip").hidden = true; });
  cv.addEventListener("wheel", function (ev) {
    ev.preventDefault();
    autoFit = 0;
    var m = pos(ev), k = Math.max(0.1, Math.min(5, view.k * Math.exp(-ev.deltaY * 0.0015)));
    view.x = m[0] - (m[0] - view.x) * k / view.k; view.y = m[1] - (m[1] - view.y) * k / view.k; view.k = k;
    draw();
  }, { passive: false });
  function zoomBy(f) {
    autoFit = 0;
    var k = Math.max(0.1, Math.min(5, view.k * f));
    view.x = W / 2 - (W / 2 - view.x) * k / view.k; view.y = H / 2 - (H / 2 - view.y) * k / view.k; view.k = k;
    draw();
  }
  $("zin").onclick = function () { zoomBy(1.25); };
  $("zout").onclick = function () { zoomBy(0.8); };
  $("zfit").onclick = function () { fitFor(45); };
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") select(null); });

  function topicText(n) {
    if (!HAS_TOPICS) return "";
    return (n.topics.length ? n.topics : ["common"]).map(function (t) { return TOPIC[t] ? TOPIC[t].name : t; }).join(" + ") +
      (n.tsrc === "추정" ? " (추정)" : "");
  }
  // ---- panel ----
  var drawer = $("drawer");
  function dot(n) { return '<i class="dot" style="background:' + colorOf(n) + '"></i>'; }
  function go(j, extra, why) {
    var n = N[j];
    return '<li><span>' + dot(n) + '<a class="go" data-go="' + j + '" href="#doc=' + encodeURIComponent(n.id) + '">' +
      esc((n.short ? n.short + " · " : "") + n.t) + "</a>" + (why ? '<span class="why">' + esc(why) + "</span>" : "") +
      "</span>" + (extra ? '<span class="lab">' + esc(extra) + "</span>" : "") + "</li>";
  }
  function byKind(list) {
    return list.slice().sort(function (a, b) {
      return KIND_ORDER.indexOf(N[a].k) - KIND_ORDER.indexOf(N[b].k) || N[a].id.localeCompare(N[b].id);
    });
  }
  function section(title, items) {
    return items.length ? "<h3>" + title + " · " + items.length + "</h3><ul>" + items.join("") + "</ul>" : "";
  }
  function renderNode(i) {
    var n = N[i], h = '<button class="close" title="닫기 (Esc)">×</button>';
    h += '<div class="kicker">' + dot(n) + esc(KIND[n.k].name) + (n.area ? " · " + esc(n.area) : "") +
      (n.state ? " · " + esc(n.state) : "") + "</div>";
    h += "<h2>" + esc((n.short ? n.short + " · " : "") + n.t) + "</h2>";
    if (HAS_TOPICS) {
      h += '<p class="topicline">주제: ' + n.topics.map(function (t) {
        return '<span class="tchip" style="--c:' + SKY["k" + (TOPIC[t] || { slot: 0 }).slot] + '">' + esc(TOPIC[t] ? TOPIC[t].name : t) + "</span>";
      }).join(" ") + ' <span class="tsrc">' + esc({ "머리말": "머리말 topics", "확인": "확인 목록 (graph/topics.yml)",
        "로드맵": "로드맵 항목에서", "추정": "추정: 이웃 문서에서 (확인 목록에 넣어 주세요)", "목록": "목록 페이지" }[n.tsrc] || "") + "</span>" +
        (n.off ? '<br><span class="tsrc warn">링크는 대부분 ' + esc(TOPIC[n.off] ? TOPIC[n.off].name : n.off) + " 문서로 갑니다. 주제를 다시 볼 후보</span>" : "") + "</p>";
    }
    if (n.sum) h += '<p class="sum">' + esc(n.sum) + "</p>";
    h += '<div class="btns"><a class="btn" href="' + esc(n.url) + '" target="' + target + '">문서 열기</a>' +
      '<button class="btn" id="local">' + (depth ? "전체 보기" : "주변만 보기") + "</button></div>";
    h += section("머리말 관계", n.rel.map(function (r) { return go(r.j, r.label); }));
    var inRel = {};
    n.rel.forEach(function (r) { inRel[r.j] = true; });
    var vis = function (j) { return !inRel[j] && show.kinds[N[j].k]; };   // relations are listed above
    h += section("이 문서가 링크함", byKind(n.out.filter(vis)).map(function (j) { return go(j, KIND[N[j].k].name); }));
    h += section("이 문서를 링크함 (백링크)", byKind(n.inn.filter(vis)).map(function (j) { return go(j, KIND[N[j].k].name); }));
    h += section("비슷한 문서 (아직 링크 없음)", n.sim.map(function (s) {
      return go(s.j, "점수 " + s.score.toFixed(2), s.why.join(" · "));
    }));
    if (!n.rel.length && !n.out.length && !n.inn.length) h += '<p class="none">연결된 문서가 없습니다. 관련 문서에서 링크해 주세요.</p>';
    drawer.innerHTML = h;
    drawer.scrollTop = 0;
  }
  function renderOverview() {
    var content = N.filter(function (n) { return n.k !== "list"; });
    var lonely = content.filter(function (n) { return n.deg === 0 || (!n.out.length && !n.inn.filter(function (j) { return N[j].k !== "list"; }).length && !n.rel.length); });
    var pairs = [];
    N.forEach(function (n) { n.sim.forEach(function (s) { if (n.i < s.j) pairs.push([s.score, n.i, s.j, s.why]); }); });
    pairs.sort(function (a, b) { return b[0] - a[0]; });
    var links = EDGES.filter(function (e) { return e.type !== "sim"; }).length;
    var h = '<div class="kicker">문서 지도</div><h2>' + esc(D.title) + "</h2>";
    h += '<div class="stats"><div class="stat"><b>' + content.length + '</b><span>문서 (목록 제외)</span></div>' +
      '<div class="stat"><b>' + links + '</b><span>링크·관계</span></div><div class="stat"><b>' + pairs.length +
      '</b><span>비슷한 쌍</span></div></div>';
    h += '<p class="tagline">문서를 누르면 연결과 그 이유가 나옵니다. 아래는 문서를 정리할 때 볼 점검입니다.</p>';
    h += "<h3>점검: 다른 문서와 이어지지 않은 문서 · " + lonely.length + "</h3><ul>" +
      (lonely.length ? lonely.map(function (n) { return go(n.i, KIND[n.k].name, "목록에서만 링크됨"); }).join("") :
        '<li class="none">없음</li>') + "</ul>";
    if (HAS_TOPICS) {
      var guessed = content.filter(function (n) { return n.tsrc === "추정"; });
      var off = content.filter(function (n) { return n.off; });
      h += "<h3>점검: 주제가 추정된 문서 · " + guessed.length + "</h3><ul>" + (guessed.length ? guessed.map(function (n) {
        return go(n.i, topicText(n));
      }).join("") : '<li class="none">없음 (모두 머리말·확인 목록·로드맵에서 정해짐)</li>') + "</ul>";
      h += "<h3>점검: 주제와 연결이 어긋나는 문서 · " + off.length + "</h3><ul>" + (off.length ? off.map(function (n) {
        return go(n.i, topicText(n), "링크는 대부분 " + (TOPIC[n.off] ? TOPIC[n.off].name : n.off) + " 문서로 감");
      }).join("") : '<li class="none">없음</li>') + "</ul>";
    }
    h += "<h3>점검: 링크를 걸면 좋을 쌍 (비슷하지만 링크 없음)</h3><ul>" + pairs.slice(0, 12).map(function (p) {
      var a = N[p[1]], b = N[p[2]];
      return '<li><span>' + dot(a) + '<a class="go" data-go="' + a.i + '" href="#">' + esc(a.short || a.t) + "</a> ↔ " +
        dot(b) + '<a class="go" data-go="' + b.i + '" href="#">' + esc(b.short || b.t) + '</a><span class="why">' +
        esc(a.t) + " ↔ " + esc(b.t) + "<br>" + esc(p[3].join(" · ")) + '</span></span><span class="lab">' +
        p[0].toFixed(2) + "</span></li>";
    }).join("") + "</ul>";
    drawer.innerHTML = h;
  }
  drawer.addEventListener("click", function (ev) {
    if (ev.target.closest(".close")) { select(null); return; }
    if (ev.target.id === "local") { depth = depth ? 0 : 1; $("depth").value = depth; refresh(true); renderNode(selected); return; }
    var g = ev.target.closest("[data-go]");
    if (g) { ev.preventDefault(); select(+g.dataset.go, true); }
  });
  function select(i, center) {
    selected = i === null || i === undefined ? null : i;
    if (selected !== null && !N[selected].vis) { show.kinds[N[selected].k] = true; syncChips(); }
    try { history.replaceState(null, "", selected !== null ? "#doc=" + encodeURIComponent(N[selected].id) : location.pathname + location.search); } catch (e) {}
    $("newtab").href = "index.html" + (selected !== null ? "#doc=" + encodeURIComponent(N[selected].id) : "");
    if (selected !== null) renderNode(selected); else renderOverview();
    refresh(!!depth);
    if (selected !== null && center) {
      var n = N[selected];
      view.x = W / 2 - n.x * view.k; view.y = H / 2 - n.y * view.k; draw();
    }
  }
  function syncChips() {
    [].forEach.call($("kinds").children, function (c) { c.classList.toggle("off", !show.kinds[c.dataset.k]); });
  }

  // ---- ask the documents: the local ask server (bin/docs_ask.py) finds the sections, writes a cited answer and
  // checks it; the documents it used are pulled to the centre in rank order. Only on the development preview. ----
  var ASK = null, ASKRES = null;
  var ASKCFG = D.ask || { port: 8003, from_ports: [8001], start: "python3 .docs-kit/bin/docs_ask.py --serve" };
  var askApi = location.protocol + "//" + location.hostname + ":" + ASKCFG.port + "/api/ask";
  var askable = location.protocol.indexOf("http") === 0 && ASKCFG.from_ports.map(String).indexOf(location.port) >= 0;
  var byPath = {};
  N.forEach(function (n) { byPath["docs/" + n.id] = n.i; byPath[n.id] = n.i; });
  var VLAB = { supported: "✓", unverified: "?", unsupported: "✗", none: "·" };
  function setAsk(res) {
    ASKRES = res;
    if (!res) { ASK = null; $("askclear").hidden = true; $("askstate").textContent = ""; reheat(0.6, true); renderOverview(); return; }
    var rank = {}, spot = {}, order = [];
    res.evidence.forEach(function (e) {
      var i = byPath[e.path];
      if (i !== undefined && rank[i] === undefined) { order.push(i); rank[i] = order.length; }
    });
    order.forEach(function (i, k) {                 // rank 1 in the middle, the rest on a spiral around it
      var ang = k * 2.4, rad = k ? 70 + 46 * Math.sqrt(k) : 0;
      spot[i] = { x: Math.cos(ang) * rad, y: Math.sin(ang) * rad };
      if (!N[i].vis) show.kinds[N[i].k] = true;
    });
    ASK = { rank: rank, spot: spot, clear: 70 + 46 * Math.sqrt(Math.max(1, order.length)) + 60 };
    $("askclear").hidden = false;
    syncChips(); refresh(true); reheat(0.9, true);
    selected = null; renderAnswer();
  }
  function citeLinks(t) {
    return esc(t).replace(/\[(\d{1,2})\]/g, '<span class="cite" data-cite="$1">[$1]</span>');
  }
  function renderAnswer() {
    var r = ASKRES, h = '<button class="close" title="질문 지우기 (Esc)">×</button><div class="kicker">질문 · 찾은 방식 ' +
      esc(r.mode === "hybrid" ? "BM25 + 임베딩" : "BM25") + " · " + r.ms + " ms</div><h2>" + esc(r.q) + "</h2>";
    if (r.fallback) h += '<p class="note">임베딩 색인 준비 중이라 단어로만 찾았습니다.</p>';
    if (r.sentences && r.sentences.length) {
      h += '<div class="answer">' + r.sentences.map(function (s) {
        return '<span class="s ' + s.verdict + '"><span class="v" title="' + esc({ supported: "근거 있음", unverified: "확인 못 함: 인용한 근거에 없는 값", unsupported: "근거 없음", none: "답 없음" }[s.verdict]) +
          '">' + VLAB[s.verdict] + "</span>" + citeLinks(s.text) +
          (s.missing && s.missing.length ? '<span class="miss">인용한 근거에 없음: ' + esc(s.missing.join(", ")) + "</span>" : "") +
          (s.why ? '<span class="miss">' + esc(s.why) + "</span>" : "") + "</span>";
      }).join("") + "</div>";
      var c = r.counts || {};
      h += '<p class="verdicts">문장 점검: ✓ 근거 있음 ' + (c.supported || 0) + " · ? 확인 못 함 " + (c.unverified || 0) +
        " · ✗ 근거 없음 " + (c.unsupported || 0) + (r.model ? " · 모델 " + esc(String(r.model).split("/").pop()) : "") + "</p>";
      if ((c.unverified || 0) + (c.unsupported || 0)) h += '<div class="warnbox">?·✗ 문장은 그대로 믿지 말고 아래 근거 원문으로 확인하세요.</div>';
    } else if (r.note) h += '<p class="note">' + esc(r.note) + "</p>";
    h += '<div class="btns"><button class="btn" id="toagent">에이전트에게 묻기 (질문 + 근거 복사)</button></div>';
    h += "<h3>근거 (순위) · " + r.evidence.length + "</h3>";
    h += r.evidence.map(function (e, k) {
      var i = byPath[e.path], n = i !== undefined ? N[i] : null;
      return '<div class="ev" data-ev="' + (k + 1) + '"><div class="eh"><span class="rk">[' + (k + 1) + "]</span><span>" +
        (n ? dot(n) + '<a class="go" data-go="' + i + '" href="#">' + esc((n.short ? n.short + " · " : "") + n.t) + "</a>" : esc(e.title)) +
        (e.head ? '<span class="why">' + esc(e.head) + "</span>" : "") + "</span></div>" +
        '<div class="loc">' + esc(e.path + ":" + e.lines[0] + "-" + e.lines[1]) + " · " + esc(e.layer) +
        (e.superseded_by ? " · 대체됨 → " + esc(e.superseded_by) : "") + " · " + esc(e.via) + "</div>" +
        "<details><summary>원문 보기</summary><pre>" + esc(e.text) + "</pre></details></div>";
    }).join("");
    drawer.innerHTML = h; drawer.scrollTop = 0;
  }
  function agentText(r) {
    var t = "질문: " + r.q + "\n\n문서 검색(docs_search, " + r.mode + ")이 찾은 근거입니다. 이 근거를 실제로 읽고, 근거를 붙여 답해 주세요. " +
      "근거에 없으면 '문서에서 확인 못 함'이라고 하고 확인 방법을 제안해 주세요 (AGENTS.md §2.10).\n";
    r.evidence.forEach(function (e, k) {
      t += "\n[" + (k + 1) + "] " + e.path + ":" + e.lines[0] + "-" + e.lines[1] + "  " + (e.id ? e.id + " " : "") + (e.head || e.title) +
        (e.superseded_by ? "  (대체됨 → " + e.superseded_by + ")" : "");
    });
    if (r.answer) t += "\n\n참고: 로컬 모델의 초안 답 (점검 " + JSON.stringify(r.counts || {}) + ")\n" + r.answer;
    return t + "\n";
  }
  function copyText(t) {
    var done = function () { $("askstate").textContent = "복사했습니다. 에이전트(Claude Code)에 붙여 넣으세요"; };
    if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(t).then(done, fallback); } else fallback();
    function fallback() {
      var ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { window.prompt("복사해서 붙여 넣으세요", t); }
      ta.remove();
    }
  }
  drawer.addEventListener("click", function (ev) {
    if (!ASKRES || selected !== null) return;
    if (ev.target.id === "toagent") { copyText(agentText(ASKRES)); return; }
    if (ev.target.closest(".close")) { ev.stopImmediatePropagation(); $("ask").value = ""; setAsk(null); return; }
    var c = ev.target.closest("[data-cite]");
    if (c) {
      [].forEach.call(drawer.querySelectorAll(".ev"), function (x) { x.classList.toggle("hl", x.dataset.ev === c.dataset.cite); });
      var box = drawer.querySelector('.ev[data-ev="' + c.dataset.cite + '"]');
      if (box) { box.scrollIntoView({ block: "nearest", behavior: "smooth" }); var d = box.querySelector("details"); if (d) d.open = true; }
    }
  }, true);
  $("askform").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var q = $("ask").value.trim(); if (!q || $("askgo").disabled) return;   // one question at a time
    if (!askable) {
      $("askstate").textContent = "질문은 개발 미리보기(포트 " + ASKCFG.from_ports.join(", ") + ")에서 됩니다. 이 PC에서: " + ASKCFG.start;
      return;
    }
    var t0 = Date.now(), tick = setInterval(function () {
      $("askstate").textContent = "찾고 답하는 중… " + Math.round((Date.now() - t0) / 1000) + "초";
    }, 500);
    $("askstate").textContent = "찾고 답하는 중…"; $("askgo").disabled = true;
    var ctl = window.AbortController ? new AbortController() : null;
    if (ctl) setTimeout(function () { ctl.abort(); }, 120000);
    fetch(askApi, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: q, k: 6 }),
                    signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); })
      .then(function (j) {
        $("askstate").textContent = j.evidence.length ? "" : "문서에서 찾은 곳 없음"; setAsk(j);
        try { history.replaceState(null, "", "#ask=" + encodeURIComponent(q)); } catch (e) {}
      })
      .catch(function (e) {
        var msg = String(e && e.message || e);
        $("askstate").textContent = (e && e.name === "AbortError") ? "응답이 120초 안에 오지 않음 (" + askApi + ")" :
          /fetch|NetworkError|Load failed/i.test(msg) ? "질문 서버(" + askApi + ")에 닿지 못함: 서버가 꺼졌거나 이 PC에서 포트 " + ASKCFG.port +
            "로 갈 수 없음 (" + ASKCFG.start + ")" : "실패: " + msg;
        $("askstate").title = msg;
      })
      .then(function () { clearInterval(tick); $("askgo").disabled = false; });
  });
  $("askclear").onclick = function () { $("ask").value = ""; setAsk(null); };
  var _renderOverview = renderOverview;
  renderOverview = function () { if (ASKRES) renderAnswer(); else _renderOverview(); };

  // ---- start: documents spread out from the centre (a small bang); the view follows until they settle ----
  N.forEach(function (n) { n.x *= 0.15; n.y *= 0.15; });
  refresh(false);
  for (var t = 0; t < 30; t++) tick();
  resize();
  fit();
  window.addEventListener("resize", resize);
  var qm = /[#&]ask=([^&]+)/.exec(location.hash);      // #ask=<question>: ask on open (read before select() rewrites the hash)
  var m = /doc=([^&]+)/.exec(location.hash), start = null;
  if (m) { var id = decodeURIComponent(m[1]); N.forEach(function (n) { if (n.id === id) start = n.i; }); }
  if (start !== null) { for (t = 0; t < 230; t++) tick(); autoFit = 0; fit(); }
  select(start, start !== null);
  paintLegend();
  if (start === null) fitFor(60);
  if (qm) { $("ask").value = decodeURIComponent(qm[1]); $("askform").requestSubmit(); }
  requestAnimationFrame(frame);
})();
