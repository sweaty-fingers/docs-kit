"""MkDocs hook: grounding page (근거 점검) - how well the documents' checkable claims are backed by their sources, the
retrieval quality of the document search agents use, the trend, the list of fixes, and the log of hallucination
incidents.

Runs bin/docs_check.py on every build (the repository is mounted with the docs, so the result is always current;
about 5 s, cached in build/quality/ until a document, the code or the settings change). Data the project keeps:
  docs/quality/config.json     rules: external / planned paths, ignore lists (bin/docs_check.py DEFAULT_CFG)
  docs/quality/questions.json  retrieval evaluation: question -> documents that answer it
  docs/quality/history.json    the summary per day, appended by `bin/docs_check.py --record` (trend)
  docs/quality/incidents.json  hallucination incidents: what was claimed, what is true, how it was caught, the fix
Markers: <!-- quality-summary --> <!-- quality-trend --> <!-- quality-tasks --> <!-- quality-docs -->
<!-- quality-kinds --> <!-- quality-retrieval --> <!-- quality-incidents -->. The page quality/README.md is a kit page,
added to the nav after 문서 지도.
"""
from __future__ import annotations

import html
import json
import re
import logging
import os
import posixpath
import sys
from collections import defaultdict

log = logging.getLogger("mkdocs.hooks.quality")
KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(KIT, "bin"))
DIR = "quality"
_q = {}

KIND = {
    "doc-id": ("문서 번호", "ADR·VR·EXP·P 번호가 있는 문서인지", "번호를 고치거나 빠진 문서를 씀"),
    "issue": ("이슈 번호", "#N이 이슈 스냅숏에 있는지", "번호를 고치거나 이슈 스냅숏(docs/plan/issues.json)을 새로 받음"),
    "path": ("경로", "코드 칸의 저장소 경로가 있는지 (외부·계획 경로는 설정으로 구분)", "옮겨진 경로로 고치거나, 아직 없는 경로면 (예정)으로 적고 config.json `path_planned`"),
    "port": ("포트", "본문의 포트가 포트 표(참고 문서)에 있는지", "포트 표에 넣거나 번호를 고침"),
    "option": ("명령·옵션", "`tools/x.sh 하위명령 --옵션`이 그 스크립트에 있는지", "실제 명령으로 고치거나 스크립트에 추가"),
    "ident": ("식별자", "코드 칸의 이름(snake_case, CamelCase, f())이 코드·설정·장비 출력에 있는지", "이름을 확인해 고치거나, 설계상 이름이면 (예정)·(제안) 표시"),
    "vr-number": ("VR 수치", "VR 본문의 소수 수치가 그 VR의 원 출력(또는 설정)에 있는지", "원 출력에서 옮겨 적음. 바로잡을 때는 새 VR (VR은 고치지 않음)"),
    "number": ("수치 근거", "보고·가이드·아키텍처의 소수 수치가 VR·EXP·ADR에 있는지", "근거 VR·EXP를 링크하거나, 외부 출처면 출처를 적음"),
    "superseded": ("대체된 기록 인용", "살아 있는 문서가 대체된 VR·ADR만 인용하는지", "새 기록으로 바꾸거나 함께 링크"),
    "stale": ("코드보다 오래된 문서", "가리키는 코드가 문서보다 14일 넘게 나중에 바뀌었는지 (git)", "문서를 다시 읽고 맞추거나 reviewed 날짜 갱신"),
}
VERDICT = {"false": "틀림", "unverified": "확인 못 함", "stale": "낡음"}


def _stamp(root):
    out = []
    for base in ("docs", "packages", "tools", ".docs-kit/bin", "AGENTS.md", "README.md"):
        p = os.path.join(root, base)
        if os.path.isfile(p):
            out.append(os.path.getmtime(p))
            continue
        for dp, dn, fn in os.walk(p):
            dn[:] = [d for d in dn if d not in ("__pycache__", ".git")]
            for f in fn:
                out.append(os.path.getmtime(os.path.join(dp, f)))
    return [len(out), max(out) if out else 0]


