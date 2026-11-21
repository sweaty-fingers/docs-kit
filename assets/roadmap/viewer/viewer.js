// Roadmap viewer (docs-kit site/src/lib/roadmap.ts writes data.js: window.ROADMAP = {svg, items, units, refKinds, ...}).
// Click a station: the panel shows its details, before / after, related documents by kind, its unit.
// Hover: the chain before and after it. #item=<id> opens an item. Filters: unit, status, text.
(function () {
  "use strict";
  var D = window.ROADMAP;
  var $ = function (id) { return document.getElementById(id); };
  if (!D) return;
  var embed = document.documentElement.classList.contains("embed");
  var target = embed ? "_top" : "_self";
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  };
  $("title").textContent = D.title;
  document.title = D.title;
  var stage = $("stage"), drawer = $("drawer"), canvas = $("canvas");
  stage.innerHTML = D.svg;
  var svg = stage.querySelector("svg");
  var nodes = {}, edges = [].slice.call(svg.querySelectorAll(".rm-edge"));
  [].forEach.call(svg.querySelectorAll(".rm-node"), function (g) { nodes[g.dataset.id] = g; });

  // ---- filters ----
  var unitSel = $("unit");
  unitSel.innerHTML = '<option value="">모든 업무</option>' + D.units.map(function (u) {
    return '<option value="' + esc(u.id) + '">' + esc(u.name) + "</option>";
  }).join("");
  var PLAN = { next: 1, later: 1, future: 1 };
  function filtered() {
    var u = unitSel.value, st = $("status").value, q = $("q").value.trim().toLowerCase();
    if (!u && !st && !q) return null;
    var set = {};
    Object.keys(D.items).forEach(function (id) {
      var it = D.items[id];
      if (u && it.unit !== u) return;
      if (st && !(st === "plan" ? PLAN[it.status] : it.status === st)) return;
      if (q) {
        var hay = [it.title, it.summary, it.unitName, it.tracks.join(" ")].concat(it.refs.map(function (r) {
          return r.ref + " " + r.label;
        })).join(" ").toLowerCase();
        if (hay.indexOf(q) < 0) return;
      }
      set[id] = true;
    });
    return set;
  }

  // ---- highlight ----
  function walk(id, key, seen) {
    if (seen[id] || !D.items[id]) return;
    seen[id] = true;
    D.items[id][key].forEach(function (n) { walk(n, key, seen); });
  }
  function chain(id) {
    var s = {}, d = {};
    walk(id, "after", s);
    walk(id, "children", d);
    Object.keys(d).forEach(function (k) { s[k] = true; });
    return s;
  }
  var selected = null, hover = null;
  function paint() {
    var lit = hover ? chain(hover) : selected ? chain(selected) : filtered();
    svg.classList.toggle("rm-focus", !!lit);
    Object.keys(nodes).forEach(function (id) {
      nodes[id].classList.toggle("rm-hl", !!(lit && lit[id]));
      nodes[id].classList.toggle("rm-sel", id === selected);
    });
    edges.forEach(function (e) {
      e.classList.toggle("rm-hl", !!(lit && lit[e.dataset.from] && lit[e.dataset.to]));
    });
  }

  // ---- panel ----
  function st(it) { return '<span class="rm-st rm-st-' + it.status + '">' + esc(it.statusLabel) + "</span>"; }
  function go(id) {
    var it = D.items[id];
    return '<a class="go" data-go="' + esc(id) + '" href="#item=' + esc(id) + '">' + esc(it.title) + "</a> " + st(it);
  }
  function render(id) {
    var it = D.items[id];
    var h = '<button class="close" title="닫기 (Esc)">×</button>';
    h += '<div class="kicker">' + esc(it.unitName || "업무 없음") + "</div><h2>" + esc(it.title) + "</h2>";
    h += '<div class="meta">' + st(it) + "<span>" + esc(it.when) + '</span><span class="trk">' +
      esc(it.tracks.join(" + ")) + "</span></div>";
    if (it.summary) h += '<p class="sum">' + esc(it.summary) + "</p>";
    h += '<a class="btn" href="' + esc(it.page) + '" target="' + target + '">페이지로 열기</a>';
    h += "<h3>흐름</h3><ul>";
    it.after.forEach(function (a) { h += '<li><span class="dir">앞</span><span>' + go(a) + "</span></li>"; });
    it.children.forEach(function (c) { h += '<li><span class="dir">뒤</span><span>' + go(c) + "</span></li>"; });
    if (!it.after.length && !it.children.length) h += '<li class="none">이어지는 항목 없음</li>';
    h += "</ul><h3>관련 문서</h3>";
    var any = false;
    D.refKinds.forEach(function (k) {
      var rs = it.refs.filter(function (r) { return r.kind === k[0]; });
      if (!rs.length) return;
      any = true;
      h += '<div class="grp"><div class="grp-h">' + esc(k[1]) + "</div><ul>";
      rs.forEach(function (r) {
        var label = r.href ? '<a class="go" href="' + esc(r.href) + '" target="' +
          (r.kind === "web" || r.kind === "issue" ? "_blank" : target) + '">' + esc(r.label) + "</a>" : esc(r.label);
        h += "<li><span>" + label + "</span>" + (r.label !== r.ref ? '<span class="ref">' + esc(r.ref) + "</span>" : "") + "</li>";
      });
      h += "</ul></div>";
    });
    if (!any) h += '<p class="none">적힌 문서 없음</p>';
    if (it.unit) {
      var sib = Object.keys(D.items).filter(function (k) { return D.items[k].unit === it.unit; });
      h += "<h3>같은 업무 · " + esc(it.unitName) + "</h3><ol>";
      sib.forEach(function (k) {
        h += k === id ? '<li class="cur"><span>' + esc(it.title) + " " + st(it) + "</span></li>"
          : "<li><span>" + go(k) + "</span></li>";
      });
      h += "</ol>";
    }
    drawer.innerHTML = h;
    drawer.scrollTop = 0;
  }
  function select(id, scroll) {
    selected = id && D.items[id] ? id : null;
    drawer.hidden = !selected;
    if (selected) render(selected);
    try { history.replaceState(null, "", selected ? "#item=" + selected : location.pathname + location.search); } catch (e) {}
    $("newtab").href = "index.html" + (selected ? "#item=" + selected : "");
    paint();
    if (selected && scroll) {                           // bring it into view (past the sticky track names)
      var b = nodes[selected].querySelector(".rm-box").getBBox(), pad = 12;
      var x0 = b.x * zoom + pad, x1 = (b.x + b.width) * zoom + pad, y0 = b.y * zoom + pad, y1 = (b.y + b.height) * zoom + pad;
      var left = canvas.scrollLeft + 120, right = canvas.scrollLeft + canvas.clientWidth;
      if (x0 < left || x1 > right) canvas.scrollLeft = Math.max(0, x0 - canvas.clientWidth / 2 + (x1 - x0) / 2);
      if (y0 < canvas.scrollTop + 50 || y1 > canvas.scrollTop + canvas.clientHeight - 40)
        canvas.scrollTop = Math.max(0, y0 - canvas.clientHeight / 2);
    }
  }

  // ---- events ----
  Object.keys(nodes).forEach(function (id) {
    var a = nodes[id].closest("a") || nodes[id];
    a.addEventListener("click", function (e) { e.preventDefault(); select(id === selected ? null : id); });
    a.addEventListener("mouseenter", function () { hover = id; paint(); });
    a.addEventListener("mouseleave", function () { hover = null; paint(); });
  });
  svg.addEventListener("click", function (e) { if (!e.target.closest(".rm-link")) select(null); });
  drawer.addEventListener("click", function (e) {
    if (e.target.closest(".close")) { select(null); return; }
    var g = e.target.closest("[data-go]");
    if (g) { e.preventDefault(); select(g.dataset.go, true); }
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") select(null); });
  ["unit", "status"].forEach(function (k) { $(k).addEventListener("change", paint); });
  $("q").addEventListener("input", paint);

  // ---- zoom ----
  var zoom = 1;
  function setZoom(z) {
    zoom = Math.max(0.4, Math.min(2, z));
    svg.setAttribute("width", Math.round(D.width * zoom));
    svg.setAttribute("height", Math.round(D.height * zoom));
    if (typeof stick === "function") stick();
  }
  $("zin").onclick = function () { setZoom(zoom * 1.15); };
  $("zout").onclick = function () { setZoom(zoom / 1.15); };
  $("zfit").onclick = function () { setZoom((canvas.clientWidth - 26) / D.width); };
  $("theme").onclick = function () {
    var root = document.documentElement, t = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", t);
    try { localStorage.setItem("docs-kit-roadmap-theme", t); } catch (e) {}
  };

  var m = /item=([\w-]+)/.exec(location.hash);
  select(m ? m[1] : null, true);
  // keep the column heads and track names in view while scrolling
  var heads = svg.querySelector(".rm-heads"), labels = svg.querySelector(".rm-labels");
  function stick() {
    var dx = Math.max(0, canvas.scrollLeft - stage.offsetLeft - 12) / zoom;
    var dy = Math.max(0, canvas.scrollTop - stage.offsetTop - 12) / zoom;
    if (heads) heads.setAttribute("transform", "translate(0," + dy + ")");
    if (labels) labels.setAttribute("transform", "translate(" + dx + ",0)");
  }
  canvas.addEventListener("scroll", stick, { passive: true });
  // open on today: past work to the left (scroll back), planned work in view
  var today = svg.querySelector(".rm-today");
  if (today && !m) canvas.scrollLeft = Math.max(0, +today.getAttribute("x1") - canvas.clientWidth * 0.3);
  stick();
  window.addEventListener("hashchange", function () {
    var m2 = /item=([\w-]+)/.exec(location.hash);
    if (m2 && m2[1] !== selected) select(m2[1], true);
  });
})();
