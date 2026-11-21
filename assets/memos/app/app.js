/* Work memo app (docs-kit memos tab). No dependencies.
 * Storage: the preview server's API ../../_kit/api/memos (site/src/lib/memos.ts): GET list, POST create, PUT <id> update
 * (with the version it was read at: 409 when the file changed elsewhere), DELETE <id> (only from the trash),
 * POST empty-trash. Without the API (the built site) the app is read-only and shows data.json when published.
 * While a save is pending or failed, the text is kept in localStorage so nothing typed is lost. */
(function () {
  "use strict";
  var API = "../../_kit/api/memos";
  var $ = function (id) { return document.getElementById(id); };
  var S = {
    memos: [], works: [], dir: "docs/memos", writable: false, published: false,
    view: "all", query: "", from: "", to: "", sort: "updated",
    cur: null, checked: new Set(), dirty: false, saving: false, timer: null, preview: false, fresh: null
  };
  var DRAFT = "docs-kit-memo-draft:";

  // ------------------------------------------------------------ helpers
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function day(iso) { return (iso || "").slice(0, 10); }
  function today() { var d = new Date(), p = function (n) { return String(n).padStart(2, "0"); }; return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); }
  function daysAgo(n) { var d = new Date(); d.setDate(d.getDate() - n); var p = function (x) { return String(x).padStart(2, "0"); }; return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); }
  function shortTime(iso) {
    if (!iso) return "";
    var d = day(iso), t = iso.slice(11, 16);
    if (d === today()) return "오늘 " + t;
    if (d === daysAgo(1)) return "어제 " + t;
    return d.slice(0, 4) === today().slice(0, 4) ? d.slice(5).replace("-", ".") + " " + t : d;
  }
  function titleOf(m) { return m.title || (m.body.split("\n").find(function (l) { return l.trim(); }) || "").replace(/^#+\s*/, "").slice(0, 80) || "(제목 없음)"; }
  function snippet(m) {
    var lines = m.body.split("\n").map(function (l) { return l.replace(/^#+\s*|^[-*]\s+(\[[ xX]\]\s*)?|^>\s*/g, "").trim(); }).filter(Boolean);
    if (!m.title && lines.length) lines.shift();
    return lines.join(" · ").slice(0, 160);
  }
  function toast(msg) { var t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(function () { t.hidden = true; }, 2600); }
  function byId(id) { return S.memos.find(function (m) { return m.id === id; }); }
  function parseTags(text) {
    var tags = [];
    var rest = text.replace(/(^|\s)#([^\s#\d][^\s#]*)/g, function (all, sp, t) { tags.push(t); return sp; });
    return { tags: tags, text: rest.replace(/[ \t]+\n/g, "\n").trim() };
  }

  // ------------------------------------------------------------ API
  function api(method, path, body) {
    var o = { method: method, headers: {} };
    if (body !== undefined) { o.headers["Content-Type"] = "application/json"; o.body = JSON.stringify(body); }
    return fetch(API + (path || ""), o).then(function (r) {
      if (r.status === 204) return { status: 204 };
      return r.json().then(function (j) { return { status: r.status, data: j }; }, function () { return { status: r.status, data: null }; });
    });
  }

  function load(first) {
    return api("GET").then(function (r) {
      if (r.status !== 200) throw r;
      S.writable = true; S.dir = r.data.dir; S.works = r.data.works || [];
      merge(r.data.memos);
      setMode();
    }).catch(function (r) {
      if (!first) return;
      S.writable = false;
      var why = r && r.status === 403 ? "forbidden" : r && r.status === 404 && r.data && r.data.error ? "off" : "static";
      return fetch("data.json").then(function (x) { return x.ok ? x.json() : { published: false, memos: [] }; }).catch(function () { return { published: false, memos: [] }; })
        .then(function (d) { S.published = !!d.published; S.memos = (d.memos || []).map(function (m) { m.mtime = 0; return m; }); setMode(why); });
    }).then(render);
  }

  /** Take a fresh list from the server; the memo being edited keeps the typed text unless it is saved. */
  function merge(list) {
    var cur = S.cur && byId(S.cur);
    S.memos = list;
    if (cur && S.dirty) {
      var i = S.memos.findIndex(function (m) { return m.id === cur.id; });
      if (i >= 0) { var server = S.memos[i]; if (server.mtime !== cur.mtime) S.fresh = server; S.memos[i] = cur; }
    }
  }

  function setMode(why) {
    var mode = $("mode"), note = $("notice");
    var ro = !S.writable;
    document.body.classList.toggle("readonly", ro);
    ["new", "today", "quick"].forEach(function (id) { $(id).disabled = ro; });
    if (!ro) { mode.hidden = true; note.hidden = true; return; }
    mode.hidden = false; mode.textContent = "보기 전용";
    note.hidden = false;
    if (why === "forbidden") note.innerHTML = "메모는 이 컴퓨터에서만 씁니다. 주소를 <code>localhost</code>로 열어 주세요(다른 PC에서 IP로 연 미리보기는 읽기·쓰기를 막습니다).";
    else if (why === "off") note.innerHTML = "메모 탭이 꺼져 있습니다: <code>.docs-kit/bin/kit.py enable memos</code>";
    else note.innerHTML = (S.published ? "배포된 사이트의 메모 사본입니다(읽기만). " : "배포된 사이트에는 메모가 실리지 않습니다. ") +
      "메모를 쓰고 고치려면 이 PC에서 문서 미리보기를 켜고 엽니다: <code>.docs-kit/bin/docs.sh start</code> → <code>http://localhost:8000/…/memos/app/</code>";
  }

  // ------------------------------------------------------------ filters
  var VIEWS = [
    ["all", "▤", "모든 메모"], ["pinned", "📌", "고정"], ["today", "☀", "오늘"], ["week", "7", "최근 7일"],
    ["nowork", "?", "업무 미지정"], ["archive", "▣", "보관함"], ["trash", "🗑", "휴지통"]
  ];
  function inView(m, v) {
    if (v === "trash") return !!m.trashed;
    if (m.trashed) return false;
    if (v === "archive") return m.archived;
    if (v.indexOf("work:") === 0) return m.work === v.slice(5);
    if (v.indexOf("tag:") === 0) { var t = v.slice(4); return m.tags.some(function (x) { return x === t || x.indexOf(t + "/") === 0; }); }
    if (S.query && v === "all") return true;            // search also finds archived memos (Keep)
    if (m.archived) return false;
    if (v === "pinned") return m.pinned;
    if (v === "today") return day(m.updated) === today() || day(m.created) === today();
    if (v === "week") return day(m.updated) >= daysAgo(6);
    if (v === "nowork") return !m.work;
    return true;
  }
  function matches(m) {
    if (S.from && day(m.created) < S.from) return false;
    if (S.to && day(m.created) > S.to) return false;
    if (!S.query) return true;
    var words = S.query.toLowerCase().split(/\s+/).filter(Boolean);
    var hay = (titleOf(m) + "\n" + m.body + "\n" + m.work + "\n" + m.tags.map(function (t) { return "#" + t; }).join(" ") + "\n" + m.id).toLowerCase();
    return words.every(function (w) { return hay.indexOf(w) >= 0; });
  }
  function visible() {
    var list = S.memos.filter(function (m) { return inView(m, S.view) && matches(m); });
    var key = S.sort;
    list.sort(function (a, b) {
      if (S.view !== "trash" && a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (key === "title") return titleOf(a).localeCompare(titleOf(b), "ko");
      return (b[key] || "").localeCompare(a[key] || "");
    });
    return list;
  }

  // ------------------------------------------------------------ render
  function render() { renderSide(); renderList(); renderEditor(); }

  function sideBtn(key, ic, label, n) {
    return '<button type="button" data-view="' + esc(key) + '" class="' + (S.view === key ? "on" : "") + '"><span class="ic">' + esc(ic) + "</span>" +
      '<span class="lb">' + esc(label) + '</span><span class="n">' + (n || "") + "</span></button>";
  }
  function renderSide() {
    $("views").innerHTML = VIEWS.map(function (v) {
      var n = S.memos.filter(function (m) { return inView(m, v[0]) && !(v[0] === "all" && m.archived); }).length;
      return sideBtn(v[0], v[1], v[2], n);
    }).join("");
    var live = S.memos.filter(function (m) { return !m.trashed; });
    var works = {};
    live.forEach(function (m) { if (m.work) works[m.work] = (works[m.work] || 0) + 1; });
    var wk = Object.keys(works).sort(function (a, b) { return a.localeCompare(b, "ko"); });
    $("works").innerHTML = wk.length ? wk.map(function (w) { return sideBtn("work:" + w, "▸", w, works[w]); }).join("") : '<div class="empty-note">메모에 업무를 적으면 여기에 모입니다</div>';
    var tags = {};
    live.forEach(function (m) {
      m.tags.forEach(function (t) {
        var parts = t.split("/");
        for (var i = 1; i <= parts.length; i++) { var k = parts.slice(0, i).join("/"); tags[k] = (tags[k] || 0) + (i === parts.length ? 1 : 0); }
      });
    });
    var tk = Object.keys(tags).sort(function (a, b) { return a.localeCompare(b, "ko"); });
    $("tags").innerHTML = tk.length ? tk.map(function (t) {
      var depth = t.split("/").length - 1, leaf = t.split("/").pop();
      var total = live.filter(function (m) { return m.tags.some(function (x) { return x === t || x.indexOf(t + "/") === 0; }); }).length;
      return sideBtn("tag:" + t, "#", (depth ? "  ".repeat(depth) + "└ " : "") + leaf, total);
    }).join("") : '<div class="empty-note">#태그를 달면 여기에 모입니다</div>';
    $("tag-list").innerHTML = tk.map(function (t) { return '<option value="' + esc(t) + '">'; }).join("");
    $("work-list").innerHTML = S.works.concat(wk.filter(function (w) { return S.works.indexOf(w) < 0; })).map(function (w) { return '<option value="' + esc(w) + '">'; }).join("");
  }

  function viewLabel() {
    if (S.view.indexOf("work:") === 0) return "업무: " + S.view.slice(5);
    if (S.view.indexOf("tag:") === 0) return "#" + S.view.slice(4);
    var v = VIEWS.find(function (x) { return x[0] === S.view; });
    return v ? v[2] : "";
  }
  function renderList() {
    var list = visible();
    $("list-title").textContent = viewLabel() + (S.query ? " · 찾기" : "");
    $("list-n").textContent = list.length + "개";
    $("empty-trash").hidden = !(S.view === "trash" && list.length && S.writable);
    var ul = $("items");
    if (!list.length) {
      ul.innerHTML = '<li class="none">' + (S.memos.length ? "맞는 메모가 없습니다" : S.writable ? "첫 메모를 써 보세요. 위 빠른 메모 칸에 쓰고 Enter" : "메모가 없습니다") + "</li>";
    } else {
      ul.innerHTML = list.map(function (m) {
        var chips = (m.work ? '<span class="chip work">' + esc(m.work) + "</span>" : "") +
          m.tags.slice(0, 4).map(function (t) { return '<span class="chip">#' + esc(t) + "</span>"; }).join("") + (m.archived ? '<span class="chip">보관</span>' : "");
        return '<li class="item' + (m.id === S.cur ? " on" : "") + '" data-id="' + esc(m.id) + '">' +
          '<input type="checkbox" aria-label="고르기" ' + (S.checked.has(m.id) ? "checked" : "") + ">" +
          '<div><div class="t">' + (m.pinned ? '<span class="pin">●</span>' : "") + esc(titleOf(m)) + "</div>" +
          '<div class="p">' + esc(snippet(m) || "내용 없음") + "</div>" +
          '<div class="m"><span>' + esc(shortTime(S.sort === "created" ? m.created : m.updated)) + "</span>" + chips + "</div></div></li>";
      }).join("");
    }
    var n = S.checked.size;
    $("bulk").hidden = !n;
    $("bulk-n").textContent = n + "개 고름";
    var inTrash = S.view === "trash";
    document.querySelector('[data-bulk="restore"]').hidden = !inTrash;
    ["work", "tag", "archive", "trash"].forEach(function (k) { document.querySelector('[data-bulk="' + k + '"]').hidden = inTrash || !S.writable; });
  }

  function renderEditor() {
    var m = S.cur && byId(S.cur);
    $("empty").hidden = !!m; $("doc").hidden = !m;
    document.querySelector(".panes").classList.toggle("editing", !!m);
    if (!m) return;
    var ro = !S.writable;
    // a field being typed in keeps its text; with nothing unsaved the file's text wins (another window or an agent)
    var put = function (id, v) { var el = $(id); if (el.value !== v && (!S.dirty || document.activeElement !== el)) el.value = v; };
    put("title", m.title); put("work", m.work); put("body", m.body);
    ["title", "work", "body", "tag-in"].forEach(function (id) { $(id).readOnly = ro; });
    $("tag-chips").innerHTML = m.tags.map(function (t) { return '<span class="chip">#' + esc(t) + (ro ? "" : ' <button type="button" data-untag="' + esc(t) + '" aria-label="태그 빼기">×</button>') + "</span>"; }).join("");
    $("pin").style.opacity = m.pinned ? "1" : "0.45"; $("pin").title = m.pinned ? "고정 풀기" : "고정"; $("pin").setAttribute("aria-pressed", m.pinned);
    $("archive").textContent = m.archived ? "보관 풀기" : "보관";
    $("archive").hidden = $("trash").hidden = !!m.trashed || ro; $("pin").hidden = ro || !!m.trashed;
    $("restore").hidden = $("destroy").hidden = !m.trashed || ro;
    document.querySelector(".toolbar").hidden = ro;
    $("conflict").hidden = !S.fresh || S.fresh.id !== m.id;
    $("foot").innerHTML = "<span>쓴 날 " + esc(m.created.replace("T", " ").slice(0, 16)) + "</span><span>고친 날 " + esc(m.updated.replace("T", " ").slice(0, 16)) +
      "</span><span>" + m.body.length + "자</span><span>파일 " + esc(S.dir + "/" + m.id + ".md") + "</span>";
    if (S.preview || ro) showPreview(true); else showPreview(false);
  }

  // ------------------------------------------------------------ Markdown preview (a small subset; the file stays plain text)
  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  }
  function md(text) {
    var out = [], lines = text.split("\n"), i = 0, list = null;
    function close() { if (list) { out.push("</" + list + ">"); list = null; } }
    while (i < lines.length) {
      var l = lines[i];
      if (/^```/.test(l)) {
        close(); var code = []; i++;
        while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
        out.push("<pre><code>" + esc(code.join("\n")) + "</code></pre>"); i++; continue;
      }
      var h = /^(#{1,3})\s+(.*)$/.exec(l);
      if (h) { close(); out.push("<h" + h[1].length + ">" + inline(h[2]) + "</h" + h[1].length + ">"); i++; continue; }
      var t = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(l);
      if (t) {
        if (list !== "ul") { close(); out.push("<ul>"); list = "ul"; }
        out.push('<li class="task"><input type="checkbox" data-line="' + i + '"' + (t[1] !== " " ? " checked" : "") + (S.writable ? "" : " disabled") + ">" + inline(t[2]) + "</li>");
        i++; continue;
      }
      var u = /^\s*[-*]\s+(.*)$/.exec(l), o = /^\s*\d+[.)]\s+(.*)$/.exec(l);
      if (u || o) {
        var want = u ? "ul" : "ol";
        if (list !== want) { close(); out.push("<" + want + ">"); list = want; }
        out.push("<li>" + inline((u || o)[1]) + "</li>"); i++; continue;
      }
      if (/^>\s?/.test(l)) { close(); out.push("<blockquote>" + inline(l.replace(/^>\s?/, "")) + "</blockquote>"); i++; continue; }
      if (!l.trim()) { close(); i++; continue; }
      close();
      var para = [l]; i++;
      while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|```|\s*[-*]\s|\s*\d+[.)]\s|>)/.test(lines[i])) para.push(lines[i++]);
      out.push("<p>" + para.map(inline).join("<br>") + "</p>");
    }
    close();
    return out.join("\n");
  }
  function showPreview(on) {
    var m = S.cur && byId(S.cur);
    $("preview").hidden = !on; $("body").hidden = on;
    $("preview-btn").setAttribute("aria-pressed", on);
    if (on && m) $("preview").innerHTML = md(m.body) || '<p class="muted">내용 없음</p>';
  }

  // ------------------------------------------------------------ editing and saving
  function edit(fields) {
    var m = byId(S.cur);
    if (!m || !S.writable) return;
    Object.keys(fields).forEach(function (k) { m[k] = fields[k]; });
    S.dirty = true;
    try { localStorage.setItem(DRAFT + m.id, JSON.stringify({ title: m.title, body: m.body, work: m.work, tags: m.tags, base: m.mtime })); } catch (e) {}
    saveState("busy", "저장 대기");
    clearTimeout(S.timer);
    S.timer = setTimeout(save, 700);
    renderList();
  }

  function save(force) {
    var m = byId(S.cur);
    clearTimeout(S.timer);
    if (force === true) S.force = true;               // kept until a save goes through (a blur may start one first)
    if (!m || !S.dirty) return Promise.resolve();
    // while the person has not chosen how to settle a conflict, keep the text locally and do not retry
    if (S.fresh && S.fresh.id === m.id && !S.force) { saveState("err", "충돌: 아래에서 고르기"); return Promise.resolve(); }
    if (S.saving) { S.timer = setTimeout(save, 300); return Promise.resolve(); }
    S.saving = true; saveState("busy", "저장 중…");
    var body = { title: m.title, body: m.body, work: m.work, tags: m.tags, base: m.mtime };
    if (S.force) body.force = true;
    return api("PUT", "/" + encodeURIComponent(m.id), body).then(function (r) {
      S.saving = false;
      if (r.status === 200) {
        var still = byId(m.id);
        var changedSince = still && (still.title !== body.title || still.body !== body.body || still.work !== body.work || still.tags.join() !== body.tags.join());
        Object.assign(still || m, r.data, changedSince ? { title: still.title, body: still.body, work: still.work, tags: still.tags } : {});
        S.dirty = !!changedSince; if (S.dirty) S.timer = setTimeout(save, 300);
        else { try { localStorage.removeItem(DRAFT + m.id); } catch (e) {} }
        S.fresh = null; S.force = false;
        saveState("ok", "저장됨 " + new Date().toTimeString().slice(0, 5));
        renderList(); renderEditor();
      } else if (r.status === 409) {
        S.fresh = r.data; saveState("err", "충돌: 아래에서 고르기"); renderEditor();
      } else throw r;
    }).catch(function () {
      S.saving = false; saveState("err", "저장 못 함: 이 브라우저에 보관 중, 다시 시도합니다");
      S.timer = setTimeout(save, 5000);
    });
  }
  function saveState(cls, text) { var s = $("save"); s.className = "save small " + cls; s.textContent = text; }

  function setFlag(m, fields, msg) {
    if (!S.writable) return;
    var keep = S.dirty && m.id === S.cur ? save() : Promise.resolve();
    return keep.then(function () {
      return api("PUT", "/" + encodeURIComponent(m.id), Object.assign({ base: m.mtime }, fields));
    }).then(function (r) {
      if (r.status === 200) { Object.assign(m, r.data); if (msg) toast(msg); }
      else if (r.status === 409) { S.fresh = r.data; toast("다른 곳에서 바뀐 메모입니다. 다시 불러온 뒤 하세요"); }
      render();
    });
  }

  function create(fields, open) {
    if (!S.writable) return Promise.resolve();
    return save().then(function () { return api("POST", "", fields || {}); }).then(function (r) {
      if (r.status !== 201) { toast("메모를 만들지 못했습니다"); return; }
      S.memos.unshift(r.data);
      if (S.view === "trash" || S.view === "archive") S.view = "all";
      if (open) select(r.data.id, true);
      render();
      return r.data;
    });
  }

  function select(id, focusTitle) {
    if (S.cur === id) return;
    var prev = S.cur && byId(S.cur);
    var go = function () {
      // a memo left empty is not kept
      if (prev && !prev.title.trim() && !prev.body.trim() && !prev.trashed && prev.id !== id) discard(prev);
      S.cur = id; S.fresh = null; S.force = false; S.dirty = false;
      var m = byId(id);
      if (m) {
        try {
          var d = JSON.parse(localStorage.getItem(DRAFT + id) || "null");
          if (d && d.base === m.mtime && (d.body !== m.body || d.title !== m.title)) { Object.assign(m, { title: d.title, body: d.body, work: d.work, tags: d.tags }); S.dirty = true; save(); toast("저장 못 한 내용을 되살렸습니다"); }
        } catch (e) {}
      }
      saveState("", "");
      render();
      if (focusTitle) setTimeout(function () { $(m && !m.title && !m.body ? "title" : "body").focus(); }, 0);
    };
    if (S.dirty) save().then(go); else go();
  }
  function discard(m) {
    api("PUT", "/" + encodeURIComponent(m.id), { trashed: true, base: m.mtime }).then(function (r) {
      if (r.status === 200) api("DELETE", "/" + encodeURIComponent(m.id));
    });
    S.memos = S.memos.filter(function (x) { return x.id !== m.id; });
  }

  // ------------------------------------------------------------ dialog (no browser prompt / confirm)
  function dialog(title, html, okLabel, onOk) {
    $("dlg-title").textContent = title; $("dlg-body").innerHTML = html;
    $("dlg-ok").textContent = okLabel; $("dlg-ok").hidden = !okLabel;
    $("dialog").hidden = false;
    var first = $("dlg-body").querySelector("input, textarea"); if (first) setTimeout(function () { first.focus(); }, 0);
    $("dlg-ok").onclick = function () { if (onOk() !== false) $("dialog").hidden = true; };
  }
  $("dlg-cancel").onclick = function () { $("dialog").hidden = true; };
  $("dialog").addEventListener("click", function (e) { if (e.target === $("dialog")) $("dialog").hidden = true; });

  function handoff(ids) {
    var list = ids.map(byId).filter(Boolean).sort(function (a, b) { return a.created.localeCompare(b.created); });
    var idText = list.map(function (m) { return m.id; }).join(" ");
    var lines = list.map(function (m) { return "- " + m.id + " " + titleOf(m) + (m.work ? " [" + m.work + "]" : ""); }).join("\n");
    function text(kind) {
      if (kind === "weekly") return "아래 메모만 참고해서 주간 보고를 써 줘 (docs-kit 메모 탭, 그 주의 커밋·이슈가 아니라 메모 내용 기준).\n" + lines +
        "\n재료: .docs-kit/bin/weekly_draft.py --memos " + idText;
      return "아래 메모를 참고해서 문서를 써 줘 (docs-kit 메모 탭). 메모는 재료이고, 사실은 근거 문서로 확인해 줘.\n" + lines +
        "\n메모 읽기: .docs-kit/bin/memos.py show " + idText;
    }
    dialog("에이전트에게 넘기기",
      '<p class="muted small">고른 메모 ' + list.length + "개를 에이전트에게 넘길 요청 글입니다. 복사해서 대화에 붙여 넣습니다.</p>" +
      '<label><input type="radio" name="hk" value="weekly" checked> 주간 보고</label><label><input type="radio" name="hk" value="doc"> 다른 문서</label>' +
      '<textarea id="hand-text" readonly></textarea>', "복사", function () {
        var ta = $("hand-text"); ta.select();
        (navigator.clipboard ? navigator.clipboard.writeText(ta.value) : Promise.reject()).then(function () { toast("복사했습니다. 에이전트 대화에 붙여 넣으세요"); },
          function () { try { document.execCommand("copy"); toast("복사했습니다"); } catch (e) { toast("글을 직접 복사해 주세요"); } });
      });
    var upd = function () { $("hand-text").value = text(document.querySelector('input[name="hk"]:checked').value); };
    document.querySelectorAll('input[name="hk"]').forEach(function (r) { r.onchange = upd; });
    upd();
  }

  // ------------------------------------------------------------ events
  $("views").parentElement.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-view]"); if (!b) return;
    S.view = b.getAttribute("data-view"); S.checked.clear();
    document.querySelector(".panes").classList.remove("side-open");
    renderSide(); renderList();
  });
  $("items").addEventListener("click", function (e) {
    var li = e.target.closest(".item"); if (!li) return;
    var id = li.getAttribute("data-id");
    if (e.target.matches('input[type="checkbox"]')) { if (e.target.checked) S.checked.add(id); else S.checked.delete(id); renderList(); return; }
    if (e.shiftKey || e.metaKey || e.ctrlKey) { if (S.checked.has(id)) S.checked.delete(id); else S.checked.add(id); renderList(); return; }
    select(id);
  });
  $("q").addEventListener("input", function () { S.query = this.value.trim(); renderList(); });
  $("from").addEventListener("change", function () { S.from = this.value; renderList(); });
  $("to").addEventListener("change", function () { S.to = this.value; renderList(); });
  $("sort").addEventListener("change", function () { S.sort = this.value; renderList(); });
  $("quick").addEventListener("input", function () { this.style.height = "auto"; this.style.height = this.scrollHeight + "px"; });
  $("quick").addEventListener("keydown", function (e) {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    var p = parseTags(this.value); if (!p.text && !p.tags.length) return;
    var work = S.view.indexOf("work:") === 0 ? S.view.slice(5) : "";
    var tags = p.tags.concat(S.view.indexOf("tag:") === 0 ? [S.view.slice(4)] : []);
    var box = this;
    create({ body: p.text, tags: tags, work: work }, false).then(function (m) { if (m) { box.value = ""; box.style.height = ""; toast("메모를 남겼습니다"); } });
  });
  $("new").onclick = function () {
    var work = S.view.indexOf("work:") === 0 ? S.view.slice(5) : "", tags = S.view.indexOf("tag:") === 0 ? [S.view.slice(4)] : [];
    create({ work: work, tags: tags }, true);
  };
  $("today").onclick = function () {
    var title = today() + " 업무 일지";
    var m = S.memos.find(function (x) { return x.title === title && !x.trashed; });
    if (m) { S.view = "all"; select(m.id, true); render(); }
    else create({ title: title, tags: ["일지"], body: "## 한 일\n\n- \n\n## 결과\n\n- \n\n## 다음\n\n- \n" }, true);
  };
  $("title").addEventListener("input", function () { edit({ title: this.value }); });
  $("work").addEventListener("input", function () { edit({ work: this.value }); });
  $("body").addEventListener("input", function () { edit({ body: this.value }); });
  $("body").addEventListener("blur", function () { if (S.dirty) save(); });
  $("tag-in").addEventListener("keydown", function (e) {
    if ((e.key !== "Enter" && e.key !== ",") || e.isComposing) return;
    e.preventDefault();
    var m = byId(S.cur), t = this.value.trim().replace(/^#/, "");
    if (m && t && m.tags.indexOf(t) < 0) edit({ tags: m.tags.concat([t]) });
    this.value = ""; renderEditor(); renderSide();
  });
  $("tag-chips").addEventListener("click", function (e) {
    var b = e.target.closest("[data-untag]"); if (!b) return;
    var m = byId(S.cur), t = b.getAttribute("data-untag");
    edit({ tags: m.tags.filter(function (x) { return x !== t; }) }); renderEditor(); renderSide();
  });
  $("pin").onclick = function () { var m = byId(S.cur); setFlag(m, { pinned: !m.pinned }, m.pinned ? "고정을 풀었습니다" : "맨 위에 고정했습니다"); };
  $("archive").onclick = function () { var m = byId(S.cur); setFlag(m, { archived: !m.archived }, m.archived ? "보관을 풀었습니다" : "보관함으로 옮겼습니다 (찾기에는 나옵니다)"); };
  $("trash").onclick = function () { var m = byId(S.cur); setFlag(m, { trashed: true }, "휴지통으로 옮겼습니다").then(function () { S.cur = null; render(); }); };
  $("restore").onclick = function () { var m = byId(S.cur); setFlag(m, { trashed: false }, "되살렸습니다"); };
  $("destroy").onclick = function () {
    var m = byId(S.cur);
    dialog("완전히 지우기", "<p>“" + esc(titleOf(m)) + "” 메모 파일을 지웁니다. 되돌릴 수 없습니다(git에 커밋했다면 기록에는 남습니다).</p>", "지우기", function () {
      api("DELETE", "/" + encodeURIComponent(m.id)).then(function (r) {
        if (r.status === 204) { S.memos = S.memos.filter(function (x) { return x.id !== m.id; }); S.cur = null; toast("지웠습니다"); render(); }
        else toast("지우지 못했습니다");
      });
    });
  };
  $("empty-trash").onclick = function () {
    var n = S.memos.filter(function (m) { return m.trashed; }).length;
    dialog("휴지통 비우기", "<p>휴지통의 메모 " + n + "개 파일을 지웁니다. 되돌릴 수 없습니다.</p>", "비우기", function () {
      api("POST", "/empty-trash", {}).then(function (r) { if (r.status === 200) { toast(r.data.deleted + "개를 지웠습니다"); S.cur = null; load(); } });
    });
  };
  $("take-theirs").onclick = function () {
    var f = S.fresh; if (!f) return;
    var i = S.memos.findIndex(function (m) { return m.id === f.id; }); S.memos[i] = f;
    S.fresh = null; S.force = false; S.dirty = false; clearTimeout(S.timer); try { localStorage.removeItem(DRAFT + f.id); } catch (e) {}
    $("body").value = f.body; saveState("ok", "바뀐 내용을 불러왔습니다"); render();
  };
  $("take-mine").onclick = function () { S.dirty = true; save(true); };
  $("preview-btn").onclick = function () { S.preview = !S.preview; showPreview(S.preview); };
  $("preview").addEventListener("change", function (e) {
    var cb = e.target.closest("input[data-line]"); if (!cb) return;
    var m = byId(S.cur), lines = m.body.split("\n"), n = +cb.getAttribute("data-line");
    lines[n] = lines[n].replace(/\[([ xX])\]/, cb.checked ? "[x]" : "[ ]");
    edit({ body: lines.join("\n") }); $("body").value = m.body;
  });
  $("back").onclick = function () { if (S.dirty) save(); S.cur = null; render(); };
  $("menu").onclick = function () { document.querySelector(".panes").classList.toggle("side-open"); };
  $("theme").onclick = function () {
    var r = document.documentElement, t = r.getAttribute("data-theme") === "dark" ? "light" : "dark";
    r.setAttribute("data-theme", t); try { localStorage.setItem("docs-kit-memo-theme", t); } catch (e) {}
  };
  if (document.documentElement.classList.contains("embed")) $("full").hidden = false;

  // toolbar: wrap the selection or start a line
  document.querySelector(".toolbar").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-md]"); if (!b) return;
    var ta = $("body"), k = b.getAttribute("data-md"), s = ta.selectionStart, en = ta.selectionEnd, v = ta.value, sel = v.slice(s, en);
    var ls = v.lastIndexOf("\n", s - 1) + 1, ins, a = s, z = en;
    if (k === "b") ins = "**" + (sel || "굵게") + "**";
    else if (k === "code") ins = "`" + (sel || "코드") + "`";
    else if (k === "link") ins = "[" + (sel || "글") + "](https://)";
    else { var pre = { h: "## ", ul: "- ", task: "- [ ] " }[k]; a = z = ls; ins = pre; }
    ta.setRangeText(ins, a, z, "end"); ta.focus();
    edit({ body: ta.value });
  });
  $("body").addEventListener("keydown", function (e) {
    // Enter in a list continues it; an empty item ends it
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    var ta = this, s = ta.selectionStart, v = ta.value, ls = v.lastIndexOf("\n", s - 1) + 1, line = v.slice(ls, s);
    var m = /^(\s*)([-*]\s+\[[ xX]\]\s+|[-*]\s+|(\d+)[.)]\s+)(.*)$/.exec(line); if (!m) return;
    e.preventDefault();
    if (!m[4].trim()) { ta.setRangeText("", ls, s, "end"); }
    else {
      var next = m[3] ? (+m[3] + 1) + m[2].slice(m[3].length) : m[2].replace(/\[[xX]\]/, "[ ]");
      ta.setRangeText("\n" + m[1] + next, s, s, "end");
    }
    edit({ body: ta.value });
  });

  // bulk actions
  $("bulk").addEventListener("click", function (e) {
    var b = e.target.closest("[data-bulk]"); if (!b) return;
    var k = b.getAttribute("data-bulk"), ids = Array.from(S.checked), list = ids.map(byId).filter(Boolean);
    if (k === "all") { visible().forEach(function (m) { S.checked.add(m.id); }); return renderList(); }
    if (k === "none") { S.checked.clear(); return renderList(); }
    if (k === "handoff") return handoff(ids);
    var run = function (fields, msg) {
      Promise.all(list.map(function (m) { return api("PUT", "/" + encodeURIComponent(m.id), Object.assign({ base: m.mtime }, typeof fields === "function" ? fields(m) : fields)); }))
        .then(function (rs) {
          var bad = rs.filter(function (r) { return r.status !== 200; }).length;
          rs.forEach(function (r) { if (r.status === 200) { var m = byId(r.data.id); if (m) Object.assign(m, r.data); } });
          S.checked.clear(); toast(msg + (bad ? " (" + bad + "개는 다른 곳에서 바뀌어 건너뜀)" : "")); render();
        });
    };
    if (k === "archive") run({ archived: true }, list.length + "개를 보관했습니다");
    if (k === "trash") run({ trashed: true }, list.length + "개를 휴지통으로 옮겼습니다");
    if (k === "restore") run({ trashed: false }, list.length + "개를 되살렸습니다");
    if (k === "work") dialog("업무 지정", '<input type="text" id="bulk-work" list="work-list" placeholder="업무 이름 (비우면 업무 지움)">', "지정", function () {
      var w = $("bulk-work").value.trim(); run({ work: w }, list.length + "개의 업무를 " + (w ? "‘" + w + "’로" : "지웠습니다"));
    });
    if (k === "tag") dialog("태그 더하기", '<input type="text" id="bulk-tag" list="tag-list" placeholder="태그 (쉼표로 여러 개)">', "더하기", function () {
      var add = $("bulk-tag").value.split(",").map(function (t) { return t.trim().replace(/^#/, ""); }).filter(Boolean);
      if (!add.length) return false;
      run(function (m) { return { tags: m.tags.concat(add.filter(function (t) { return m.tags.indexOf(t) < 0; })) }; }, list.length + "개에 태그를 더했습니다");
    });
  });

  // keys
  document.addEventListener("keydown", function (e) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && S.cur) { e.preventDefault(); S.preview = !S.preview; showPreview(S.preview); return; }
    if (e.key === "Escape") { if (!$("dialog").hidden) { $("dialog").hidden = true; return; } if (typing) { document.activeElement.blur(); return; } if (S.cur) { S.cur = null; render(); } return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "/") { e.preventDefault(); $("q").focus(); }
    else if (e.key === "n" || e.key === "N") { e.preventDefault(); $("new").click(); }
  });

  // other windows, agents and editors change files too: refresh when the window comes back and every 20 s
  function refresh() { if (S.writable && !S.saving && document.visibilityState === "visible") load().then(renderEditor); }
  window.addEventListener("focus", refresh);
  setInterval(refresh, 20000);
  window.addEventListener("beforeunload", function (e) { if (S.dirty) { save(); e.preventDefault(); e.returnValue = ""; } });

  var m = /[#&]memo=([\w-]+)/.exec(location.hash);
  load(true).then(function () { if (m && byId(m[1])) select(m[1]); });
  window.addEventListener("hashchange", function () { var h = /[#&]memo=([\w-]+)/.exec(location.hash); if (h && byId(h[1])) select(h[1]); });
})();