def _load(docs_dir):
    _q.clear()
    _q["docs_dir"] = docs_dir
    root = os.path.dirname(os.path.abspath(docs_dir))
    if not os.path.isdir(os.path.join(docs_dir, DIR)):
        return
    try:
        import importlib.util
        bindir = os.path.join(KIT, "bin")
        if bindir not in sys.path:
            sys.path.insert(0, bindir)
        for name in ("docs_search", "docs_check"):    # fresh every build: `mkdocs serve` lives for hours
            sys.modules.pop(name, None)
        spec = importlib.util.spec_from_file_location("docs_check", os.path.join(bindir, "docs_check.py"))
        docs_check = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(docs_check)
    except Exception as e:  # noqa: BLE001 - show any load error as a build warning
        log.warning("quality: cannot load bin/docs_check.py (%s): %s", os.path.join(KIT, "bin"), e)
        return
    cache = os.path.join(root, "build", "quality", "report.json")
    stamp = _stamp(root)
    rep = None
    if os.path.exists(cache):
        try:
            c = json.load(open(cache, encoding="utf-8"))
            if c.get("stamp") == stamp:
                rep = c["report"]
        except (ValueError, OSError, KeyError):
            rep = None
    if rep is None:
        rep = docs_check.run(root)
        try:
            os.makedirs(os.path.dirname(cache), exist_ok=True)
            json.dump({"stamp": stamp, "report": rep}, open(cache, "w", encoding="utf-8"), ensure_ascii=False)
        except OSError:
            pass
    def j(name, default):
        p = os.path.join(docs_dir, DIR, name)
        try:
            return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else default
        except ValueError as e:
            log.warning("quality: %s: %s", name, e)
            return default
    rec = j("retrieval.json", None)
    live = rep.get("retrieval") or {}
    if rec and "hybrid" in (rec.get("modes") or {}) and "hybrid" not in (live.get("modes") or {}):
        rep = dict(rep, retrieval=dict(rec, recorded=rec.get("taken", "")))   # measured on the host (the build cannot reach the server)
    _q.update(rep=rep, history=j("history.json", {"runs": []}).get("runs", []),
              incidents=j("incidents.json", {"incidents": []}).get("incidents", []))


def _hint(key, default):
    """How to start a local model server (docs/quality/config.json "embed_start" / "llm_start"), for notes."""
    try:
        c = json.load(open(os.path.join(_q.get("docs_dir", "docs"), DIR, "config.json"), encoding="utf-8"))
        return str(c.get(key) or default)
    except (OSError, ValueError):
        return default


def _rel(here, target):
    return posixpath.relpath(target, posixpath.dirname(here) or ".")


def _doc_link(here, path, line=0, text=None):
    t = html.escape(text or path)
    if path.startswith("docs/"):
        page = path[5:]
        if page.endswith(".md"):                       # README.md is the folder's index.html on the site
            page = (page[:-len("README.md")] + "index.html") if page.endswith("README.md") else page[:-3] + ".html"
        href = _rel(here, page)
        return f'<a href="{href}" title="{html.escape(path)}{f":{line}" if line else ""}">{t}</a>'
    return f'<code>{t}</code>'


def _pct(x):
    return f"{100 * x:.1f}%"


