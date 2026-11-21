/* Project dashboard interactions (docs-kit site/src/lib/plan.ts). Everything here is optional: without it the page shows
 * both charts, every stage and the full register.
 *
 *   [data-tip]          tooltip on hover / focus (risk ids, axis labels, trends)
 *   [data-burnup]       hover read-out: date, planned work low..high, done, forecasts on later days
 *   [data-tabs]         two burn-ups as tabs
 *   [data-tree-tools]   find / status / horizon filters and expand / collapse for the stages tree
 *   [data-risk-tools]   register filters (category, status, band, text); band cards and PI cells set them
 *   th[data-sort]       sort the register by a column
 *   #ep-<id>, #r01      opening a link to a stage or a risk opens / shows it
 */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  /* ---------- tooltip ---------- */
  var tip;
  function showTip(t, x, y, cls) {
    if (!tip) { tip = el("div", "pl-tip"); document.body.appendChild(tip); }
    tip.textContent = t; tip.hidden = false; tip.className = "pl-tip" + (cls ? " " + cls : "");
    var w = tip.offsetWidth, h = tip.offsetHeight;
    var left = x + 16 + w > window.innerWidth - 8 ? x - w - 16 : x + 16, top = y + 16;
    if (top + h > window.innerHeight - 8) top = y - h - 12;
    tip.style.left = Math.max(8, left) + "px"; tip.style.top = Math.max(8, top) + "px";
  }
  function hideTip() { if (tip) tip.hidden = true; }
  function tips() {
    $$("[data-tip]").forEach(function (e) {
      e.addEventListener("mousemove", function (ev) { showTip(e.getAttribute("data-tip"), ev.clientX, ev.clientY); });
      e.addEventListener("mouseleave", hideTip);
      e.addEventListener("focus", function () { var r = e.getBoundingClientRect(); showTip(e.getAttribute("data-tip"), r.left, r.bottom); });
      e.addEventListener("blur", hideTip);
    });
  }

  /* ---------- burn-up read-out ---------- */
  function fmtDate(start, k) {
    var d = new Date(start + "T00:00:00"); d.setDate(d.getDate() + k);
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }
  function n1(v) { return (Math.round(v * 10) / 10).toString(); }
  function burnup(box) {
    var D = JSON.parse(box.getAttribute("data-burnup"));
    var svg = $("svg", box), g = $(".pl-hover", svg), line = $(".pl-hover-x", g), dot = $(".pl-hover-done", g);
    var today = D.done.length - 1;
    var px = function (k) { return D.L + (D.W - D.L - D.R) * k / D.days; };
    var py = function (v) { return D.T + (D.H - D.T - D.B) * (1 - v / D.smax); };
    function at(ev) {
      var r = svg.getBoundingClientRect(), vx = (ev.clientX - r.left) * D.W / r.width;
      var k = Math.round((vx - D.L) / (D.W - D.L - D.R) * D.days);
      if (k < 0 || k > D.days) { leave(); return; }
      g.style.display = ""; line.setAttribute("x1", px(k)); line.setAttribute("x2", px(k));
      var rows = [fmtDate(D.start, k) + (k === today ? " (오늘)" : "")];
      if (k <= today) {
        rows.push("계획 작업량 " + n1(D.lo[k]) + "~" + n1(D.hi[k]) + " 포인트", "끝낸 일 " + n1(D.done[k]) + " 포인트");
        dot.style.display = ""; dot.setAttribute("cx", px(k)); dot.setAttribute("cy", py(D.done[k]));
      } else {
        dot.style.display = "none";
        rows.push("계획 작업량 " + n1(D.end[0]) + "~" + n1(D.end[1]) + " 포인트 (지금 계획)");
        var dn = D.done[today];
        D.fc.forEach(function (f) {
          var t = Math.min(1, (k - today) / Math.max(1, f[1] - today));
          rows.push("예측 " + f[0] + ": " + n1(dn + (f[2] - dn) * t) + (t >= 1 ? " (끝남)" : ""));
        });
      }
      D.base.forEach(function (b) { if (Math.abs(b[0] - k) <= 1) rows.push("기준선 " + b[1] + ": " + b[2]); });
      showTip(rows.join("\n"), ev.clientX, ev.clientY, "pl-tip-chart");   // fixed, over the page: no scrollbar, no reflow
    }
    function leave() { g.style.display = "none"; hideTip(); }
    svg.addEventListener("mousemove", at); svg.addEventListener("mouseleave", leave);
  }

  /* ---------- tabs ---------- */
  function tabs(box) {
    var btns = $$("[data-tab]", box), panes = $$("[data-pane]", box);
    box.classList.add("pl-tabs-on");
    function pick(i) {
      btns.forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-tab") === i); b.setAttribute("aria-selected", b.getAttribute("data-tab") === i); });
      panes.forEach(function (p) { p.hidden = p.getAttribute("data-pane") !== i; });
    }
    btns.forEach(function (b) { b.addEventListener("click", function () { pick(b.getAttribute("data-tab")); }); });
    pick("0");
  }

  /* ---------- stages tree ---------- */
  function select(label, opts, on) {
    var w = el("label", "pl-tool"); w.appendChild(el("span", null, label));
    var s = el("select");
    opts.forEach(function (o) { var op = el("option", null, o[1]); op.value = o[0]; s.appendChild(op); });
    s.addEventListener("change", on); w.appendChild(s); return { wrap: w, sel: s };
  }
  function treeTools(bar) {
    var tree = bar.nextElementSibling; if (!tree) return;
    var q = el("input", "pl-search"); q.type = "search"; q.placeholder = "찾기: 이름, #이슈, 완료 정의";
    var st = select("상태", [["", "전체"], ["doing", "진행 중"], ["todo", "할 일"], ["done", "완료"], ["dropped", "뺌"]], apply);
    var wv = select("시기", [["", "전체"], ["now", "지금"], ["next", "다음"], ["later", "나중"]], apply);
    var all = el("button", "pl-btn", "모두 펼치기"), none = el("button", "pl-btn", "모두 접기"), cnt = el("span", "pl-count");
    all.type = none.type = "button";
    all.addEventListener("click", function () { $$("details", tree).forEach(function (d) { d.open = true; }); });
    none.addEventListener("click", function () { $$("details", tree).forEach(function (d) { d.open = false; }); });
    q.addEventListener("input", apply);
    [q, st.wrap, wv.wrap, all, none, cnt].forEach(function (e) { bar.appendChild(e); });
    function apply() {
      var text = q.value.trim().toLowerCase(), s = st.sel.value, w = wv.sel.value, active = text || s || w, shown = 0;
      function walk(n) {          // returns true when n or a descendant matches
        var kids = $$(":scope > .pl-body > [data-st], :scope > .pl-stage-b > .pl-body > [data-st]", n);
        var anyKid = false;
        kids.forEach(function (k) { if (walk(k)) anyKid = true; });
        var me = (!text || n.getAttribute("data-q").indexOf(text) >= 0) && (!s || n.getAttribute("data-st") === s) &&
                 (!w || n.getAttribute("data-wave") === w);
        var vis = !active || me || anyKid;
        n.hidden = !vis;
        if (active && n.matches("details")) n.open = anyKid;
        if (active && me) { n.classList.add("pl-hit"); shown++; } else n.classList.remove("pl-hit");
        if (!active) kids.forEach(function (k) { k.hidden = false; });
        return me || anyKid;
      }
      $$(":scope > .pl-stage", tree).forEach(walk);
      cnt.textContent = active ? "맞는 항목 " + shown + "개" : "";
    }
  }

  /* ---------- risk register ---------- */
  function riskTools(bar) {
    var table = bar.nextElementSibling; if (!table || !table.matches("table")) return;
    var cats = JSON.parse(bar.getAttribute("data-cats") || "[]");
    var q = el("input", "pl-search"); q.type = "search"; q.placeholder = "찾기: 리스크, 원인, 대응, 담당";
    var cat = select("분류", [["", "전체"]].concat(cats.map(function (c) { return [c, c]; })), apply);
    var st = select("상태", [["", "전체"], ["open", "관리 중"], ["watch", "지켜봄"], ["occurred", "일어남"], ["closed", "닫힘"]], apply);
    var bd = select("등급", [["", "전체"], ["critical", "매우 높음"], ["high", "높음 이상"], ["medium", "중간"], ["low", "낮음"]], apply);
    var pi = "", chip = el("button", "pl-btn pl-chip"), cnt = el("span", "pl-count");
    chip.type = "button"; chip.hidden = true;
    chip.addEventListener("click", function () { pi = ""; apply(); });
    q.addEventListener("input", apply);
    [q, cat.wrap, st.wrap, bd.wrap, chip, cnt].forEach(function (e) { bar.appendChild(e); });
    var rows = $$("tbody tr", table);
    function apply() {
      var text = q.value.trim().toLowerCase(), n = 0;
      rows.forEach(function (r) {
        var b = r.getAttribute("data-band");
        var ok = (!text || r.getAttribute("data-q").indexOf(text) >= 0) && (!cat.sel.value || r.getAttribute("data-cat") === cat.sel.value) &&
                 (!st.sel.value || r.getAttribute("data-status") === st.sel.value) &&
                 (!bd.sel.value || b === bd.sel.value || (bd.sel.value === "high" && b === "critical")) &&
                 (!pi || r.getAttribute("data-pi") === pi);
        r.hidden = !ok; if (ok) n++;
      });
      chip.hidden = !pi; chip.textContent = pi ? "가능성 " + pi.split(",")[0] + " · 영향 " + pi.split(",")[1] + " ✕" : "";
      cnt.textContent = n + " / " + rows.length;
      $$("[data-rfilter=pi]").forEach(function (c) { c.classList.toggle("pl-on", c.getAttribute("data-rval") === pi); });
      $$("[data-rfilter=band]").forEach(function (c) { c.classList.toggle("pl-on", c.getAttribute("data-rval") === bd.sel.value); });
    }
    $$("[data-rfilter]").forEach(function (c) {
      c.addEventListener("click", function (ev) {
        if (ev.target.closest("a")) return;            // a risk id link: jump to its row instead
        var v = c.getAttribute("data-rval");
        if (c.getAttribute("data-rfilter") === "pi") { pi = pi === v ? "" : v; bd.sel.value = ""; }
        else { bd.sel.value = bd.sel.value === v ? "" : v; pi = ""; }
        apply(); bar.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    apply();
  }
  function sortable(table) {
    $$("th[data-sort]", table).forEach(function (th) {
      var idx = Array.prototype.indexOf.call(th.parentNode.children, th), dir = 1;
      th.classList.add("pl-sortable"); th.title = "눌러서 정렬";
      th.addEventListener("click", function () {
        var body = $("tbody", table), rows = $$("tr", body);
        rows.sort(function (a, b) {
          var x = a.children[idx], y = b.children[idx];
          var vx = x.getAttribute("data-v"), vy = y.getAttribute("data-v");
          var c = vx != null && vy != null ? (+vx) - (+vy) : x.textContent.localeCompare(y.textContent, "ko");
          return c * dir;
        });
        rows.forEach(function (r) { body.appendChild(r); });
        $$("th", table).forEach(function (h) { h.removeAttribute("data-dir"); });
        th.setAttribute("data-dir", dir > 0 ? "▲" : "▼"); dir = -dir;
      });
    });
  }

  /* ---------- links that open things ---------- */
  function openHash() {
    var id = decodeURIComponent(location.hash.slice(1)); if (!id) return;
    var t = document.getElementById(id); if (!t) return;
    for (var p = t; p; p = p.parentElement) { if (p.tagName === "DETAILS") p.open = true; if (p.hidden) p.hidden = false; }
    if (t.tagName === "TR") { t.classList.add("pl-flash"); setTimeout(function () { t.classList.remove("pl-flash"); }, 1600); }
    t.scrollIntoView({ block: "start" });
  }
  function openItem(a) {
    a.addEventListener("click", function () {
      var id = a.getAttribute("data-open");
      $$("[data-q]").forEach(function (n) {
        if ((n.getAttribute("data-q") || "").split(" ")[0] === id.toLowerCase()) {
          for (var p = n; p; p = p.parentElement) if (p.tagName === "DETAILS") p.open = true;
          n.classList.add("pl-hit"); setTimeout(function () { n.classList.remove("pl-hit"); }, 2500);
          setTimeout(function () { n.scrollIntoView({ block: "center" }); }, 0);
        }
      });
    });
  }

  function init() {
    if (!$(".pl-chart, .pl-risks, .pl-tree, .pl-sort")) return;
    $$("[data-burnup]").forEach(burnup);
    $$("[data-tabs]").forEach(tabs);
    $$("[data-tree-tools]").forEach(treeTools);
    $$("[data-risk-tools]").forEach(riskTools);
    $$("table.pl-risks, table.pl-sort").forEach(sortable);
    $$("a[data-open]").forEach(openItem);
    tips();
    openHash(); window.addEventListener("hashchange", openHash);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
