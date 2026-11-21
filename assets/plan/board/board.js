/* Sprint board (docs-kit site/src/lib/plan.ts writes data.js: window.PLAN_BOARD).
 *
 * Cards are the backlog items and the WBS items outside a backlog of docs/plan/scope.yml. A sprint (docs/plan/
 * sprints.json) holds which cards it took and in which column: items {id: todo | doing | review | done}, blocked
 * {id: reason}, goal, retro {good, problem, try}, carried (ids moved on at close). Drag a card between the backlog
 * and the columns, or use the panel (click a card) - the same moves without a mouse.
 *
 * Saving: only when the page comes from the development preview (save.from_ports, 8001) - then every change is
 * POSTed to docs-kit bin/plan_board.py (save.port, 8002; the project's start command is save.start) on the same host, which writes sprints.json; the preview
 * rebuilds. Elsewhere (the shared site) the board is read-only; 내보내기 copies the sprints as JSON.
 * Closing a sprint moves its unfinished cards to the next sprint (created when there is none), like GitLab's
 * iteration roll-over and Linear's cycles.
 */
(function () {
  "use strict";
  var D = window.PLAN_BOARD;
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  if (!D) { document.body.textContent = "data.js가 없습니다. 문서를 다시 빌드하세요."; return; }

  var cards = {}, epics = {};
  D.cards.forEach(function (c) { cards[c.id] = c; });
  D.epics.forEach(function (e) { epics[e.id] = e; });
  var sprints = JSON.parse(JSON.stringify(D.sprints || []));
  var cur = 0, selected = null;
  var api = location.protocol + "//" + location.hostname + ":" + ((D.save && D.save.port) || 8002) + "/api/sprints";
  var startCmd = (D.save && D.save.start) || "python3 .docs-kit/bin/plan_board.py";
  var editable = location.protocol.indexOf("http") === 0 &&
                 ((D.save && D.save.from_ports) || [8001]).map(String).indexOf(location.port) >= 0;

  function sp() { return sprints[cur]; }
  function writable() { return editable && sp() && sp().state !== "closed"; }
  function mid(c) { return c.size ? (c.size[0] + c.size[1]) / 2 : 0; }
  function sizeTxt(c) { return !c.size ? "" : c.size[0] === c.size[1] ? String(c.size[0]) : c.size[0] + "~" + c.size[1]; }
  function addDays(s, n) { var d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n);
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function daysBetween(a, b) { return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 864e5); }
  function toast(t) { var e = el("div", "toast", t); document.body.appendChild(e); setTimeout(function () { e.remove(); }, 2600); }

  /* ---------- saving ---------- */
  var saveTimer = null, dirty = false;
  function setSave(text, cls) { var s = $("save"); s.textContent = text; s.className = "save" + (cls ? " " + cls : ""); }
  function payload() {
    return { cadence_days: D.cadence_days, wip_limit: D.wip_limit, save: D.save, sprints: sprints };
  }
  function changed() {
    dirty = true;
    try { localStorage.setItem("docs-kit-board-draft", JSON.stringify({ at: Date.now(), built: D.built, data: payload() })); } catch (e) {}
    render();
    if (!editable) { setSave("보기 전용: 바꾼 것은 이 브라우저에만 있습니다 (내보내기)", "err"); return; }
    setSave("저장 중…");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 500);
  }
  function save() {
    fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload()) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); })
      .then(function () {
        dirty = false;
        try { localStorage.removeItem("docs-kit-board-draft"); } catch (e) {}
        var d = new Date(); setSave("저장됨 " + ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2) + " (sprints.json)", "ok");
      })
      .catch(function (e) {
        setSave("저장 못 함: " + (String(e.message || e).indexOf("fetch") >= 0 ? "저장 서버가 꺼져 있음 (" + startCmd + ")" : e.message), "err");
      });
  }
  window.addEventListener("beforeunload", function (ev) { if (dirty && editable) { ev.preventDefault(); ev.returnValue = ""; } });

  /* ---------- moves ---------- */
  function colOf(id) { var s = sp(); return s && s.items ? s.items[id] : undefined; }
  function move(id, col) {
    var s = sp(); if (!writable()) { toast(editable ? "마감한 스프린트는 바꿀 수 없습니다" : "보기 전용입니다 (개발 미리보기 8001에서 엽니다)"); return; }
    s.items = s.items || {};
    if (col === "backlog") { delete s.items[id]; if (s.blocked) delete s.blocked[id]; }
    else {
      var wip = Object.keys(s.items).filter(function (k) { return s.items[k] === "doing" && k !== id; }).length;
      s.items[id] = col;
      if (col === "doing" && wip >= D.wip_limit) toast("진행 중이 " + (wip + 1) + "개입니다 (한도 " + D.wip_limit + "). 하나를 끝내고 시작하는 것을 권합니다");
      if (col === "done" && s.blocked) delete s.blocked[id];
    }
    changed();
  }
  function setBlocked(id, reason) {
    var s = sp(); if (!writable()) return;
    s.blocked = s.blocked || {};
    if (reason) s.blocked[id] = reason; else delete s.blocked[id];
    changed();
  }

  /* ---------- rendering ---------- */
  function cardEl(c, inSprint) {
    var e = el("div", "card" + (writable() ? "" : " ro") + (selected === c.id ? " sel" : ""));
    e.style.setProperty("--epic", (epics[c.epic] || {}).color || "");
    e.draggable = writable(); e.dataset.id = c.id; e.tabIndex = 0;
    e.title = (epics[c.epic] ? epics[c.epic].id + " " + epics[c.epic].short + " › " : "") + c.chain.join(" › ");
    var top = el("div", "id"), ep = epics[c.epic] || {};
    var chip = el("span", "ep", ep.id || "?"); chip.style.background = ep.color || "";
    chip.title = (ep.id || "") + " " + (ep.title || "");
    top.appendChild(chip); top.appendChild(document.createTextNode(c.id + (c.issue != null ? "  #" + c.issue : "")));
    e.appendChild(top);
    e.appendChild(el("div", "t", c.title));
    var m = el("div", "m");
    m.appendChild(el("span", "tag lv-" + c.level, c.level === "wbs" ? "WBS" : "Backlog"));
    if (c.size) m.appendChild(el("span", "tag", sizeTxt(c) + " pt"));
    if (c.kind === "learn") m.appendChild(el("span", "tag learn", "배우기 (시간 상자)"));
    if (c.kind === "decide") m.appendChild(el("span", "tag", "결정"));
    var s = sp(), col = colOf(c.id);
    if (inSprint && s.blocked && s.blocked[c.id]) { var b = el("span", "tag block", "막힘"); b.title = s.blocked[c.id]; m.appendChild(b); }
    if (inSprint && col === "done" && c.state !== "done") { var p = el("span", "tag proof", "근거 필요"); p.title = "보드에서는 완료지만 로드맵이 done이 아니거나 이슈가 열려 있습니다"; m.appendChild(p); }
    if (c.state === "done" && col !== "done") { var d = el("span", "tag isdone", "완료됨 " + c.date.slice(5)); d.title = "로드맵·이슈에서 완료"; m.appendChild(d); }
    if (c.state === "doing" && !inSprint) m.appendChild(el("span", "tag", "진행 중"));
    e.appendChild(m);
    e.addEventListener("click", function () { selected = c.id; render(); showPanel(c); });
    e.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { selected = c.id; render(); showPanel(c); } });
    e.addEventListener("dragstart", function (ev) { ev.dataTransfer.setData("text/plain", c.id); ev.dataTransfer.effectAllowed = "move"; e.classList.add("dragging"); });
    e.addEventListener("dragend", function () { e.classList.remove("dragging"); });
    return e;
  }
  function dropZone(zone, col) {
    zone.addEventListener("dragover", function (ev) { if (!writable()) return; ev.preventDefault(); zone.classList.add("dragover"); });
    zone.addEventListener("dragleave", function (ev) { if (!zone.contains(ev.relatedTarget)) zone.classList.remove("dragover"); });
    zone.addEventListener("drop", function (ev) { ev.preventDefault(); zone.classList.remove("dragover"); var id = ev.dataTransfer.getData("text/plain"); if (cards[id]) move(id, col); });
  }

  function renderHeader() {
    var sel = $("sprint"); sel.innerHTML = "";
    sprints.forEach(function (s, i) { var o = el("option", null, s.id + "  " + s.start.slice(5) + "~" + s.end.slice(5)); o.value = i; sel.appendChild(o); });
    sel.value = cur;
    var s = sp();
    $("prev").disabled = cur <= 0; $("next").disabled = cur >= sprints.length - 1;
    var st = { planned: "계획", active: "진행 중", closed: "마감" };
    $("sstate").textContent = s ? st[s.state] || s.state : "스프린트 없음";
    $("sstate").className = "chip " + (s ? s.state : "");
    if (s) {
      var left = daysBetween(D.today, s.end);
      $("sdates").textContent = s.start + " ~ " + s.end + (s.state === "active" ? (left >= 0 ? " · 남은 날 " + left + "일" : " · 끝난 날 지남 (마감하세요)") : "");
    } else $("sdates").textContent = "";
    var hasActive = sprints.some(function (x) { return x.state === "active"; });
    var last = sprints[sprints.length - 1];
    $("plan").disabled = !editable || (last && last.state === "planned");
    $("start").disabled = !editable || !s || s.state !== "planned" || hasActive;
    $("close").disabled = !editable || !s || s.state !== "active";
    $("export").hidden = editable;
    $("goal").value = s ? s.goal || "" : ""; $("goal").disabled = !writable();
    var r = (s && s.retro) || {};
    ["good", "problem", "try"].forEach(function (k) { var t = $("r-" + k); t.value = r[k] || ""; t.disabled = !(editable && s); });
    if (s) {
      var items = s.items || {}, committed = 0, done = 0, n = 0;
      Object.keys(items).forEach(function (k) { if (!cards[k]) return; n++; committed += mid(cards[k]); if (items[k] === "done") done += mid(cards[k]); });
      $("stats").textContent = "일 " + n + "개 · 약속 " + committed + " 포인트 · 끝냄 " + done + " 포인트" +
        (s.carried && s.carried.length ? " · 다음으로 넘긴 일 " + s.carried.length : "");
    } else $("stats").textContent = "";
    if (!editable) { $("banner").hidden = false; $("banner").textContent = "보기 전용입니다. 카드를 옮기려면 개발 미리보기(포트 " + ((D.save && D.save.from_ports) || [8001]).join(", ") + ")에서 이 보드를 열고 저장 서버를 켭니다: " + startCmd; }
    else if (s && s.state === "closed") { $("banner").hidden = false; $("banner").textContent = "마감한 스프린트입니다. 기록으로만 보이고 회고만 고칠 수 있습니다."; }
    else $("banner").hidden = true;
  }

  function renderBacklog() {
    var box = $("backlog"); box.innerHTML = "";
    var s = sp(), items = (s && s.items) || {}, q = $("q").value.trim().toLowerCase(), fe = $("fepic").value, fw = $("fwave").value;
    var taken = {};
    sprints.forEach(function (x) { if (x.state !== "closed" && x !== s) Object.keys(x.items || {}).forEach(function (k) { taken[k] = x.id; }); });
    var groups = {}, order = [];
    D.cards.forEach(function (c) {
      if (items[c.id] || c.removed || c.state === "done" || taken[c.id]) return;
      if (fe && c.epic !== fe) return;
      if (fw && c.wave !== fw) return;
      if (q && (c.id + " " + c.title + " " + (c.issue != null ? "#" + c.issue : "") + " " + c.chain.join(" ")).toLowerCase().indexOf(q) < 0) return;
      if (!groups[c.epic]) { groups[c.epic] = []; order.push(c.epic); }
      groups[c.epic].push(c);
    });
    if (!order.length) box.appendChild(el("div", "empty", "맞는 일이 없습니다"));
    D.epics.forEach(function (e) {
      if (!groups[e.id]) return;
      var g = el("div", "grp"); var i = el("i"); i.style.background = e.color; g.appendChild(i);
      g.appendChild(document.createTextNode(e.id + " " + e.short + " (" + groups[e.id].length + ")")); box.appendChild(g);
      groups[e.id].forEach(function (c) { box.appendChild(cardEl(c, false)); });
    });
  }

  var lanes = true, folded = {};
  try { lanes = localStorage.getItem("docs-kit-board-lanes") !== "0"; folded = JSON.parse(localStorage.getItem("docs-kit-board-folded") || "{}"); } catch (e) {}
  function colHead(cc, ids) {
    var col = cc[0], pts = ids.reduce(function (a, k) { return a + mid(cards[k]); }, 0);
    var h = el("div", "col-h"); h.appendChild(el("span", null, cc[1]));
    var info = el("span", "muted", ids.length + "개 · " + pts + " pt");
    if (col === "doing") { info.appendChild(el("span", "wip", " / 한도 " + D.wip_limit)); if (ids.length > D.wip_limit) h.classList.add("over"); }
    h.appendChild(info); return h;
  }
  function byOrder(x, y) { return D.cards.indexOf(cards[x]) - D.cards.indexOf(cards[y]); }
  function renderBoard() {
    var b = $("board"); b.innerHTML = "";
    var s = sp(), items = (s && s.items) || {};
    var inCol = {}; D.cols.forEach(function (cc) { inCol[cc[0]] = Object.keys(items).filter(function (k) { return items[k] === cc[0] && cards[k]; }).sort(byOrder); });
    b.classList.toggle("lanes", lanes);
    if (!lanes) {
      D.cols.forEach(function (cc) {
        var col = cc[0], ids = inCol[col], c = el("div", "col"); c.dataset.col = col;
        c.appendChild(colHead(cc, ids));
        var list = el("div", "list drop"); list.dataset.col = col;
        ids.forEach(function (k) { list.appendChild(cardEl(cards[k], true)); });
        if (!ids.length) list.appendChild(el("div", "empty", col === "todo" ? "백로그에서 끌어 넣습니다" : "여기로 끌어 옮깁니다"));
        dropZone(list, col); c.appendChild(list); b.appendChild(c);
      });
      return;
    }
    // swimlanes: one row per stage (epic) that has cards in this sprint; columns stay the workflow
    D.cols.forEach(function (cc) { var h = colHead(cc, inCol[cc[0]]); h.classList.add("lane-colh"); b.appendChild(h); });
    var used = D.epics.filter(function (e) { return Object.keys(items).some(function (k) { return cards[k] && cards[k].epic === e.id; }); });
    if (!used.length) {
      D.cols.forEach(function (cc) { var cell = el("div", "cell list drop"); cell.dataset.col = cc[0];
        cell.appendChild(el("div", "empty", cc[0] === "todo" ? "백로그에서 끌어 넣습니다" : "")); dropZone(cell, cc[0]); b.appendChild(cell); });
      return;
    }
    used.forEach(function (e) {
      var ids = Object.keys(items).filter(function (k) { return cards[k] && cards[k].epic === e.id; });
      var pts = ids.reduce(function (a, k) { return a + mid(cards[k]); }, 0);
      var done = ids.filter(function (k) { return items[k] === "done"; });
      var blocked = ids.filter(function (k) { return s.blocked && s.blocked[k]; }).length;
      var lab = el("button", "lane-h"); lab.type = "button"; lab.style.setProperty("--epic", e.color);
      lab.appendChild(el("span", "fold", folded[e.id] ? "▸" : "▾"));
      var chip = el("span", "ep", e.id); chip.style.background = e.color; lab.appendChild(chip);
      lab.appendChild(el("b", null, e.short));
      lab.appendChild(el("span", "muted", "  " + ids.length + "개 · " + pts + " pt · 완료 " + done.length + (blocked ? " · 막힘 " + blocked : "")));
      lab.title = e.title + " (눌러서 접기·펴기)";
      lab.onclick = function () { folded[e.id] = !folded[e.id]; try { localStorage.setItem("docs-kit-board-folded", JSON.stringify(folded)); } catch (x) {} renderBoard(); };
      b.appendChild(lab);
      if (folded[e.id]) return;
      D.cols.forEach(function (cc) {
        var cell = el("div", "cell list drop"); cell.dataset.col = cc[0]; cell.style.setProperty("--epic", e.color);
        inCol[cc[0]].forEach(function (k) { if (cards[k].epic === e.id) cell.appendChild(cardEl(cards[k], true)); });
        dropZone(cell, cc[0]); b.appendChild(cell);
      });
    });
  }

  function renderVel() {
    var v = $("vel"); v.innerHTML = "";
    var stats = sprints.map(function (s) {
      var c = 0, d = 0; Object.keys(s.items || {}).forEach(function (k) { if (!cards[k]) return; c += mid(cards[k]); if (s.items[k] === "done") d += mid(cards[k]); });
      return [c, d];
    });
    var mx = Math.max.apply(null, [1].concat(stats.map(function (x) { return x[0]; })));
    sprints.forEach(function (s, i) {
      var b = el("div", "b" + (i === cur ? " cur" : "")); b.title = s.id + ": 약속 " + stats[i][0] + ", 끝냄 " + stats[i][1] + " 포인트";
      var bars = el("div", "bars"), c = el("span", "c"), d = el("span", "d");
      c.style.height = Math.max(1, 32 * stats[i][0] / mx) + "px"; d.style.height = Math.max(1, 32 * stats[i][1] / mx) + "px";
      bars.appendChild(c); bars.appendChild(d); b.appendChild(bars); b.appendChild(el("span", null, s.id));
      b.addEventListener("click", function () { go(i); });
      v.appendChild(b);
    });
  }

  function showPanel(c) {
    var p = $("panel"); p.hidden = false; p.innerHTML = "";
    var x = el("button", "x", "✕"); x.type = "button"; x.title = "닫기"; x.onclick = function () { p.hidden = true; selected = null; render(); };
    p.appendChild(x);
    var e = epics[c.epic] || {};
    p.appendChild(el("div", "muted small", (e.id ? e.id + " " + e.short : "") + (c.chain.length ? " › " + c.chain.join(" › ") : "")));
    p.appendChild(el("h2", null, c.title));
    var meta = el("div", "row");
    [c.id, c.level === "wbs" ? "WBS" : "Backlog", c.size ? sizeTxt(c) + " 포인트" : "크기 없음",
     { now: "시기 지금", next: "시기 다음", later: "시기 나중" }[c.wave] || "",
     { done: "근거: 완료 " + c.date, doing: "근거: 진행 중", todo: "근거: 할 일", dropped: "뺌" }[c.state] || ""].forEach(function (t) { if (t) meta.appendChild(el("span", "tag", t)); });
    p.appendChild(meta);
    var links = el("div", "row");
    if (c.issue != null && D.issues_url) { var a = el("a", null, "이슈 #" + c.issue); a.href = D.issues_url + c.issue; a.target = "_blank"; links.appendChild(a); }
    if (c.roadmap) { var r = el("a", null, "로드맵 항목"); r.href = c.roadmap; r.target = "_blank"; links.appendChild(r); }
    var h = el("a", null, "현황판에서 보기"); h.href = "../index.html#ep-" + c.epic.toLowerCase(); h.target = "_blank"; links.appendChild(h);
    p.appendChild(links);
    var s = sp();
    if (s) {
      p.appendChild(el("h3", null, "이 스프린트에서"));
      var row = el("div", "row"), sel = el("select");
      [["backlog", "백로그 (스프린트에서 뺌)"]].concat(D.cols).forEach(function (o) { var op = el("option", null, o[1]); op.value = o[0]; sel.appendChild(op); });
      sel.value = colOf(c.id) || "backlog"; sel.disabled = !writable();
      sel.onchange = function () { move(c.id, sel.value); showPanel(c); };
      row.appendChild(el("span", null, "칸")); row.appendChild(sel); p.appendChild(row);
      if (colOf(c.id)) {
        var br = el("div", "row"), inp = el("input"); inp.placeholder = "막힌 이유 (비우면 막힘 해제)";
        inp.value = (s.blocked && s.blocked[c.id]) || ""; inp.disabled = !writable();
        inp.onchange = function () { setBlocked(c.id, inp.value.trim()); };
        br.appendChild(el("span", null, "막힘")); br.appendChild(inp); p.appendChild(br);
      }
      if (colOf(c.id) === "done" && c.state !== "done")
        p.appendChild(el("div", "small", "근거 필요: 끝났다면 로드맵 항목을 done으로 바꾸거나 이슈를 닫습니다(커밋). 현황판의 진척은 근거로 셉니다."));
    }
    if (c.dod.length) { p.appendChild(el("h3", null, "완료 정의")); var ul = el("ul"); c.dod.forEach(function (t) { ul.appendChild(el("li", null, t)); }); p.appendChild(ul); }
    if (c.subs.length) {
      p.appendChild(el("h3", null, "아래 작업 (WBS)")); var ul2 = el("ul");
      c.subs.forEach(function (x) { var li = el("li"); var a = el(x.href ? "a" : "span", null, x.id + " " + x.title); if (x.href) { a.href = x.href; a.target = "_blank"; }
        li.appendChild(a); li.appendChild(el("span", "muted", " · " + ({ done: "완료", doing: "진행 중", todo: "할 일", dropped: "뺌" }[x.state] || x.state))); ul2.appendChild(li); });
      p.appendChild(ul2);
    }
    p.appendChild(el("h3", null, "팀 공통 완료 정의"));
    var ul3 = el("ul"); D.team_dod.forEach(function (t) { ul3.appendChild(el("li", null, t)); }); p.appendChild(ul3);
  }

  function render() {
    $("lanes").textContent = lanes ? "줄: 단계별" : "줄: 하나로";
    renderHeader(); renderBacklog(); renderBoard(); renderVel();
    if (sp()) history.replaceState(null, "", "#sprint=" + encodeURIComponent(sp().id));
  }
  function go(i) { if (i < 0 || i >= sprints.length) return; cur = i; selected = null; $("panel").hidden = true; render(); }

  /* ---------- sprint lifecycle ---------- */
  function nextId() {
    var n = 0; sprints.forEach(function (s) { var m = /^S(\d+)$/.exec(s.id); if (m) n = Math.max(n, +m[1]); });
    return "S" + (n + 1);
  }
  function newSprint(state) {
    var last = sprints[sprints.length - 1], start = last ? addDays(last.end, 1) : D.today;
    var s = { id: nextId(), start: start, end: addDays(start, D.cadence_days - 1), state: state, goal: "", items: {}, blocked: {} };
    sprints.push(s); return s;
  }
  $("plan").onclick = function () { newSprint("planned"); cur = sprints.length - 1; changed(); };
  $("start").onclick = function () { var s = sp(); s.state = "active"; changed(); };
  $("close").onclick = function () {
    var s = sp(), items = s.items || {};
    var left = Object.keys(items).filter(function (k) { return items[k] !== "done"; });
    if (!confirm(s.id + "를 마감합니다. 끝나지 않은 일 " + left.length + "개는 다음 스프린트로 넘어갑니다. 회고는 아래 칸에 적습니다.")) return;
    s.state = "closed"; s.closed_at = D.today; s.carried = left;
    var nx = sprints[cur + 1];
    if (!nx) nx = newSprint("active"); else if (nx.state === "planned") nx.state = "active";
    nx.items = nx.items || {}; nx.blocked = nx.blocked || {};
    left.forEach(function (k) { if (!nx.items[k]) nx.items[k] = items[k] === "review" ? "review" : items[k]; if (s.blocked && s.blocked[k]) nx.blocked[k] = s.blocked[k]; });
    cur = sprints.indexOf(nx); changed();
    toast(s.id + " 마감, " + left.length + "개를 " + nx.id + "로 넘김");
  };
  $("goal").onchange = function () { if (!writable()) return; sp().goal = $("goal").value.trim(); changed(); };
  ["good", "problem", "try"].forEach(function (k) {
    $("r-" + k).onchange = function () { var s = sp(); if (!editable || !s) return; s.retro = s.retro || {}; s.retro[k] = $("r-" + k).value.trim(); changed(); };
  });
  $("export").onclick = function () {
    var t = JSON.stringify(payload(), null, 2);
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast("JSON을 복사했습니다: docs/plan/sprints.json에 붙여 넣습니다"); },
      function () { var w = window.open(""); if (w) w.document.body.textContent = t; });
  };
  $("lanes").onclick = function () { lanes = !lanes; try { localStorage.setItem("docs-kit-board-lanes", lanes ? "1" : "0"); } catch (e) {} render(); };
  $("prev").onclick = function () { go(cur - 1); };
  $("next").onclick = function () { go(cur + 1); };
  $("sprint").onchange = function () { go(+$("sprint").value); };
  $("q").oninput = renderBacklog; $("fepic").onchange = renderBacklog; $("fwave").onchange = renderBacklog;
  $("theme").onclick = function () {
    var r = document.documentElement, t = r.getAttribute("data-theme") === "dark" ? "light" : "dark";
    r.setAttribute("data-theme", t); try { localStorage.setItem("docs-kit-board-theme", t); } catch (e) {}
  };
  var fe = $("fepic"); fe.appendChild(el("option", null, "단계 전체")).value = "";
  D.epics.forEach(function (e) { var o = el("option", null, e.id + " " + e.short); o.value = e.id; fe.appendChild(o); });
  dropZone($("backlog"), "backlog");
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") { $("panel").hidden = true; selected = null; render(); } });

  /* ---------- start ---------- */
  function pickInitial() {
    var m = /sprint=([^&]+)/.exec(location.hash), i = -1;
    if (m) sprints.forEach(function (s, k) { if (s.id === decodeURIComponent(m[1])) i = k; });
    if (i < 0) sprints.forEach(function (s, k) { if (s.state === "active") i = k; });
    cur = i >= 0 ? i : Math.max(0, sprints.length - 1);
  }
  function boot() { pickInitial(); render(); if (editable) setSave("저장 서버 연결됨 · 바꾸면 바로 저장", "ok"); else setSave("보기 전용"); }
  if (editable) {
    fetch(api).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) { if (j && j.sprints) sprints = j.sprints; boot(); })
      .catch(function () { boot(); setSave("저장 서버가 꺼져 있음: " + startCmd + " (그동안 바꾼 것은 저장되지 않음)", "err"); });
  } else boot();
})();