def _summary(here):
    r = _q["rep"]
    s, rt = r["summary"], r.get("retrieval") or {}
    inc = _q["incidents"]
    cards = [
        ("검증 가능한 주장", f"{s['checkable']}", f"문서 {len(r['docs'])}개에서 뽑음, 기준 {r['taken'].replace('T', ' ')}", "#종류별-점검"),
        ("근거 있음", _pct(s["grounded_rate"]), f"{s['ok']}개가 원천에서 확인됨", "#문서별"),
        ("틀림", f"{s['false']}", f"{_pct(s['false_rate'])}: 가리킨 것이 없음 (할루시네이션 의심)", "#보완할-작업"),
        ("확인 못 함", f"{s['unverified']}", f"{_pct(s['unverified_rate'])}: 있어야 할 곳에서 못 찾음", "#보완할-작업"),
        ("낡음", f"{s['stale']}", "대체된 기록 인용, 코드보다 오래된 문서", "#보완할-작업"),
        ("검색 품질", f"{rt.get('recall5', 0):.2f}" if rt else "-", f"recall@5 ({rt.get('n', 0)}문항), hit@1 {rt.get('hit1', 0):.2f}, MRR {rt.get('mrr', 0):.2f}" if rt else "questions.json 없음", "#검색-평가"),
        ("할루시네이션 사례", f"{len(inc)}", "에이전트가 틀리게 말한 기록", "#사례-기록"),
    ]
    out = ['<div class="pl-cards">']
    for t, v, sub, href in cards:
        out.append(f'<a class="pl-card pl-card-link" href="{href}"><div class="pl-card-t">{t}</div><div class="pl-card-v">{html.escape(v)}</div>'
                   f'<div class="pl-card-s">{html.escape(sub)}</div></a>')
    out.append("</div>")
    lay = r["layers"]
    rows = ["<table class='pl-table'><thead><tr><th>층</th><th>문서</th><th>주장</th><th>근거 있음</th><th>틀림</th><th>확인 못 함</th><th>낡음</th></tr></thead><tbody>"]
    for name in ("정본", "운영", "발행물", "지식"):
        L = lay.get(name)
        if not L:
            continue
        n = L["ok"] + L["false"] + L["unverified"]
        rows.append(f"<tr><td>{name}</td><td>{L['docs']}</td><td>{n}</td><td>{_pct(L['ok'] / n) if n else '-'}</td>"
                    f"<td>{L['false']}</td><td>{L['unverified']}</td><td>{L['stale']}</td></tr>")
    rows.append("</tbody></table>")
    git = "" if r.get("git") else '<p class="pl-note">이 빌드에는 git이 없어 "코드보다 오래된 문서" 점검을 건너뛰었습니다. <code>python3 .docs-kit/bin/docs_check.py</code>로 확인합니다.</p>'
    return "\n".join(out) + "".join(rows) + git


def _trend(here):
    runs = _q["history"]
    if not runs:
        return ('<p class="pl-note">기록이 아직 없습니다. 주간 보고 때 <code>python3 .docs-kit/bin/docs_check.py --record</code>로 '
                '그날 값을 <code>docs/quality/history.json</code>에 남기면 여기에 추이가 그려집니다.</p>')
    W, H, L, B, T = 640, 180, 40, 26, 12
    n = len(runs)
    xs = lambda i: L + (W - L - 12) * (i / max(1, n - 1)) if n > 1 else (W + L) / 2  # noqa: E731
    vmax = max([0.05] + [max(r.get("false_rate", 0), r.get("unverified_rate", 0)) for r in runs]) * 1.2
    y = lambda v: T + (H - T - B) * (1 - v / vmax)  # noqa: E731
    o = [f'<svg class="pl-svg" viewBox="0 0 {W} {H}" role="img" aria-label="틀림·확인 못 함 비율 추이">']
    for k in range(4):
        v = vmax * k / 3
        o.append(f'<line class="pl-grid" x1="{L}" x2="{W - 12}" y1="{y(v):.1f}" y2="{y(v):.1f}"/>'
                 f'<text class="pl-ax" x="{L - 6}" y="{y(v) + 4:.1f}" text-anchor="end">{100 * v:.0f}%</text>')
    for key, cls in (("unverified_rate", "q-unv"), ("false_rate", "q-false")):
        pts = " ".join(f"{xs(i):.1f},{y(r.get(key, 0)):.1f}" for i, r in enumerate(runs))
        o.append(f'<polyline class="q-line {cls}" points="{pts}"/>')
        for i, r in enumerate(runs):
            tip = f'{r["date"]} {r.get("commit", "")}: 틀림 {r.get("false", 0)} ({_pct(r.get("false_rate", 0))}), 확인 못 함 {r.get("unverified", 0)} ({_pct(r.get("unverified_rate", 0))}), recall@5 {r.get("recall5", "-")}'
            o.append(f'<circle class="q-dot {cls}" cx="{xs(i):.1f}" cy="{y(r.get(key, 0)):.1f}" r="3.5" data-tip="{html.escape(tip)}"/>')
    for i, r in enumerate(runs):
        o.append(f'<text class="pl-ax" x="{xs(i):.1f}" y="{H - 8}" text-anchor="middle">{r["date"][5:]}</text>')
    o.append("</svg>")
    legend = ('<div class="pl-legend"><span class="pl-lg q-lg-false">틀림 비율</span><span class="pl-lg q-lg-unv">확인 못 함 비율</span>'
              '<span>점에 마우스를 올리면 그날 숫자</span></div>')
    rows = ["<table class='pl-table'><thead><tr><th>날짜</th><th>커밋</th><th>주장</th><th>틀림</th><th>확인 못 함</th><th>낡음</th><th>hit@1</th><th>recall@5</th></tr></thead><tbody>"]
    for r in reversed(runs):
        rows.append(f"<tr><td>{r['date']}</td><td><code>{html.escape(r.get('commit', ''))}</code></td><td>{r.get('checkable', '')}</td>"
                    f"<td>{r.get('false', '')}</td><td>{r.get('unverified', '')}</td><td>{r.get('stale', '')}</td>"
                    f"<td>{r.get('hit1', '')}</td><td>{r.get('recall5', '')}</td></tr>")
    rows.append("</tbody></table>")
    return f'<div class="pl-chart">{"".join(o)}</div>{legend}' + "".join(rows)


