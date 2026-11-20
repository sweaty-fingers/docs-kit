/* Standalone C4 viewer (docs/adr/viewer/index.html).
 *
 * data.json (docs-kit hooks/adr.py) gives the views with the nodes and
 * edges each one shows, element details, relations and ADR summaries.
 * Layout: ELK "layered" with orthogonal edge routing, so edges bend at right
 * angles and go around cards. Cards are HTML, edges SVG, both on one stage that
 * is panned/zoomed with a CSS transform.
 * URL hash: #view=<id>&el=<element id> | #el=<id> | #tab=decisions[&adr=<n>]
 */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var elk = new ELK();
  var D = null;                      // data.json
  var S = { view: null, sel: null, adr: null, tab: "view", tf: { x: 0, y: 0, k: 1 }, size: null };
  var nodesById = {}, edgeEls = [];  // rendered elements of the current view

  var TAG = { person: "Person", system: "System", container: "Container", component: "Component" };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function hashState() {
    var o = {};
    location.hash.replace(/^#/, "").split("&").forEach(function (kv) {
      var p = kv.split("=");
      if (p.length === 2) o[p[0]] = decodeURIComponent(p[1]);
    });
    return o;
  }
  function setHash() {
    var h = S.tab === "decisions" ? "#tab=decisions" + (S.adr ? "&adr=" + S.adr : "")
      : "#view=" + S.view.id + (S.sel ? "&el=" + S.sel : "");
    history.replaceState(null, "", h);
    $("newtab").href = location.pathname + h;
  }
  function viewTitle(v) { return v.title.replace(/\s*\(Level \d\)\s*$/, ""); }
  function level(v) { return /Level (\d)/.exec(v.title) ? /Level (\d)/.exec(v.title)[1] : v.scope ? "2" : "1"; }

  /* View where an element is one of the view's own elements (else any view showing it). */
  function viewFor(id) {
    var best = null;
    D.views.forEach(function (v) {
      v.nodes.forEach(function (n) {
        if (n.id !== id) return;
        if (!best || (n.role === "inside" && best.role !== "inside")) best = { id: v.id, role: n.role };
      });
    });
    return best ? best.id : D.views[0].id;
  }
  function viewById(id) { return D.views.filter(function (v) { return v.id === id; })[0]; }

  /* ---- boot ------------------------------------------------------------ */
  fetch("data.json").then(function (r) { return r.json(); }).then(function (data) {
    D = data;
    $("site").textContent = D.site || "";
    document.title = (D.site ? D.site + " · " : "") + "아키텍처";
    buildChrome();
    var h = hashState();
    if (h.tab === "decisions") showDecisions(h.adr);
    else showView(viewById(h.view) ? h.view : h.el ? viewFor(h.el) : D.views[0].id, h.el);
  }).catch(function (e) {
    $("status").textContent = "데이터를 불러오지 못했습니다 (" + e.message + "). 문서 사이트(.docs-kit/bin/docs.sh)에서 여세요.";
  });

  function buildChrome() {
    var tabs = $("tabs");
    D.views.forEach(function (v) {
      var b = el("button", null, '<span class="lvl">L' + level(v) + "</span>" + esc(viewTitle(v)));
      b.setAttribute("data-view", v.id);
      b.onclick = function () { showView(v.id); };
      tabs.appendChild(b);
    });
    var d = el("button", null, '<span class="lvl">ADR</span>결정 카드');
    d.setAttribute("data-view", "__decisions");
    d.onclick = function () { showDecisions(); };
    tabs.appendChild(d);

    var f = $("filter");
    f.appendChild(new Option("결정 필터: 전체", ""));
    Object.keys(D.adrs).forEach(function (n) { f.appendChild(new Option("ADR-" + n + " · " + D.adrs[n].summary, n)); });
    f.onchange = function () {
      S.adr = f.value || null;
      if (S.tab === "decisions") return showDecisions(S.adr);
      applyEmphasis();
      if (S.adr) openAdr(S.adr); else closeDrawer();
    };

    $("theme").onclick = function () {
      var t = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", t);
      try { localStorage.setItem("docs-kit-c4-theme", t); } catch (e) {}
    };
    $("zin").onclick = function () { zoomAt(1.25); };
    $("zout").onclick = function () { zoomAt(0.8); };
    $("zfit").onclick = fit;
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDrawer(); });
    window.addEventListener("resize", function () { if (S.tab === "view") fit(); });

    $("legend").innerHTML =
      "<b>범례</b>" +
      '<span><i style="border-color:var(--t-person)"></i>사람</span>' +
      '<span><i style="border-color:var(--t-system)"></i>시스템</span>' +
      '<span><i style="border-color:var(--t-container)"></i>컨테이너</span>' +
      '<span><i style="border-color:var(--line);background:var(--card)"></i>우리 팀 (채운 카드)</span>' +
      '<span><i style="border-color:var(--line-ext);border-style:dashed"></i>다른 팀·외부 (점선, 채움 없음)</span>' +
      '<span><i style="border-color:var(--t-decided)"></i>결정이 걸린 요소</span>' +
      '<span><svg class="lg hi-flow" viewBox="0 0 26 8"><path d="M1 4H25"/></svg>늘 지나는 길 (실선 여럿이 들어오면 모두 필요)</span>' +
      '<span><svg class="lg alt hi-alt" viewBox="0 0 26 8"><path d="M1 4H25"/></svg>경우에 따라 하나 (택1)</span>' +
      '<span><svg class="lg call hi-call" viewBox="0 0 26 8"><path d="M1 4H25"/></svg>불러 쓰고 답을 받음</span>' +
      "<span>클릭: 상세 · 더블클릭: 안으로 · 휠: 확대 · 끌기: 이동</span>";
    initPanZoom();
  }

  function markTab(id) {
    Array.prototype.forEach.call($("tabs").children, function (b) {
      b.classList.toggle("active", b.getAttribute("data-view") === id);
    });
  }

  /* ---- a view ------------------------------------------------------------ */
  function cardHtml(n, v) {
    var e = D.elements[n.id];
    var cls = "node " + e.kind + (e.external ? " ext" : "") + (e.adrs.length ? " decided" : "") + (n.role === "placeholder" ? " placeholder" : "");
    if (n.role === "placeholder") {
      return { cls: cls, html: '<div class="name">' + esc(e.name) + '</div><div class="drill">→ 다른 그림에 있음</div>' };
    }
    var tag = e.external ? (e.kind === "person" ? "Person" : "External") : TAG[e.kind];
    var tags = '<span class="tag ' + (e.external ? "external" : e.kind) + '">' + tag + "</span>";
    if (e.adrs.length) tags += '<span class="tag adr">ADR ' + e.adrs.map(function (x) { return +x; }).join(" · ") + "</span>";
    var tech = e.technology ? '<div class="tech">' + esc(e.technology).replace(/,\s*/g, " · ") + "</div>" : "";
    var desc = e.description ? '<div class="desc">' + esc(e.description) + "</div>" : "";
    var drill = e.views.filter(function (x) { return x !== v.id; }).length ? '<div class="drill">→ 안으로 들어가기</div>' : "";
    return { cls: cls, html: '<div class="tags">' + tags + '</div><div class="name">' + esc(e.name) + "</div>" + tech + desc + drill };
  }

  function showView(id, selectId) {
    var v = viewById(id);
    S.tab = "view"; S.view = v; S.sel = null;
    $("decisions").hidden = true; $("canvas").hidden = false;
    markTab(id);
    closeDrawer(true);
    heading(v);

    var stage = $("stage");
    stage.innerHTML = "";
    stage.style.visibility = "hidden";
    $("status").textContent = "배치 계산 중…";
    nodesById = {}; edgeEls = [];

    // 1) Cards and labels in the DOM, to measure them.
    v.nodes.forEach(function (n) {
      var c = cardHtml(n, v);
      var d = el("div", c.cls, c.html);
      d.setAttribute("data-id", n.id);
      stage.appendChild(d);
      nodesById[n.id] = d;
      d.addEventListener("click", function (ev) { if (!S.dragged) { ev.stopPropagation(); select(n.id); } });
      d.addEventListener("dblclick", function (ev) {
        ev.stopPropagation();
        var vs = D.elements[n.id].views.filter(function (x) { return x !== v.id; });
        if (vs.length) showView(vs[0]); else if (n.role === "placeholder") showView(viewFor(n.id), n.id);
      });
      var dr = d.querySelector(".drill");
      if (dr) dr.addEventListener("click", function (ev) {
        ev.stopPropagation();
        if (n.role === "placeholder") return showView(viewFor(n.id), n.id);
        showView(D.elements[n.id].views.filter(function (x) { return x !== v.id; })[0]);
      });
      d.addEventListener("mouseenter", function () { hover(n.id); });
      d.addEventListener("mouseleave", function () { hover(null); });
    });
    v.edges.forEach(function (e, i) {
      var parts = e.labels.map(function (l) {
        var m = /^(.*?)\s*\[(.*)\]$/.exec(l);
        return m ? esc(m[1]) + '<div class="t">' + esc(m[2]) + "</div>" : esc(l);
      });
      var lab = el("div", "edge-label " + (e.kind || "flow"), parts.join("<br>"));
      stage.appendChild(lab);
      edgeEls.push({ e: e, label: lab, path: null });
      lab.addEventListener("mouseenter", function () { hoverEdge(i, true); });
      lab.addEventListener("mouseleave", function () { hoverEdge(i, false); });
    });

    // 2) ELK graph: scope boundary as a compound node, edges at the root.
    var graph = {
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": v.direction || "RIGHT",
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.hierarchyHandling": "INCLUDE_CHILDREN",
        "elk.layered.spacing.nodeNodeBetweenLayers": "90",
        "elk.spacing.nodeNode": "60",
        "elk.spacing.edgeNode": "28",
        "elk.spacing.edgeEdge": "18",
        "elk.layered.spacing.edgeNodeBetweenLayers": "40",
        "elk.layered.spacing.edgeEdgeBetweenLayers": "16",
        "elk.spacing.edgeLabel": "6",
        "elk.edgeLabels.placement": "CENTER",
        "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
        "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
        "elk.padding": "[top=20,left=20,bottom=20,right=20]",
      },
      children: [], edges: [],
    };
    var box = null;
    if (v.scope) {
      box = { id: "__box", layoutOptions: { "elk.padding": "[top=58,left=36,bottom=36,right=36]" }, children: [] };
      graph.children.push(box);
    }
    v.nodes.forEach(function (n) {
      var d = nodesById[n.id];
      (n.box && box ? box.children : graph.children).push({ id: n.id, width: d.offsetWidth, height: d.offsetHeight });
    });
    v.edges.forEach(function (e, i) {
      var lab = edgeEls[i].label;
      graph.edges.push({
        id: "e" + i, sources: [e.from], targets: [e.to],
        labels: [{ id: "l" + i, text: " ", width: lab.offsetWidth + 6, height: lab.offsetHeight + 4 }],
      });
    });

    elk.layout(graph).then(function (g) {
      if (S.view !== v) return;  // another view was opened meanwhile
      place(g, v);
      $("status").textContent = "";
      stage.style.visibility = "";
      fit();
      applyEmphasis();
      if (selectId && nodesById[selectId]) select(selectId);
      setHash();
    }).catch(function (err) {
      $("status").textContent = "배치 계산 실패: " + err.message;
    });
    setHash();
  }

  function heading(v) {
    var E = D.elements, chain = [], s = v.scope;
    while (s) { chain.unshift(s); s = E[s].parent; }
    var badge = v.scope ? "Level 2 · Container · " + esc(E[v.scope].name) : "Level 1 · System Context";
    var crumbs = '<a href="#" data-home>전체</a>' + chain.map(function (id) { return " › " + esc(E[id].name); }).join("");
    $("heading").innerHTML = '<span class="badge">' + badge + "</span><h1>" + esc(viewTitle(v)) + "</h1><p>" +
      esc(v.description || "") + '</p><div class="crumbs">' + crumbs + "</div>";
    var home = $("heading").querySelector("[data-home]");
    home.onclick = function (e) { e.preventDefault(); showView(D.views[0].id); };
  }

  /* ELK may bend a route right next to a card, leaving almost no straight run
   * into the arrowhead (or out of the source). Slide the adjacent perpendicular
   * segment back so the first and last runs are at least `min` long, as long as
   * the run before it has room. */
  function ensureEndRuns(pts, min) {
    function fix(a, b, c, d) {   // run c->d at the end; b->c perpendicular; a->b parallel to c->d
      var len = Math.hypot(d.x - c.x, d.y - c.y);
      if (len >= min || !a) return;
      var ux = (d.x - c.x) / (len || 1), uy = (d.y - c.y) / (len || 1);
      if (!len) return;
      var need = min - len;
      var room = (a.x - b.x) * -ux + (a.y - b.y) * -uy;  // how far b can move back toward a
      var shift = Math.min(need, room - 12);
      if (shift <= 0) return;
      b.x -= ux * shift; b.y -= uy * shift;
      c.x -= ux * shift; c.y -= uy * shift;
    }
    var n = pts.length;
    if (n >= 4) fix(pts[n - 4], pts[n - 3], pts[n - 2], pts[n - 1]);
    if (n >= 4) fix(pts[3], pts[2], pts[1], pts[0]);
    return pts;
  }

  /* Rounded orthogonal path through the ELK route points. */
  function roundedPath(pts, r) {
    var d = "M" + pts[0].x + "," + pts[0].y;
    for (var i = 1; i < pts.length - 1; i++) {
      var a = pts[i - 1], b = pts[i], c = pts[i + 1];
      var l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
      var rr = Math.min(r, l1 / 2, l2 / 2);
      var p = { x: b.x - (b.x - a.x) / (l1 || 1) * rr, y: b.y - (b.y - a.y) / (l1 || 1) * rr };
      var q = { x: b.x + (c.x - b.x) / (l2 || 1) * rr, y: b.y + (c.y - b.y) / (l2 || 1) * rr };
      d += " L" + p.x + "," + p.y + " Q" + b.x + "," + b.y + " " + q.x + "," + q.y;
    }
    var z = pts[pts.length - 1];
    return d + " L" + z.x + "," + z.y;
  }

  function place(g, v) {
    var stage = $("stage");
    // ELK returns child positions relative to their parent, and edge routes
    // relative to the edge's container (the compound node holding both ends).
    var off = { root: { x: 0, y: 0 } }, parentOf = {};
    (function walk(n, ox, oy) {
      (n.children || []).forEach(function (c) {
        var ax = ox + c.x, ay = oy + c.y;
        off[c.id] = { x: ax, y: ay };
        parentOf[c.id] = n.id;
        if (c.id === "__box") {
          var b = el("div", "boundary", '<span class="label">' + esc(D.elements[v.scope].name) + " · System</span>");
          b.style.cssText = "left:" + ax + "px;top:" + ay + "px;width:" + c.width + "px;height:" + c.height + "px";
          stage.insertBefore(b, stage.firstChild);
        } else {
          nodesById[c.id].style.left = ax + "px";
          nodesById[c.id].style.top = ay + "px";
        }
        walk(c, ax, ay);
      });
    })(g, 0, 0);

    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", g.width); svg.setAttribute("height", g.height);
    svg.innerHTML =
      '<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">' +
      '<path d="M0,1 L9,5 L0,9 z" style="fill:var(--edge)"/></marker>' +
      '<marker id="arr-hi" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">' +
      '<path d="M0,1 L9,5 L0,9 z" style="fill:var(--edge-hi)"/></marker>' +
      '<marker id="arr-hi-alt" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">' +
      '<path d="M0,1 L9,5 L0,9 z" style="fill:var(--edge-hi-alt)"/></marker>' +
      '<marker id="arr-hi-call" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">' +
      '<path d="M0,1 L9,5 L0,9 z" style="fill:var(--edge-hi-call)"/></marker></defs>';
    var under = stage.querySelector(".boundary");  // edges above the boundary, below the cards
    stage.insertBefore(svg, under ? under.nextSibling : stage.firstChild);
    (g.edges || []).forEach(function (ge) {
      var i = +ge.id.slice(1), rec = edgeEls[i];
      var sec = (ge.sections || [])[0];
      if (!sec) return;
      var cont = ge.container || (parentOf[rec.e.from] === parentOf[rec.e.to] ? parentOf[rec.e.from] : "root");
      var o = off[cont] || off.root;
      var pts = ensureEndRuns([sec.startPoint].concat(sec.bendPoints || [], [sec.endPoint]).map(function (p) { return { x: p.x + o.x, y: p.y + o.y }; }), 30);
      var grp = document.createElementNS(NS, "g");
      var kind = rec.e.kind || "flow";
      grp.setAttribute("class", "edge " + kind);
      var path = document.createElementNS(NS, "path");
      path.setAttribute("d", roundedPath(pts, 10));
      path.setAttribute("marker-end", "url(#arr)");
      if (kind === "call") path.setAttribute("marker-start", "url(#arr)");   // asks and gets the answer back
      grp.appendChild(path);
      svg.appendChild(grp);
      rec.g = grp; rec.path = path;
      var L = (ge.labels || [])[0];
      if (L && L.x != null) {
        rec.label.style.left = (o.x + L.x + L.width / 2) + "px";
        rec.label.style.top = (o.y + L.y + L.height / 2) + "px";
      } else {
        var m = pts[Math.floor(pts.length / 2)];
        rec.label.style.left = m.x + "px"; rec.label.style.top = m.y + "px";
      }
    });
    S.size = { w: g.width, h: g.height };
  }

  /* ---- pan / zoom ------------------------------------------------------- */
  function apply() {
    $("stage").style.transform = "translate(" + S.tf.x + "px," + S.tf.y + "px) scale(" + S.tf.k + ")";
  }
  function fit() {
    if (!S.size) return;
    var c = $("canvas"), W = c.clientWidth, H = c.clientHeight;
    var top = $("heading").offsetHeight + 40, bottom = 70, side = 30;
    var aw = W - side * 2, ah = H - top - bottom;
    var k = Math.min(aw / S.size.w, ah / S.size.h, 1.1);
    k = Math.max(k, 0.25);
    S.tf = { k: k, x: (W - S.size.w * k) / 2, y: top + Math.max(0, (ah - S.size.h * k) / 2) };
    apply();
  }
  function zoomAt(f, cx, cy) {
    var c = $("canvas");
    if (cx == null) { cx = c.clientWidth / 2; cy = c.clientHeight / 2; }
    var k = Math.min(2.5, Math.max(0.2, S.tf.k * f));
    S.tf.x = cx - (cx - S.tf.x) * (k / S.tf.k);
    S.tf.y = cy - (cy - S.tf.y) * (k / S.tf.k);
    S.tf.k = k;
    apply();
  }
  function initPanZoom() {
    var c = $("canvas"), start = null;
    c.addEventListener("wheel", function (e) {
      e.preventDefault();
      var r = c.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    c.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY, tx: S.tf.x, ty: S.tf.y };
      S.dragged = false;
    });
    window.addEventListener("pointermove", function (e) {
      if (!start) return;
      var dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!S.dragged && Math.abs(dx) + Math.abs(dy) < 4) return;
      S.dragged = true;
      c.classList.add("dragging");
      S.tf.x = start.tx + dx; S.tf.y = start.ty + dy;
      apply();
    });
    window.addEventListener("pointerup", function () {
      if (!start) return;
      start = null;
      c.classList.remove("dragging");
      setTimeout(function () { S.dragged = false; }, 0);
    });
    c.addEventListener("click", function (e) {
      if (!S.dragged && (e.target === c || e.target.id === "stage" || e.target.tagName === "svg")) {
        select(null);
      }
    });
  }

  /* ---- emphasis: hover, selection, ADR filter --------------------------- */
  function connected(id) {
    var out = { nodes: {}, edges: {} };
    out.nodes[id] = true;
    edgeEls.forEach(function (r, i) {
      if (r.e.from === id || r.e.to === id) { out.edges[i] = true; out.nodes[r.e.from] = out.nodes[r.e.to] = true; }
    });
    return out;
  }
  function paint(nodeOn, edgeOn, hiEdges) {
    Object.keys(nodesById).forEach(function (id) { nodesById[id].classList.toggle("faded", !nodeOn(id)); });
    edgeEls.forEach(function (r, i) {
      var on = edgeOn(i), hi = !!(hiEdges && hiEdges[i]);
      r.label.classList.toggle("faded", !on);
      r.label.classList.toggle("hi", hi);
      if (r.g) {
        r.g.classList.toggle("faded", !on);
        r.g.classList.toggle("hi", hi);
        var k = r.e.kind || "flow", m = hi ? (k === "flow" ? "url(#arr-hi)" : "url(#arr-hi-" + k + ")") : "url(#arr)";
        r.path.setAttribute("marker-end", m);
        if (k === "call") r.path.setAttribute("marker-start", m);
      }
    });
  }
  function applyEmphasis() {
    if (S.adr) {
      return paint(function (id) { return D.elements[id].adrs.indexOf(S.adr) >= 0; }, function () { return false; });
    }
    if (S.sel) {
      var c = connected(S.sel);
      return paint(function (id) { return c.nodes[id]; }, function (i) { return c.edges[i]; }, c.edges);
    }
    paint(function () { return true; }, function () { return true; });
  }
  function hover(id) {
    if (!id) return applyEmphasis();
    var c = connected(id);
    paint(function (x) { return c.nodes[x]; }, function (i) { return c.edges[i]; }, c.edges);
  }
  function hoverEdge(i, on) {
    if (!on) return applyEmphasis();
    var r = edgeEls[i], h = {}; h[i] = true;
    paint(function (x) { return x === r.e.from || x === r.e.to; }, function (j) { return j === i; }, h);
  }

  /* ---- drawer ----------------------------------------------------------- */
  function openDrawer(html) {
    var d = $("drawer");
    d.innerHTML = '<button class="close" title="닫기 (Esc)">×</button>' + html;
    d.querySelector(".close").onclick = function () { select(null); if (S.adr) { S.adr = null; $("filter").value = ""; applyEmphasis(); } };
    d.classList.add("open");
    Array.prototype.forEach.call(d.querySelectorAll("[data-goto]"), function (a) {
      a.onclick = function (e) { e.preventDefault(); goto(a.getAttribute("data-goto")); };
    });
    Array.prototype.forEach.call(d.querySelectorAll("[data-view]"), function (a) {
      a.onclick = function (e) { e.preventDefault(); showView(a.getAttribute("data-view")); };
    });
  }
  function closeDrawer(keepSel) {
    $("drawer").classList.remove("open");
    if (!keepSel) { S.sel = null; Object.keys(nodesById).forEach(function (id) { nodesById[id].classList.remove("selected"); }); }
  }
  function goto(id) {
    if (S.tab === "view" && nodesById[id] && S.view.nodes.filter(function (n) { return n.id === id && n.role !== "placeholder"; }).length) select(id);
    else showView(viewFor(id), id);
  }

  function adrCard(n, full) {
    var a = D.adrs[n], E = D.elements;
    var els = Object.keys(E).filter(function (id) { return E[id].adrs.indexOf(n) >= 0; });
    var chips = els.map(function (id) {
      return '<a class="chip" href="#" data-goto="' + id + '">' + esc((TAG[E[id].kind] || "") + " · " + E[id].name) + "</a>";
    }).join("");
    var body = full
      ? (a.context ? '<div class="sec">CONTEXT</div><div class="txt">' + esc(a.context) + "</div>" : "") +
        (a.decision ? '<div class="sec">DECISION</div><div class="txt strong">' + esc(a.decision) + "</div>" : "") +
        (a.tradeoff ? '<div class="sec">TRADE-OFF</div><div class="txt">' + esc(a.tradeoff) + "</div>" : "")
      : '<div class="txt">' + esc(a.summary) + "</div>";
    return '<div class="adr-card"><div class="hd"><div class="meta"><span class="pill ' + esc(a.status) + '">' + esc(a.statusLabel) +
      '</span><span class="id">ADR-' + n + '</span><span class="date">' + esc(a.date) + (a.area ? " · " + esc(a.area) : "") +
      '</span></div><h4><a href="' + esc(a.url) + '" target="_top">' + esc(a.title) + "</a></h4></div>" +
      '<div class="bd">' + body + "</div>" +
      (chips ? '<div class="ft"><div class="sec">LINKED C4 ELEMENTS</div><div class="chips">' + chips + "</div></div>" : "") +
      (a.records && a.records.length ? '<div class="ft"><div class="sec">VERIFIED BY</div><div class="chips">' + vrChips(a.records) + "</div></div>" : "") +
      "</div>";
  }

  /* Verification records (docs/records/, added to data.json by docs-kit hooks/records.py). */
  function vrChips(nums) {
    var R = D.records || {};
    return nums.map(function (n) {
      var r = R[n] || {};
      return '<a class="chip vr ' + esc(r.result || "") + '" href="' + esc(r.url || "#") + '" target="_top" title="' +
        esc((r.resultLabel || "") + " · " + (r.date || "") + " · " + (r.subject || "")) + '">VR-' + n +
        (r.supersededBy && r.supersededBy.length ? " (대체됨)" : "") + "</a>";
    }).join("");
  }

  function select(id) {
    S.sel = id;
    Object.keys(nodesById).forEach(function (x) { nodesById[x].classList.toggle("selected", x === id); });
    if (!id) { closeDrawer(); applyEmphasis(); return setHash(); }
    if (S.adr) { S.adr = null; $("filter").value = ""; }
    applyEmphasis();
    var E = D.elements, e = E[id];
    var tag = e.external ? (e.kind === "person" ? "Person" : "External") : TAG[e.kind];
    var rel = function (dir) {
      return D.relations.filter(function (r) { return r[dir === "out" ? "from" : "to"] === id; }).map(function (r) {
        var o = dir === "out" ? r.to : r.from;
        return '<li class="rel"><span class="dir">' + (dir === "out" ? "→" : "←") + '</span><a class="go" href="#" data-goto="' + o + '">' +
          esc(E[o].name) + "</a> · " + esc(r.label) + (r.tech ? ' <span class="t">' + esc(r.tech) + "</span>" : "") + "</li>";
      }).join("");
    };
    var out = rel("out"), inc = rel("in");
    var views = e.views.map(function (vid) {
      return '<a class="btn" href="#" data-view="' + vid + '">→ ' + esc(viewTitle(viewById(vid))) + "</a>";
    }).join("");
    openDrawer(
      '<div class="tags"><span class="tag ' + (e.external ? "external" : e.kind) + '">' + tag + "</span></div>" +
      "<h2>" + esc(e.name) + "</h2>" +
      (e.technology ? '<div class="tech">' + esc(e.technology).replace(/,\s*/g, " · ") + "</div>" : "") +
      (e.description ? "<p>" + esc(e.description) + "</p>" : "") +
      (e.parent ? '<p class="muted">소속: <a class="go" href="#" data-goto="' + e.parent + '">' + esc(E[e.parent].name) + "</a></p>" : "") +
      (views ? "<div>" + views + "</div>" : "") +
      "<h3>Decisions</h3>" + (e.adrs.length ? e.adrs.map(function (n) { return adrCard(n, false); }).join("") : '<p class="muted">연결된 결정 없음</p>') +
      (e.records && e.records.length ? '<h3>Verification</h3><div class="chips">' + vrChips(e.records) + "</div>" : "") +
      (out ? "<h3>Outgoing</h3><ul>" + out + "</ul>" : "") +
      (inc ? "<h3>Incoming</h3><ul>" + inc + "</ul>" : "")
    );
    reveal(id);
    setHash();
  }

  function openAdr(n) {
    openDrawer("<h3 style=\"margin-top:4px\">Decision</h3>" + adrCard(n, true) +
      '<p class="muted">강조된 카드가 이 결정이 걸린 요소입니다. 다른 그림에 있는 요소는 칩을 누르면 이동합니다.</p>');
  }

  /* Keep the selected card visible to the left of the open drawer. */
  function reveal(id) {
    var d = nodesById[id], c = $("canvas");
    if (!d) return;
    var r = d.getBoundingClientRect(), cr = c.getBoundingClientRect();
    var free = cr.right - (c.clientWidth > 760 ? $("drawer").offsetWidth : 0) - 24;
    var dx = 0;
    if (r.right > free) dx = free - r.right;
    if (r.left + dx < cr.left + 24) dx = cr.left + 24 - r.left;
    if (dx) { S.tf.x += dx; apply(); }
  }

  /* ---- decisions tab ---------------------------------------------------- */
  function showDecisions(focus) {
    S.tab = "decisions"; S.adr = focus || null;
    markTab("__decisions");
    closeDrawer();
    $("canvas").hidden = true;
    var box = $("decisions");
    box.hidden = false;
    var nums = Object.keys(D.adrs).sort();
    box.innerHTML =
      '<div class="intro"><span class="pill proposed" style="border-radius:6px">ADRs · Architecture Decision Records</span>' +
      "<h1>구조를 만든 결정들</h1><p>각 결정과 그 결정이 걸린 C4 요소입니다. 칩을 누르면 다이어그램에서 해당 요소가 열립니다.</p></div>" +
      '<div class="grid">' + nums.filter(function (n) { return !focus || n === focus; }).map(function (n) { return adrCard(n, true); }).join("") + "</div>";
    Array.prototype.forEach.call(box.querySelectorAll("[data-goto]"), function (a) {
      a.onclick = function (e) { e.preventDefault(); showView(viewFor(a.getAttribute("data-goto")), a.getAttribute("data-goto")); };
    });
    setHash();
  }
})();