def _tasks(here):
    r = _q["rep"]
    docs = r["docs"]
    groups = defaultdict(list)
    for f in r["findings"]:
        mutable = docs.get(f["path"], {}).get("mutable", True)
        if f["verdict"] == "false":
            key = "1" if mutable else "4"
        elif f["verdict"] == "stale":
            key = "2" if mutable else "4"
        else:
            key = "3" if mutable else "4"
        groups[key].append(f)
    title = {"1": ("고칠 것: 틀린 주장 (살아 있는 문서)", "가리킨 것이 저장소·이슈·포트 표에 없습니다. 먼저 고칩니다."),
             "2": ("맞출 것: 낡은 근거", "대체된 기록을 인용하거나, 가리키는 코드가 문서보다 나중에 바뀌었습니다."),
             "3": ("확인할 것: 근거를 못 찾은 주장", "틀렸다는 뜻은 아닙니다. 근거를 링크하거나 (예정)·(외부 출처)를 표시하면 사라집니다."),
             "4": ("기록 문서 (고치지 않음)", "ADR·VR·주간 보고·작업 내역은 쓴 뒤 고치지 않습니다. 당시 사실이면 그대로 두고, 바로잡을 것이면 새 문서(새 VR, 새 ADR)로.")}
    out = []
    for key in ("1", "2", "3", "4"):
        fs = groups.get(key, [])
        t, sub = title[key]
        by_doc = defaultdict(list)
        for f in fs:
            by_doc[f["path"]].append(f)
        open_ = " open" if key in ("1", "2") else ""
        out.append(f'<details class="q-group q-g{key}"{open_}><summary><b>{t}</b> <span class="pl-cnt">{len(fs)}건 · 문서 {len(by_doc)}개</span></summary>'
                   f'<p class="pl-note">{sub}</p>')
        if not fs:
            out.append('<p class="pl-note">없음</p></details>')
            continue
        out.append("<table class='pl-table q-tasks'><thead><tr><th>문서</th><th>줄</th><th>종류</th><th>주장</th><th>판정</th><th>할 일</th></tr></thead><tbody>")
        for path in sorted(by_doc, key=lambda p: (-len(by_doc[p]), p)):
            for f in sorted(by_doc[path], key=lambda f: f["line"]):
                kname, _, fix = KIND.get(f["kind"], (f["kind"], "", ""))
                out.append(f'<tr><td>{_doc_link(here, path, f["line"], docs.get(path, {}).get("id") or path.replace("docs/", ""))}</td>'
                           f'<td>{f["line"] or ""}</td><td>{kname}</td><td><code>{html.escape(f["text"])}</code></td>'
                           f'<td><span class="q-v q-v-{f["verdict"]}">{VERDICT[f["verdict"]]}</span> {html.escape(f["detail"])}</td>'
                           f'<td class="pl-sub">{html.escape(fix)}</td></tr>')
        out.append("</tbody></table></details>")
    return "".join(out)


def _docs(here):
    r = _q["rep"]
    rows = ["<table class='pl-table pl-sort'><thead><tr><th data-sort>문서</th><th data-sort>층</th><th data-sort>주장</th>"
            "<th data-sort>근거율</th><th data-sort>틀림</th><th data-sort>확인 못 함</th><th data-sort>낡음</th></tr></thead><tbody>"]
    items = sorted(r["docs"].items(), key=lambda kv: (-(kv[1]["false"] * 10 + kv[1]["stale"] * 3 + kv[1]["unverified"]), kv[0]))
    for p, d in items:
        n = d["ok"] + d["false"] + d["unverified"]
        if not n and not d["stale"]:
            continue
        rate = d["ok"] / n if n else 1.0
        rows.append(f'<tr><td>{_doc_link(here, p, 0, (d["id"] + " " if d["id"] else "") + p.replace("docs/", ""))}</td><td>{d["layer"]}</td>'
                    f'<td data-v="{n}">{n}</td><td data-v="{rate:.4f}">{_pct(rate)}</td><td data-v="{d["false"]}">{d["false"] or ""}</td>'
                    f'<td data-v="{d["unverified"]}">{d["unverified"] or ""}</td><td data-v="{d["stale"]}">{d["stale"] or ""}</td></tr>')
    rows.append("</tbody></table>")
    return '<p class="pl-note">문제가 많은 문서가 위에 옵니다(틀림 × 10 + 낡음 × 3 + 확인 못 함). 열 이름을 누르면 정렬합니다.</p>' + "".join(rows)


def _kinds(here):
    r = _q["rep"]
    ok = defaultdict(int)
    rows = ["<table class='pl-table'><thead><tr><th>종류</th><th>무엇을 확인하나</th><th>틀림</th><th>확인 못 함</th><th>낡음</th><th>고치는 법</th></tr></thead><tbody>"]
    for k, (name, what, fix) in KIND.items():
        c = r["kinds"].get(k, {})
        rows.append(f"<tr><td><b>{name}</b> <code>{k}</code></td><td>{html.escape(what)}</td><td>{c.get('false', 0) or ''}</td>"
                    f"<td>{c.get('unverified', 0) or ''}</td><td>{c.get('stale', 0) or ''}</td><td class='pl-sub'>{html.escape(fix)}</td></tr>")
    rows.append("</tbody></table>")
    return "".join(rows)


def _retrieval(here):
    rt = _q["rep"].get("retrieval")
    if not rt:
        return '<p class="pl-note"><code>docs/quality/questions.json</code>이 없어 검색 평가를 하지 않았습니다.</p>'
    src = f' (호스트에서 잰 기록 {html.escape(rt["recorded"].replace("T", " "))}, <code>docs_check.py --record</code>)' if rt.get("recorded") else ""
    rows = [f'<p class="pl-note">{rt["n"]}문항, 검색 방식 <b>{rt.get("mode", "bm25")}</b>{src}: hit@1 {rt["hit1"]:.2f} (정답 문서가 1위), recall@5 {rt["recall5"]:.2f} (5위 안), '
            f'MRR {rt["mrr"]:.2f} (정답 순위의 역수 평균). 에이전트가 문서를 못 찾았거나 틀린 문서를 인용했던 질문을 여기 더해 갑니다.</p>']
    modes = rt.get("modes") or {}
    if modes:
        KN = {"exact": "문서 단어로 물음", "paraphrase": "다른 말로 물음"}
        rows.append("<table class='pl-table'><thead><tr><th>검색 방식</th><th>모델</th><th>질문</th><th>hit@1</th><th>recall@5</th><th>MRR</th></tr></thead><tbody>")
        for m, r in modes.items():
            name = {"bm25": "BM25 (단어)", "hybrid": "하이브리드 (BM25 + 임베딩, RRF)"}.get(m, m)
            model = html.escape(str(r.get("model", "")).split("/")[-1]) or "—"
            rows.append(f"<tr><td><b>{name}</b></td><td>{model}</td><td>전체 {r['n']}</td><td>{r['hit1']:.2f}</td><td>{r['recall5']:.2f}</td><td>{r['mrr']:.2f}</td></tr>")
            for k, v in (r.get("by_kind") or {}).items():
                rows.append(f"<tr><td></td><td></td><td>{KN.get(k, k)} {v['n']}</td><td>{v['hit1']:.2f}</td><td>{v['recall5']:.2f}</td><td>{v['mrr']:.2f}</td></tr>")
        rows.append("</tbody></table>")
        if "hybrid" not in modes:
            rows.append('<p class="pl-note">임베딩 서버가 꺼져 있어 BM25만 쟀습니다(<code>' + html.escape(_hint('embed_start', '임베딩 서버: DOCS_EMBED_URL')) + '</code>). 문서 빌드 컨테이너에서는 서버(127.0.0.1)에 닿지 않을 수 있습니다.</p>')
    rows += [
            "<table class='pl-table pl-sort'><thead><tr><th data-sort>순위</th><th>질문</th><th>정답</th><th>검색 1~3위</th></tr></thead><tbody>"]
    for x in sorted(rt["rows"], key=lambda x: (x["rank"] or 99)):
        want = "<br>".join(_doc_link(here, w, 0, w.replace("docs/", "")) for w in x["expect"])
        top = "<br>".join(_doc_link(here, t, 0, t.replace("docs/", "")) for t in x["top"])
        rank = x["rank"] or "없음"
        cls = "" if x["rank"] == 1 else ' class="q-miss"'
        rows.append(f'<tr{cls}><td data-v="{x["rank"] or 99}">{rank}</td><td>{html.escape(x["q"])}</td><td>{want}</td><td>{top}</td></tr>')
    rows.append("</tbody></table>")
    return "".join(rows)


def _incidents(here):
    inc = _q["incidents"]
    if not inc:
        return '<p class="pl-note">기록된 사례가 없습니다.</p>'
    cnt = defaultdict(int)
    for i in inc:
        cnt[i.get("type", "-")] += 1
    head = '<p class="pl-note">유형별: ' + " · ".join(f"{html.escape(k)} {v}" for k, v in sorted(cnt.items(), key=lambda kv: -kv[1])) + "</p>"
    rows = ["<table class='pl-table'><thead><tr><th>날짜</th><th>누가</th><th>유형</th><th>주장 → 사실</th><th>어떻게 알았나</th><th>막는 법</th></tr></thead><tbody>"]
    for i in sorted(inc, key=lambda i: i.get("date", ""), reverse=True):
        rows.append(f"<tr><td>{html.escape(i.get('date', ''))}</td><td>{html.escape(i.get('agent', ''))}</td><td>{html.escape(i.get('type', ''))}</td>"
                    f"<td>{html.escape(i.get('claim', ''))}<div class='pl-sub'>→ {html.escape(i.get('truth', ''))}</div></td>"
                    f"<td>{html.escape(i.get('caught_by', ''))}</td><td>{html.escape(i.get('prevention', ''))}</td></tr>")
    rows.append("</tbody></table>")
    return head + "".join(rows)


MARKERS = {"quality-summary": _summary, "quality-trend": _trend, "quality-tasks": _tasks, "quality-docs": _docs,
           "quality-kinds": _kinds, "quality-retrieval": _retrieval, "quality-incidents": _incidents}


def _insert_nav(nav, entry):
    """After the item that holds graph/README.md (문서 지도), else at the end."""
    for i, item in enumerate(nav or []):
        if isinstance(item, dict):
            for v in item.values():
                if v == "graph/README.md" or (isinstance(v, list) and "graph/README.md" in v):
                    nav.insert(i + 1, entry)
                    return
    nav.append(entry)


def _mentions(nav, path):
    for item in nav or []:
        if item == path:
            return True
        if isinstance(item, dict):
            for v in item.values():
                if v == path or (isinstance(v, list) and _mentions(v, path)):
                    return True
    return False


def on_config(config, **kwargs):
    if os.path.isdir(os.path.join(config["docs_dir"], DIR)) and config["nav"] and not _mentions(config["nav"], f"{DIR}/README.md"):
        _insert_nav(config["nav"], {"근거 점검": f"{DIR}/README.md"})
    return config


def on_files(files, config, **kwargs):
    _load(config["docs_dir"])
    for name in ("config.json", "questions.json", "history.json", "incidents.json", "retrieval.json"):
        f = files.get_file_from_path(f"{DIR}/{name}")
        if f is not None:
            files.remove(f)
    return files


def on_page_markdown(markdown, page, config, **kwargs):
    if "rep" not in _q or "<!-- quality-" not in markdown:
        return markdown
    here = page.file.src_uri
    for k, fn in MARKERS.items():
        rx = re.compile(r"^[ \t]*<!-- " + re.escape(k) + r" -->[ \t]*$", re.M)   # own line only: not in prose or `code`
        if rx.search(markdown):
            markdown = rx.sub(lambda m: fn(here), markdown)
    return markdown

# ---------------- tab on / off (docs-kit.yml, hooks/kitconf.py) ----------------
import os as _os  # noqa: E402
import sys as _sys  # noqa: E402

_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import kitconf as _kitconf  # noqa: E402

_kitconf.gate(globals(), "quality")
