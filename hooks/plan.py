"""MkDocs hook: project dashboard (현황판) - scope baseline, scope vs progress with a forecast, research questions,
risk register with a probability-impact matrix. Data: docs/plan/scope.yml, docs/plan/risks.yml, docs/plan/issues.json
(issue tracker snapshot written by the project's own export, schema in bin/weekly_draft.py), docs/roadmap/roadmap.yml (statuses and dates of work packages).

Made for research work, where scope and plans move:
- Rolling wave: near work is broken down and sized in points; far stages carry only a size range [low, high]. The
  scope is a band, not a line, and the forecast is a range of dates.
- Scope is flat (id, level, parent): moving work is changing `parent`; `added` / `removed` dates keep the history,
  so the burn-up shows the scope line moving (baselines B0, B1, ... marked) and the change log lists what moved.
- Status is not typed twice: a work package points to its roadmap item (`roadmap:`) or tracker issue (`issue:`).
- Progress of a stage (epic) is its exit criteria (DoD, stage-gate) as well as its done points; learning progress is
  the research questions (open / investigating / answered) with their evidence.
- Forecast: weekly throughput of done points (low / mean / high) against the remaining scope band, with a +50 %
  scope-growth case for the pessimistic date; confidence is shown low while there are fewer than 6 weeks of data.

Markers on a page: <!-- plan-summary --> <!-- plan-burnup --> <!-- plan-stages --> (stages with their exit criteria and
the work broken down under each) <!-- plan-questions --> <!-- plan-changes --> <!-- risk-summary --> <!-- risk-matrix -->
<!-- risk-top --> <!-- risk-trend --> <!-- risk-register -->  (risk-register also works on any page, e.g. arc42 A11).
Interaction (assets/_kit/javascripts/plan.js, all optional - the page reads fine without it): hover read-out on the
burn-up, tabs, search / status / horizon filters and expand-all on the stages, risk register filters (band cards and
PI-matrix cells filter it), column sort, tooltips ([data-tip]).
Sprints: docs/plan/sprints.json (written by the board plan/board/ through bin/plan_board.py, or by hand);
<!-- plan-sprint-now --> and <!-- plan-sprints -->; the board's data is plan/board/data.js.
Words on the page: 작업량 = scope (planned work, in points), 폭 = a size range [low, high], 시기 = wave.
Checks (WARNING): unknown parent / roadmap id / issue, cycles, a sized node under a sized node, leaves without a size,
backlog and WBS items without a DoD (own or a parent's), risk scores out of 1..5, unknown risk status.
"""
from __future__ import annotations

import datetime as dt
import html
import json
import logging
import os
import posixpath
import re
from collections import defaultdict

import yaml
from mkdocs.structure.files import File

log = logging.getLogger("mkdocs.hooks.plan")
DIR = "plan"
PAGES = ["README.md", "sprints.md", "guide.md"]
LEVELS = ["epic", "feature", "story", "backlog", "wbs"]
LEVEL_KO = {"epic": "Epic", "feature": "Feature", "story": "Story", "backlog": "Backlog", "wbs": "WBS"}
KIND_KO = {"deliver": "만들기", "learn": "배우기", "decide": "결정", "enabler": "기반"}
STATUS_KO = {"done": "완료", "doing": "진행 중", "todo": "할 일", "dropped": "뺌"}
WAVE_KO = {"now": "지금", "next": "다음", "later": "나중"}   # 시기 (rolling wave)
MET = {"yes": ("✓", "충족"), "partial": ("△", "일부"), "no": ("○", "미충족")}
Q_KO = {"open": "열림", "investigating": "조사 중", "answered": "답함", "dropped": "접음"}
CONF_KO = {"low": "낮음", "medium": "중간", "high": "높음"}
R_STATUS = {"open": "관리 중", "watch": "지켜봄", "occurred": "일어남", "closed": "닫힘"}
R_RESP = {"avoid": "피함", "mitigate": "줄임", "transfer": "넘김", "accept": "받아들임"}
ITEM_KEYS = {"id", "level", "parent", "title", "short", "size", "roadmap", "issue", "status", "date", "dod", "added", "removed",
             "reason", "kind", "wave", "track"}
Q_KEYS = {"id", "title", "status", "confidence", "evidence", "note", "items"}
RISK_KEYS = {"id", "title", "category", "cause", "effect", "response", "actions", "owner", "status", "links", "history"}
BANDS = [("critical", "매우 높음"), ("high", "높음"), ("medium", "중간"), ("low", "낮음")]

_s = {}            # state of the build
_docs = {}
_issues_url = [""]


# ---------------- loading ----------------
def _date(v):
    if isinstance(v, dt.date):
        return v
    if isinstance(v, str) and v:
        try:
            return dt.date.fromisoformat(v[:10])
        except ValueError:
            return None
    return None


def _keys(where, d, known):
    """Unknown keys are almost always YAML slips: a comma inside an unquoted flow-mapping value (`{title: a, b}`)."""
    extra = sorted(str(k) for k in d if k not in known)
    if extra:
        log.warning("%s: unknown key(s) %s (quote values that contain ', ' or ' #')", where, ", ".join(extra))


def _size(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v), float(v)
    if isinstance(v, (list, tuple)) and len(v) == 2:
        return float(v[0]), float(v[1])
    return None


def _load(docs_dir):
    p = os.path.join(docs_dir, DIR, "scope.yml")
    if not os.path.exists(p):
        return False
    sc = yaml.safe_load(open(p, encoding="utf-8")) or {}
    start = _date(sc.get("start")) or dt.date.today()
    rm = {}
    rp = os.path.join(docs_dir, "roadmap", "roadmap.yml")
    if os.path.exists(rp):
        for it in (yaml.safe_load(open(rp, encoding="utf-8")) or {}).get("items") or []:
            rm[str(it.get("id"))] = it
    iss, taken = {}, None
    ip = os.path.join(docs_dir, DIR, "issues.json")
    if os.path.exists(ip):
        j = json.load(open(ip, encoding="utf-8"))
        taken = j.get("taken")
        iss = {int(i["iid"]): i for i in j.get("issues", [])}
    nodes, order = {}, []
    for it in sc.get("items") or []:
        nid = str(it.get("id", ""))
        if not nid or nid in nodes:
            log.warning("plan: item id %r missing or duplicated", nid)
            continue
        _keys("plan: item " + nid, it, ITEM_KEYS)
        lv = it.get("level")
        if lv not in LEVELS:
            log.warning("plan: %s: level %r (one of %s)", nid, lv, ", ".join(LEVELS))
            continue
        n = dict(it, id=nid, size=_size(it.get("size")), added=_date(it.get("added")) or start,
                 removed=_date(it.get("removed")), children=[])
        if it.get("size") is not None and n["size"] is None:
            log.warning("plan: %s: size %r (a number or [low, high])", nid, it.get("size"))
        nodes[nid] = n
        order.append(nid)
    for nid in order:
        n = nodes[nid]
        par = n.get("parent")
        if par is not None:
            if par not in nodes:
                log.warning("plan: %s: parent %r is not an item", nid, par)
                n["parent"] = None
            else:
                nodes[par]["children"].append(nid)
        elif n["level"] != "epic":
            log.warning("plan: %s: a %s needs a parent", nid, n["level"])
    # cycles
    for nid in order:
        seen, p = set(), nodes[nid].get("parent")
        while p:
            if p in seen or p == nid:
                log.warning("plan: cycle through %s", nid)
                nodes[nid]["parent"] = None
                break
            seen.add(p)
            p = nodes[p].get("parent")
    # own status from roadmap / issue / explicit
    for nid in order:
        n = nodes[nid]
        st, d = None, None
        if n.get("roadmap"):
            r = rm.get(str(n["roadmap"]))
            if r is None:
                log.warning("plan: %s: roadmap item %r not in roadmap.yml", nid, n["roadmap"])
            else:
                s = r.get("status")
                st = {"done": "done", "doing": "doing", "dropped": "dropped"}.get(s, "todo")
                d = _date(r.get("date"))
                n.setdefault("title", r.get("title"))
        if n.get("issue") is not None:
            i = iss.get(int(n["issue"]))
            if i is None:
                if iss:
                    log.warning("plan: %s: issue #%s not in issues.json (refresh the issue snapshot)", nid, n["issue"])
            else:
                n.setdefault("title", i["title"])
                if st is None:
                    st = "done" if i["state"] == "closed" else "todo"
                    d = _date(i.get("closed"))
        if n.get("status"):
            st = n["status"] if n["status"] in STATUS_KO else st
            d = _date(n.get("date")) or d
        n["own"] = (st, d)
        n.setdefault("title", nid)
    # units: sized nodes with no sized ancestor
    def sized_anc(nid):
        p = nodes[nid].get("parent")
        while p:
            if nodes[p]["size"] is not None:
                return p
            p = nodes[p].get("parent")
        return None
    units = []
    for nid in order:
        n = nodes[nid]
        if n["size"] is not None:
            a = sized_anc(nid)
            if a:
                log.warning("plan: %s: sized under sized %s (counted once, at %s)", nid, a, a)
                continue
            units.append(nid)
        elif not n["children"] and not sized_anc(nid) and n["level"] != "epic":
            log.warning("plan: %s: no size (a number, or [low, high] for far work)", nid)
    # unit status: rolled up from descendants that have a status source, else own
    def leaves_status(nid):
        out = []
        for c in nodes[nid]["children"]:
            if nodes[c]["own"][0] is not None:
                out.append(nodes[c]["own"])
            out += leaves_status(c)
        return out
    def rollup(sts, own):
        sts = [s for s in sts if s[0] is not None and s[0] != "dropped"]
        if not sts:
            return own if own[0] is not None else ("todo", None)
        if all(s[0] == "done" for s in sts):
            return "done", max((s[1] for s in sts if s[1]), default=None)
        if any(s[0] in ("done", "doing") for s in sts):
            return "doing", None
        return "todo", None
    for nid in order:
        n = nodes[nid]
        if n["own"][0] == "dropped":
            n["state"] = n["own"]
        elif n["children"]:
            n["state"] = rollup(leaves_status(nid) + ([n["own"]] if n["level"] != "epic" and n.get("issue") is None
                                                       and n["own"][0] else []), n["own"])
        else:
            n["state"] = n["own"] if n["own"][0] else ("todo", None)
        if n["state"][0] == "done" and n["state"][1] is None:
            n["state"] = ("done", n["added"])
            log.warning("plan: %s: done without a date (roadmap date / issue closed / date:)", nid)
    # DoD on backlog and WBS
    for nid in order:
        n = nodes[nid]
        if n["level"] in ("backlog", "wbs") and not n.get("dod") and n["own"][0] != "dropped":
            p, ok = n.get("parent"), False
            while p and not ok:
                ok = bool(nodes[p].get("dod")) and nodes[p]["level"] in ("backlog", "wbs", "story")
                p = nodes[p].get("parent")
            if not ok:
                log.warning("plan: %s: %s without a DoD (own, or its backlog item's)", nid, n["level"])
    # risks
    risks = []
    rp = os.path.join(docs_dir, DIR, "risks.yml")
    rk = yaml.safe_load(open(rp, encoding="utf-8")) if os.path.exists(rp) else {}
    for q in sc.get("questions") or []:
        _keys(f"plan: question {q.get('id')}", q, Q_KEYS)
    for r in (rk or {}).get("risks") or []:
        _keys(f"plan: risk {r.get('id')}", r, RISK_KEYS)
        hist = sorted((dict(h, date=_date(h.get("date"))) for h in r.get("history") or []), key=lambda h: h["date"])
        if not hist:
            log.warning("plan: risk %s: no history (date, p, i)", r.get("id"))
            continue
        for h in hist:
            if not (1 <= int(h.get("p", 0)) <= 5 and 1 <= int(h.get("i", 0)) <= 5):
                log.warning("plan: risk %s: p / i out of 1..5 on %s", r.get("id"), h["date"])
        if r.get("status") not in R_STATUS:
            log.warning("plan: risk %s: status %r (one of %s)", r.get("id"), r.get("status"), ", ".join(R_STATUS))
        risks.append(dict(r, history=hist, p=int(hist[-1]["p"]), i=int(hist[-1]["i"])))
    _s.clear()
    _s.update(sc=sc, start=start, nodes=nodes, order=order, units=units, rm=rm, issues=iss, taken=taken, risks=risks,
              rk=rk or {}, today=dt.date.today())
    return True


# ---------------- numbers ----------------
def _met(c):
    """A criterion -> its met value (YAML reads yes / no as booleans)."""
    if not isinstance(c, dict):
        return "no"
    v = c.get("met", "no")
    return "yes" if v is True else "no" if v is False else str(v)


def _mid(sz):
    return (sz[0] + sz[1]) / 2


def _scope_at(d, wave=None):
    lo = hi = 0.0
    for u in _s["units"]:
        n = _s["nodes"][u]
        if n["added"] > d or (n["removed"] and n["removed"] <= d):
            continue
        if wave and _wave(u) != wave:
            continue
        lo += n["size"][0]; hi += n["size"][1]
    return lo, hi


def _done_at(d, wave=None):
    tot = 0.0
    for u in _s["units"]:
        n = _s["nodes"][u]
        st, dd = n["state"]
        if st == "done" and dd and dd <= d and (not wave or _wave(u) == wave):
            tot += _mid(n["size"])
    return tot


def _wave(nid):
    n = _s["nodes"][nid]
    while n:
        if n.get("wave"):
            return n["wave"]
        p = n.get("parent")
        n = _s["nodes"].get(p) if p else None
    return "now"


def _epic_of(nid):
    n = _s["nodes"][nid]
    while n.get("parent"):
        n = _s["nodes"][n["parent"]]
    return n["id"]


def _weeks():
    """Monday-based weeks from the start to today: (monday, done points that week)."""
    start, today = _s["start"], _s["today"]
    m = start - dt.timedelta(days=start.weekday())
    out = []
    while m <= today:
        e = m + dt.timedelta(days=6)
        out.append((m, _done_at(e) - _done_at(m - dt.timedelta(days=1))))
        m += dt.timedelta(days=7)
    return out


def _forecast(wave=None):
    today = _s["today"]
    lo, hi = _scope_at(today, wave)
    done = _done_at(today, wave)
    rem_lo, rem_hi = max(0.0, lo - done), max(0.0, hi - done)
    weeks = _weeks()
    full = [w for m, w in weeks if m + dt.timedelta(days=6) < today] or [w for _, w in weeks]
    elapsed = max(1.0, (today - _s["start"]).days / 7.0)
    total_done = _done_at(today)
    mean = total_done / elapsed
    rate_lo = max(min(full) if full else mean, mean * 0.25, 0.1)
    rate_hi = max(max(full) if full else mean, mean)
    if wave:                                   # the share of throughput that went to this wave so far
        share = (done / total_done) if total_done else 1.0
        mean, rate_lo, rate_hi = mean * share or 0.1, rate_lo * share or 0.1, rate_hi * share or 0.1
    d = lambda pts, rate: today + dt.timedelta(days=round(7 * pts / rate)) if rate > 0 else None  # noqa: E731
    return {"scope": (lo, hi), "done": done, "remaining": (rem_lo, rem_hi), "rate": (rate_lo, mean, rate_hi),
            "weeks_of_data": len(full), "opt": d(rem_lo, rate_hi), "base": d((rem_lo + rem_hi) / 2, mean),
            "pess": d(rem_hi * 1.5, rate_lo)}


# ---------------- links ----------------
def _index_docs(docs_dir):
    _docs.clear()
    for kind, sub, pat in (("ADR", "adr", r"^(\d{4})-.+\.md$"), ("VR", "records", r"^(\d{4})-.+\.md$"),
                           ("EXP", "experiments", r"^(\d{4})-.+\.md$"), ("P", "publications", r"^(\d{4})-.+\.md$"),
                           ("G", "guides", r"^g(\d+)_.+\.md$"), ("R", "reference", r"^r(\d+)_.+\.md$"),
                           ("A", "arc42", r"^a(\d\d)_.+\.md$"), ("BG", "background", r"^(\d\d)_.+\.md$")):
        d = os.path.join(docs_dir, sub)
        for f in sorted(os.listdir(d)) if os.path.isdir(d) else []:
            m = re.match(pat, f)
            if m:
                _docs[(kind, int(m.group(1)))] = f"{sub}/{f}"


def _ref(ref, here):
    """A ref -> HTML link (relative to the page `here`, a docs path)."""
    r = str(ref).strip()
    rel = lambda p: posixpath.relpath(p[:-3] + ".html" if p.endswith(".md") else p, posixpath.dirname(here) or ".")  # noqa: E731
    m = re.fullmatch(r"#(\d+)", r)
    if m:
        u = _issues_url[0]
        return f'<a href="{u}{m.group(1)}" target="_blank">{r}</a>' if u else html.escape(r)
    m = re.fullmatch(r"(ADR|VR|EXP|P)-(\d{4})", r) or re.fullmatch(r"([GRA])\s?(\d+)", r)
    if m:
        p = _docs.get((m.group(1), int(m.group(2))))
        if p:
            return f'<a href="{rel(p)}">{html.escape(r)}</a>'
    m = re.fullmatch(r"(?:배경|bg)\s?(\d+)", r)
    if m and _docs.get(("BG", int(m.group(1)))):
        return f'<a href="{rel(_docs[("BG", int(m.group(1)))])}">{html.escape(r)}</a>'
    return html.escape(r)


def _item_link(n, here):
    t = html.escape(str(n.get("title")))
    if n.get("roadmap"):
        p = posixpath.relpath(f"roadmap/items/{n['roadmap']}.html", posixpath.dirname(here) or ".")
        t = f'<a href="{p}">{t}</a>'
    if n.get("issue") is not None:
        t += " " + _ref(f"#{n['issue']}", here)
    return t


def _chip(st):
    return f'<span class="pl-st pl-st-{st}">{STATUS_KO.get(st, st)}</span>'


def _size_txt(sz):
    if sz is None:
        return ""
    return f"{sz[0]:g}" if sz[0] == sz[1] else f"{sz[0]:g}~{sz[1]:g}"


def _node_size(nid):
    """Size of a node: its own, or the sum of the units under it."""
    n = _s["nodes"][nid]
    if n["size"] is not None:
        return n["size"]
    lo = hi = 0.0
    for c in n["children"]:
        s = _node_size(c)
        if s and not (_s["nodes"][c]["state"][0] == "dropped"):
            lo += s[0]; hi += s[1]
    return (lo, hi) if hi else None


def _node_done(nid):
    n = _s["nodes"][nid]
    if n["size"] is not None:
        return _mid(n["size"]) if n["state"][0] == "done" else 0.0
    return sum(_node_done(c) for c in n["children"])


# ---------------- sections ----------------
def _attr(s):
    return html.escape(str(s), quote=True)


def _summary(here):
    f, fn = _forecast(), _forecast("now")
    today = _s["today"]
    risks = [r for r in _s["risks"] if r.get("status") != "closed"]
    hi = sum(1 for r in risks if r["p"] * r["i"] >= 10)
    occ = sum(1 for r in risks if r.get("status") == "occurred")
    qs = _s["sc"].get("questions") or []
    qc = defaultdict(int)
    for q in qs:
        qc[q.get("status", "open")] += 1
    lo, hi_s = f["scope"]
    pct = lambda d, s: f"{100 * d / s:.0f}%" if s else "-"  # noqa: E731
    conf = "낮음" if f["weeks_of_data"] < 6 else "보통"
    cards = [
        ("전체 작업량", f"{lo:g}~{hi_s:g}", f"포인트 (먼 단계는 폭으로), 끝낸 일 {f['done']:g} ({pct(f['done'], (lo + hi_s) / 2)})", "#작업량과-진척"),
        ("지금 하는 일", f"{fn['done']:g} / {fn['scope'][0]:g}~{fn['scope'][1]:g}", f"끝냄 {pct(fn['done'], _mid(fn['scope']))}, 끝날 예측 {_dfmt(fn['opt'])} ~ {_dfmt(fn['pess'])}", "#작업량과-진척"),
        ("처리량", f"{f['rate'][1]:.1f}", f"포인트/주 (폭 {f['rate'][0]:.1f}~{f['rate'][2]:.1f}), 데이터 {f['weeks_of_data']}주, 신뢰 {conf}", "#작업량과-진척"),
        ("과제 끝 예측", f"{_dfmt(f['base'])}", f"낙관 {_dfmt(f['opt'])} · 비관(작업량 +50%) {_dfmt(f['pess'])}", "#작업량과-진척"),
        ("리스크", f"{len(risks)}", f"높음 이상 {hi}, 일어남 {occ}", "#리스크"),
        ("연구 질문", f"{qc['answered']}/{len(qs)}", f"답함, 조사 중 {qc['investigating']}, 열림 {qc['open']}", "#연구-질문"),
    ]
    out = ['<div class="pl-cards">']
    for t, v, s, href in cards:
        out.append(f'<a class="pl-card pl-card-link" href="{href}"><div class="pl-card-t">{t}</div><div class="pl-card-v">{html.escape(v)}</div>'
                   f'<div class="pl-card-s">{html.escape(s)}</div></a>')
    out.append("</div>")
    src = f"기준일 {today}. 상태: 로드맵, 이슈 스냅숏 {(_s['taken'] or '없음')[:16].replace('T', ' ')}"
    out.append(f'<p class="pl-note">{html.escape(src)}. 포인트 = {html.escape(str(_s["sc"].get("unit_note", "")))}</p>')
    return "\n".join(out)


def _dfmt(d):
    return d.strftime("%Y-%m-%d") if d else "-"


def _burnup(wave=None):
    """Burn-up: planned work (a band: low..high) over time with baselines, done points, the forecast lines.
    The day-by-day numbers go into data-* for the hover read-out (plan.js)."""
    start, today = _s["start"], _s["today"]
    f = _forecast(wave)
    end = max([today + dt.timedelta(days=28)] + [d for d in (f["opt"], f["base"], f["pess"]) if d])
    end = min(end, start + dt.timedelta(days=7 * 60))
    W, H, L, R, T, B = 760, 306, 52, 16, 24, 34
    days = max(1, (end - start).days)
    smax = max(_scope_at(today, wave)[1] * 1.6, 1.0)
    x = lambda d: L + (W - L - R) * (d - start).days / days  # noqa: E731
    y = lambda v: T + (H - T - B) * (1 - v / smax)  # noqa: E731
    pts_lo, pts_hi, pts_done, data_lo, data_hi, data_done = [], [], [], [], [], []
    d = start
    while d <= today:
        lo, hi = _scope_at(d, wave)
        dn_ = _done_at(d, wave)
        pts_lo.append((x(d), y(lo))); pts_hi.append((x(d), y(hi))); pts_done.append((x(d), y(dn_)))
        data_lo.append(lo); data_hi.append(hi); data_done.append(dn_)
        d += dt.timedelta(days=1)
    lo, hi = f["scope"]
    pts_lo.append((x(end), y(lo))); pts_hi.append((x(end), y(hi)))
    band = "M" + " L".join(f"{a:.1f},{b:.1f}" for a, b in pts_hi) + " L" + " L".join(
        f"{a:.1f},{b:.1f}" for a, b in reversed(pts_lo)) + " Z"
    o = [f'<svg class="pl-svg" viewBox="0 0 {W} {H}" role="img" aria-label="계획 작업량과 끝낸 일">']
    for k in range(5):                                  # grid
        v = smax * k / 4
        o.append(f'<line class="pl-grid" x1="{L}" x2="{W - R}" y1="{y(v):.1f}" y2="{y(v):.1f}"/>'
                 f'<text class="pl-ax" x="{L - 6}" y="{y(v) + 4:.1f}" text-anchor="end">{v:.0f}</text>')
    m = start - dt.timedelta(days=start.weekday())
    k = 0
    while m <= end:
        if m >= start and k % max(1, round(days / 7 / 10)) == 0:
            o.append(f'<text class="pl-ax" x="{x(m):.1f}" y="{H - 12}" text-anchor="middle">{m.month}/{m.day}</text>')
        m += dt.timedelta(days=7); k += 1
    o.append(f'<text class="pl-ax pl-ax-t" x="{L - 6}" y="{T - 6}" text-anchor="end">포인트</text>'
             f'<text class="pl-ax pl-ax-t" x="{W - R}" y="{H - 2}" text-anchor="end">날짜 (주 시작일)</text>')
    o.append(f'<path class="pl-scope" d="{band}"/>')
    o.append('<polyline class="pl-scope-lo" points="' + " ".join(f"{a:.1f},{b:.1f}" for a, b in pts_lo) + '"/>')
    o.append('<polyline class="pl-scope-hi" points="' + " ".join(f"{a:.1f},{b:.1f}" for a, b in pts_hi) + '"/>')
    bls = []
    for b in _s["sc"].get("baselines") or []:
        bd = _date(b.get("date"))
        if bd and start <= bd <= end:
            bls.append([(bd - start).days, str(b.get("id")), str(b.get("note", ""))])
            o.append(f'<line class="pl-base" x1="{x(bd):.1f}" x2="{x(bd):.1f}" y1="{T}" y2="{H - B}"/>'
                     f'<text class="pl-base-t" x="{x(bd) + 3:.1f}" y="{T + 10}">{html.escape(str(b.get("id")))}</text>')
    o.append('<polyline class="pl-done" points="' + " ".join(f"{a:.1f},{b:.1f}" for a, b in pts_done) + '"/>')
    dn = f["done"]
    rem_lo, rem_hi = f["remaining"]
    fcs = []
    for key, cls, lab, tgt in (("opt", "pl-fc-opt", "낙관", dn + rem_lo), ("base", "pl-fc-base", "기준", dn + (rem_lo + rem_hi) / 2),
                               ("pess", "pl-fc-pess", "비관", dn + rem_hi * 1.5)):
        fd = f[key]
        if not fd:
            continue
        fcs.append([lab, (fd - start).days, round(tgt, 1)])
        if fd > end:                                   # clip the line at the chart's end
            frac = (end - today).days / max(1, (fd - today).days)
            fd, tgt = end, dn + (tgt - dn) * frac
        fx, fy = x(fd), y(min(tgt, smax))
        o.append(f'<line class="pl-fc {cls}" x1="{x(today):.1f}" y1="{y(dn):.1f}" x2="{fx:.1f}" y2="{fy:.1f}"/>'
                 f'<circle class="pl-fc-dot" cx="{fx:.1f}" cy="{fy:.1f}" r="2.5"/>'
                 f'<text class="pl-fc-t" x="{fx - 4:.1f}" y="{fy - 5:.1f}" text-anchor="end">{lab} {_dfmt(f[key])[5:]}</text>')
    o.append(f'<line class="pl-today" x1="{x(today):.1f}" x2="{x(today):.1f}" y1="{T}" y2="{H - B}"/>'
             f'<text class="pl-today-t" x="{x(today) + 3:.1f}" y="{H - B - 4}">오늘</text>')
    o.append(f'<g class="pl-hover" style="display:none"><line class="pl-hover-x" x1="0" x2="0" y1="{T}" y2="{H - B}"/>'
             f'<circle class="pl-hover-done" r="4"/></g>')
    o.append("</svg>")
    data = {"start": start.isoformat(), "days": days, "L": L, "R": R, "W": W, "T": T, "B": B, "H": H, "smax": smax,
            "lo": data_lo, "hi": data_hi, "done": data_done, "end": [lo, hi], "fc": fcs, "base": bls}
    legend = ('<div class="pl-legend"><span class="pl-lg pl-lg-scope">계획 작업량 (최소~최대 폭)</span>'
              '<span class="pl-lg pl-lg-done">끝낸 일</span><span class="pl-lg pl-lg-fc">예측: 낙관 · 기준 · 비관(작업량 +50%)</span>'
              '<span class="pl-lg pl-lg-base">기준선: 계획을 다시 정한 날</span></div>')
    tab = (f'<p class="pl-note">계획 작업량 {lo:g}~{hi:g} 포인트, 끝냄 {dn:g}, 남음 {f["remaining"][0]:g}~{f["remaining"][1]:g}. '
           f'처리량 {f["rate"][0]:.1f} / {f["rate"][1]:.1f} / {f["rate"][2]:.1f} 포인트/주(낮음/평균/높음, 다 지난 주 {f["weeks_of_data"]}개). '
           f'끝나는 날: 낙관 {_dfmt(f["opt"])}, 기준 {_dfmt(f["base"])}, 비관 {_dfmt(f["pess"])}. '
           f'세로축은 진척률이 아니라 일의 크기(포인트)이고, 진척은 끝낸 일 선과 계획 작업량 띠 사이의 간격입니다. '
           f'띠가 올라가면 계획이 늘어난 것, 선이 평평하면 일이 끝나지 않은 것입니다. 마우스를 올리면 그날 숫자가 나옵니다.</p>')
    return (f'<div class="pl-chart" data-burnup="{_attr(json.dumps(data, ensure_ascii=False))}">{"".join(o)}'
            f'</div>{legend}{tab}')


def _burnups(here):
    return ('<div class="pl-tabs" data-tabs><div class="pl-tabbar" role="tablist">'
            '<button type="button" data-tab="0" class="on">지금 하는 일 (시기: 지금)</button>'
            '<button type="button" data-tab="1">과제 전체 (먼 단계는 폭으로)</button></div>'
            '<div class="pl-tab" data-pane="0"><h3 class="pl-tab-h">지금 하는 일 (시기: 지금)</h3>' + _burnup("now") + '</div>'
            '<div class="pl-tab" data-pane="1"><h3 class="pl-tab-h">과제 전체 (먼 단계는 폭으로)</h3>' + _burnup(None) + "</div></div>")


def _crit_html(n, here):
    lis = []
    for c in n.get("dod") or []:
        mt = _met(c)
        c = c if isinstance(c, dict) else {"text": c}
        sym, lab = MET.get(mt, MET["no"])
        ev = " ".join(_ref(e, here) for e in c.get("evidence") or [])
        lis.append(f'<li class="pl-met-{mt}"><span class="pl-sym" title="{lab}">{sym}</span> '
                   f'{html.escape(str(c.get("text")))} <span class="pl-ev">{ev}</span></li>')
    return f'<ul class="pl-crit">{"".join(lis)}</ul>' if lis else ""


def _search_text(nid):
    n = _s["nodes"][nid]
    parts = [nid, str(n.get("title", ""))]
    if n.get("issue") is not None:
        parts.append(f"#{n['issue']}")
    if n.get("roadmap"):
        parts.append(str(n["roadmap"]))
    for c in n.get("dod") or []:
        parts.append(str(c.get("text") if isinstance(c, dict) else c))
        if isinstance(c, dict):
            parts += [str(e) for e in c.get("evidence") or []]
    return " ".join(parts).lower()


def _counts(nid):
    """'Story 1 · Backlog 3 · WBS 4' for what sits under a node (dropped items left out)."""
    c = defaultdict(int)
    def walk(x):
        for k in _s["nodes"][x]["children"]:
            if _s["nodes"][k]["state"][0] != "dropped":
                c[_s["nodes"][k]["level"]] += 1
            walk(k)
    walk(nid)
    parts = [f'{LEVEL_KO[lv]} {c[lv]}' for lv in LEVELS[1:] if c[lv]]
    return f'<span class="pl-cnt" title="아래에 있는 항목 수 (펼치면 보임)">{" · ".join(parts)}</span>' if parts else ""


def _node_html(nid, depth, here):
    n = _s["nodes"][nid]
    st, d = n["state"]
    sz = _node_size(nid)
    meta = [f'<span class="pl-lv pl-lv-{n["level"]}">{LEVEL_KO[n["level"]]}</span>']
    if n.get("kind"):
        meta.append(f'<span class="pl-kind">{KIND_KO.get(n["kind"], n["kind"])}</span>')
    meta.append(_chip(st))
    if d and st == "done":
        meta.append(f'<span class="pl-date">{d}</span>')
    if sz:
        meta.append(f'<span class="pl-size" title="크기 (포인트)">{_size_txt(sz)}</span>')
    if n.get("removed"):
        meta.append(f'<span class="pl-rm">뺌 {n["removed"]}: {html.escape(str(n.get("reason", "")))}</span>')
    elif n["added"] > _s["start"]:
        meta.append(f'<span class="pl-add">추가 {n["added"]}</span>')
    if n["children"]:
        meta.append(_counts(nid))
    head = f'<span class="pl-id">{html.escape(nid)}</span> {_item_link(n, here)} {" ".join(meta)}'
    body = _dod_html(n, here)
    kids = "".join(_node_html(c, depth + 1, here) for c in n["children"])
    attrs = f'data-st="{st}" data-wave="{_wave(nid)}" data-q="{_attr(_search_text(nid))}"'
    if not body and not kids:
        return f'<div class="pl-leaf pl-dep-{depth}" {attrs}>{head}</div>'
    return (f'<details class="pl-node pl-dep-{depth}" {attrs}><summary>{head}</summary>'
            f'<div class="pl-body">{body}{kids}</div></details>')


def _stages(here):
    """Stages (epics) with their exit criteria and, under each, the work broken down (feature > story > backlog > WBS)."""
    epics = [nid for nid in _s["order"] if _s["nodes"][nid]["level"] == "epic"]
    legend = _s["sc"].get("legend") or []
    out = []
    if legend:
        out.append('<div class="pl-key"><b>ID 읽는 법</b> ' + " ".join(
            f'<span><code>{html.escape(str(e.get("key")))}</code> {html.escape(str(e.get("text")))}</span>' for e in legend) + "</div>")
    ov = ['<div class="pl-overview">']
    for nid in epics:
        n = _s["nodes"][nid]
        sz, done = _node_size(nid), _node_done(nid)
        pct = 100 * done / _mid(sz) if sz and _mid(sz) else 0
        crit = n.get("dod") or []
        met = sum(1 for c in crit if _met(c) == "yes")
        part = sum(1 for c in crit if _met(c) == "partial")
        short = str(n.get("short") or n["title"]).split(" - ")[0]
        ov.append(f'<a class="pl-ov pl-wave-{n.get("wave", "now")} pl-st-b-{n["state"][0]}" href="#ep-{nid.lower()}" '
                  f'data-tip="{_attr(n["title"])}"><span class="pl-ov-id">{html.escape(nid)}</span>'
                  f'<span class="pl-ov-t">{html.escape(short)}</span><span class="pl-bar"><span style="width:{min(100, pct):.0f}%"></span></span>'
                  f'<span class="pl-ov-m">{pct:.0f}% · 기준 {met}{"+" + str(part) if part else ""}/{len(crit)}</span></a>')
    ov.append("</div>")
    out.append("".join(ov))
    dod = "".join(f"<li>{html.escape(str(t))}</li>" for t in _s["sc"].get("team_dod") or [])
    if dod:
        out.append(f'<details class="pl-teamdod"><summary>팀 공통 완료 정의 (모든 Backlog·WBS에 적용)</summary><ul>{dod}</ul></details>')
    out.append('<div class="pl-toolbar" data-tree-tools></div>')
    out.append('<div class="pl-tree">')
    for nid in epics:
        n = _s["nodes"][nid]
        sz, done = _node_size(nid), _node_done(nid)
        mid = _mid(sz) if sz else 0
        pct = 100 * done / mid if mid else 0
        crit = n.get("dod") or []
        met = sum(1 for c in crit if _met(c) == "yes")
        part = sum(1 for c in crit if _met(c) == "partial")
        wave = n.get("wave", "now")
        meta = (f'{KIND_KO.get(n.get("kind"), "")} · 시기 {WAVE_KO.get(wave, "")}'
                f'{" · 트랙 " + html.escape(str(n["track"])) if n.get("track") else ""} · 크기 {_size_txt(sz)} 포인트')
        kids = "".join(_node_html(c, 1, here) for c in n["children"])
        open_ = " open" if wave == "now" else ""
        out.append(
            f'<details class="pl-stage pl-wave-{wave}" id="ep-{nid.lower()}" data-st="{n["state"][0]}" data-wave="{wave}" '
            f'data-q="{_attr(_search_text(nid))}"{open_}><summary><div class="pl-stage-h"><span class="pl-stage-id">{html.escape(nid)}</span>'
            f'<span class="pl-stage-t">{html.escape(str(n["title"]))}</span>{_chip(n["state"][0])}</div>'
            f'<div class="pl-stage-m">{meta}</div><div class="pl-stage-p"><span class="pl-bar"><span style="width:{min(100, pct):.0f}%"></span></span>'
            f'<span>끝낸 일 {done:g} 포인트 ({pct:.0f}%) · 통과 기준 {met}/{len(crit)} 충족{f", {part} 일부" if part else ""}</span>{_counts(nid)}</div></summary>'
            f'<div class="pl-stage-b"><div class="pl-stage-sec">통과 기준 (이 단계를 마쳤다고 말할 조건)</div>{_crit_html(n, here)}'
            f'<div class="pl-stage-sec">작업 분해 (Feature > Story > Backlog > WBS, ▸를 누르면 아래 단계가 펼쳐짐)</div><div class="pl-body">{kids}</div></div></details>')
    out.append("</div>")
    return "\n".join(out)


def _epics(here):       # kept for pages that used the old marker
    return _stages(here)


def _tree(here):
    return ""


def _questions(here):
    rows = ["<table class='pl-table'><thead><tr><th>질문</th><th>상태</th><th>확신</th><th>근거</th><th>관련 단계·항목</th></tr></thead><tbody>"]
    for q in _s["sc"].get("questions") or []:
        ev = " ".join(_ref(e, here) for e in q.get("evidence") or [])
        note = f'<div class="pl-sub">{html.escape(str(q["note"]))}</div>' if q.get("note") else ""
        items = []
        for i in q.get("items") or []:
            ep = _epic_of(str(i)) if str(i) in _s["nodes"] else None
            items.append(f'<a href="#ep-{ep.lower()}" data-open="{_attr(i)}">{html.escape(str(i))}</a>' if ep else html.escape(str(i)))
        st = q.get("status", "open")
        rows.append(f'<tr><td><b>{html.escape(str(q["id"]))}</b> {html.escape(str(q.get("title", "")))}{note}</td>'
                    f'<td><span class="pl-q pl-q-{st}">{Q_KO.get(st, st)}</span></td>'
                    f'<td>{CONF_KO.get(q.get("confidence", "low"), "")}</td><td>{ev}</td><td>{", ".join(items)}</td></tr>')
    rows.append("</tbody></table>")
    return "".join(rows)


def _dod_html(n, here):
    items = n.get("dod") or []
    if not items:
        return ""
    lis = []
    for c in items:
        if isinstance(c, dict):
            sym = MET.get(_met(c), MET["no"])[0]
            ev = " ".join(_ref(e, here) for e in c.get("evidence") or [])
            lis.append(f"<li>{sym} {html.escape(str(c.get('text')))} {ev}</li>")
        else:
            lis.append(f"<li>{html.escape(str(c))}</li>")
    return f'<ul class="pl-dod"><span class="pl-dod-t">완료 정의</span>{"".join(lis)}</ul>'


def _changes(here):
    rows = ["<table class='pl-table'><thead><tr><th>날짜</th><th>기준선</th><th>변경</th><th>항목</th><th>크기</th><th>이유</th></tr></thead><tbody>"]
    bl = sorted(((_date(b.get("date")), b) for b in _s["sc"].get("baselines") or []), key=lambda x: x[0] or _s["start"])
    ev = []
    for u in _s["units"]:
        n = _s["nodes"][u]
        if n["added"] > _s["start"]:
            ev.append((n["added"], "추가", n))
        if n["removed"]:
            ev.append((n["removed"], "뺌", n))
    for d, what, n in sorted(ev, key=lambda e: (e[0], e[1])):
        b = next((bb.get("id") for bd, bb in reversed(bl) if bd and bd <= d), "")
        rows.append(f'<tr><td>{d}</td><td>{html.escape(str(b))}</td><td>{what}</td><td>{_item_link(n, here)}</td>'
                    f'<td>{"+" if what == "추가" else "−"}{_size_txt(n["size"])}</td>'
                    f'<td>{html.escape(str(n.get("reason", "")))}</td></tr>')
    rows.append("</tbody></table>")
    bls = "".join(f'<li><b>{html.escape(str(b.get("id")))}</b> {_date(b.get("date"))}: {html.escape(str(b.get("note", "")))} '
                  f'(그날 계획 작업량 {_scope_at(_date(b.get("date")))[0]:g}~{_scope_at(_date(b.get("date")))[1]:g})</li>'
                  for _, b in bl)
    return f'<ul class="pl-bl">{bls}</ul>' + "".join(rows)


# ---------------- risks ----------------
def _band(score):
    for name, (a, b) in (_s["rk"].get("bands") or {"low": [1, 4], "medium": [5, 9], "high": [10, 14],
                                                    "critical": [15, 25]}).items():
        if a <= score <= b:
            return name
    return "low"


def _risk_tip(r):
    return (f'{r["id"]} {r["title"]}\n{r.get("cause", "")} → {r.get("effect", "")}\n'
            f'대응({R_RESP.get(r.get("response"), "")}): {r.get("actions", "")}\n'
            f'가능성 {r["p"]} × 영향 {r["i"]} = {r["p"] * r["i"]}, {R_STATUS.get(r.get("status"), "")}')


def _risk_summary(here):
    rs = [r for r in _s["risks"] if r.get("status") != "closed"]
    by = defaultdict(int)
    for r in rs:
        by[_band(r["p"] * r["i"])] += 1
    st = defaultdict(int)
    for r in _s["risks"]:
        st[r.get("status")] += 1
    cat = defaultdict(int)
    for r in rs:
        cat[r.get("category", "-")] += 1
    cards = "".join(f'<button type="button" class="pl-card pl-band-{k}" data-rfilter="band" data-rval="{k}" '
                    f'title="대장에서 {lab}만 보기"><div class="pl-card-t">{lab}</div><div class="pl-card-v">{by[k]}</div></button>'
                    for k, lab in BANDS)
    s2 = " · ".join(f"{R_STATUS[k]} {st[k]}" for k in R_STATUS if st[k])
    s3 = " · ".join(f"{html.escape(k)} {v}" for k, v in sorted(cat.items(), key=lambda kv: -kv[1]))
    return (f'<div class="pl-cards pl-cards-risk">{cards}</div><p class="pl-note">상태: {s2}. 분류: {s3}. '
            f'카드나 매트릭스 칸을 누르면 아래 대장이 그 리스크만 보입니다.</p>')


def _risk_matrix(here):
    cells = defaultdict(list)
    for r in _s["risks"]:
        if r.get("status") != "closed":
            cells[(r["p"], r["i"])].append(r)
    plab = _s["rk"].get("scales", {}).get("p", [str(k) for k in range(1, 6)])
    ilab = _s["rk"].get("scales", {}).get("i", [str(k) for k in range(1, 6)])
    o = ['<div class="pl-pi-wrap"><table class="pl-pi"><tbody>']
    for i in range(5, 0, -1):
        o.append(f'<tr><th class="pl-pi-y" data-tip="{_attr(ilab[i - 1])}">영향 {i}</th>')
        for p in range(1, 6):
            band = _band(p * i)
            ids = " ".join(f'<a href="#{r["id"].lower()}" data-tip="{_attr(_risk_tip(r))}">{r["id"]}</a>'
                           for r in sorted(cells[(p, i)], key=lambda r: r["id"]))
            o.append(f'<td class="pl-band-{band}{" pl-pi-has" if ids else ""}" data-rfilter="pi" data-rval="{p},{i}">'
                     f'<span class="pl-pi-s">{p * i}</span>{ids}</td>')
        o.append("</tr>")
    o.append('<tr><th></th>' + "".join(f'<th class="pl-pi-x" data-tip="{_attr(plab[p - 1])}">가능성 {p}</th>'
                                        for p in range(1, 6)) + "</tr></tbody></table></div>")
    key = ('<div class="pl-legend">' + "".join(f'<span class="pl-lg pl-lgb-{k}">{lab}</span>' for k, lab in BANDS)
           + "<span>점수 = 가능성 × 영향. 축 이름과 ID에 마우스를 올리면 설명이 나옵니다</span></div>")
    scales = ("<details class='pl-scales'><summary>척도</summary><table class='pl-table'><tr><th>점</th><th>가능성</th>"
              "<th>영향</th></tr>" + "".join(f"<tr><td>{k + 1}</td><td>{html.escape(plab[k])}</td><td>{html.escape(ilab[k])}</td></tr>"
                                             for k in range(5)) + "</table></details>")
    return "".join(o) + key + scales


def _trend_txt(r):
    h = r["history"]
    if len(h) < 2:
        return ""
    a, b = h[-2]["p"] * h[-2]["i"], h[-1]["p"] * h[-1]["i"]
    tip = " → ".join(f'{x["date"]} {x["p"] * x["i"]}' + (f' ({x["note"]})' if x.get("note") else "") for x in h)
    return f'<span class="pl-trend" data-tip="{_attr(tip)}">{"▼" if b < a else "▲" if b > a else "="}</span>'


def _risk_row(r, here, full=True):
    sc = r["p"] * r["i"]
    links = " ".join(_ref(x, here) for x in r.get("links") or [])
    q = " ".join(str(r.get(k, "")) for k in ("id", "title", "cause", "effect", "actions", "owner")).lower()
    row = (f'<tr id="{r["id"].lower()}" data-band="{_band(sc)}" data-pi="{r["p"]},{r["i"]}" data-cat="{_attr(r.get("category", ""))}" '
           f'data-status="{_attr(r.get("status", ""))}" data-q="{_attr(q)}"><td><b>{r["id"]}</b></td><td>{html.escape(r["title"])}'
           + (f'<div class="pl-sub">{html.escape(str(r.get("cause", "")))} → {html.escape(str(r.get("effect", "")))}</div>' if full else "")
           + f'</td><td>{html.escape(str(r.get("category", "")))}</td><td data-v="{r["p"]}">{r["p"]}</td><td data-v="{r["i"]}">{r["i"]}</td>'
           f'<td data-v="{sc}"><span class="pl-score pl-band-{_band(sc)}">{sc}</span> {_trend_txt(r)}</td>'
           f'<td>{R_RESP.get(r.get("response"), r.get("response", ""))}: {html.escape(str(r.get("actions", "")))}</td>'
           f'<td>{html.escape(str(r.get("owner", "")))}</td><td>{R_STATUS.get(r.get("status"), r.get("status"))}</td>'
           f'<td>{links}</td></tr>')
    return row


_RHEAD = ("<table class='pl-table pl-risks' data-register><thead><tr><th data-sort>ID</th><th>리스크 (원인 → 영향)</th><th data-sort>분류</th>"
          "<th data-sort>가능성</th><th data-sort>영향</th><th data-sort>점수</th><th>대응</th><th data-sort>담당</th><th data-sort>상태</th>"
          "<th>관련</th></tr></thead><tbody>")


def _risk_top(here):
    rs = sorted((r for r in _s["risks"] if r.get("status") != "closed" and r["p"] * r["i"] >= 10),
                key=lambda r: (-r["p"] * r["i"], r["id"]))
    return _RHEAD.replace(" data-register", "") + "".join(_risk_row(r, here, full=False) for r in rs) + "</tbody></table>"


def _risk_register(here):
    rs = sorted(_s["risks"], key=lambda r: (r.get("status") == "closed", -r["p"] * r["i"], r["id"]))
    src = posixpath.relpath("plan/index.html", posixpath.dirname(here) or ".")
    note = (f'<p class="pl-note">원천: <code>docs/plan/risks.yml</code>. PI 매트릭스와 추이는 '
            f'<a href="{src}#리스크">현황판</a>. 점수 = 가능성 × 영향 (1~25), ▼▲ = 지난 평가 대비(마우스를 올리면 이력). '
            f'열 이름을 누르면 정렬합니다.</p>')
    cats = sorted({str(r.get("category", "")) for r in _s["risks"]})
    tools = (f'<div class="pl-toolbar" data-risk-tools data-cats="{_attr(json.dumps(cats, ensure_ascii=False))}"></div>')
    return note + tools + _RHEAD + "".join(_risk_row(r, here) for r in rs) + "</tbody></table>"


def _risk_trend(here):
    dates = sorted({h["date"] for r in _s["risks"] for h in r["history"] if h["date"]})
    if not dates:
        return ""
    full = max(r["history"][0]["date"] for r in _s["risks"] if r["history"])   # every risk assessed from here on
    pts = []
    for d in [x for x in dates if x >= full]:
        tot = 0
        for r in _s["risks"]:
            h = [x for x in r["history"] if x["date"] <= d]
            if h and r.get("status") != "closed":
                tot += h[-1]["p"] * h[-1]["i"]
        pts.append((d, tot))
    events = [(h["date"], r["id"], h.get("note", "")) for r in _s["risks"] for h in r["history"] if h["date"] < full]
    ev = "".join(f"<li>{d} {html.escape(i)}: {html.escape(str(n))}</li>" for d, i, n in sorted(events))
    txt = " → ".join(f"{d.month}/{d.day} {v}" for d, v in pts)
    msg = (f'<p class="pl-note">노출 합계(열린 리스크의 가능성 × 영향 합): {txt}. 평가가 쌓이면 추세가 보입니다 '
           f'(점수를 바꿀 때 history에 한 줄 더함).</p>')
    return msg + (f'<p class="pl-note">전체 평가 이전에 기록된 사건:</p><ul class="pl-note">{ev}</ul>' if ev else "")


# ---------------- sprints and the board ----------------
SPRINT_COLS = ["todo", "doing", "review", "done"]
COL_KO = {"todo": "할 일", "doing": "진행 중", "review": "검토", "done": "완료"}
SPRINT_STATE_KO = {"planned": "계획", "active": "진행 중", "closed": "마감"}
SPRINT_KEYS = {"id", "start", "end", "state", "goal", "items", "blocked", "carried", "retro", "note", "closed_at"}
_sp = {}


def _has_backlog_anc(nid):
    p = _s["nodes"][nid].get("parent")
    while p:
        if _s["nodes"][p]["level"] == "backlog":
            return True
        p = _s["nodes"][p].get("parent")
    return False


def _card_ids():
    return [nid for nid in _s["order"] if _s["nodes"][nid]["level"] == "backlog"
            or (_s["nodes"][nid]["level"] == "wbs" and not _has_backlog_anc(nid))]


def _load_sprints(docs_dir):
    _sp.clear()
    p = os.path.join(docs_dir, DIR, "sprints.json")
    if not os.path.exists(p):
        return
    try:
        sj = json.load(open(p, encoding="utf-8"))
    except ValueError as e:
        log.warning("plan: sprints.json: %s", e)
        return
    cards = set(_card_ids())
    sprints, active, prev_end = [], 0, None
    for s in sj.get("sprints") or []:
        sid = str(s.get("id", ""))
        _keys(f"plan: sprint {sid}", s, SPRINT_KEYS)
        a, b = _date(s.get("start")), _date(s.get("end"))
        if not (a and b and a <= b):
            log.warning("plan: sprint %s: start / end missing or reversed", sid)
            continue
        if prev_end and a <= prev_end:
            log.warning("plan: sprint %s starts before the previous one ends", sid)
        prev_end = b
        if s.get("state") not in SPRINT_STATE_KO:
            log.warning("plan: sprint %s: state %r (planned | active | closed)", sid, s.get("state"))
        active += s.get("state") == "active"
        for k, col in (s.get("items") or {}).items():
            if k not in cards:
                log.warning("plan: sprint %s: %s is not a backlog item or a WBS item outside a backlog", sid, k)
            if col not in SPRINT_COLS:
                log.warning("plan: sprint %s: %s in column %r (%s)", sid, k, col, " | ".join(SPRINT_COLS))
        sprints.append(dict(s, id=sid, start=a, end=b))
    if active > 1:
        log.warning("plan: %d sprints are active (at most one)", active)
    _sp.update(cfg=sj, sprints=sprints)


def _card_size(nid):
    sz = _node_size(nid)
    return _mid(sz) if sz else 0.0


def _sprint_stats(s):
    items = s.get("items") or {}
    committed = sum(_card_size(k) for k in items if k in _s["nodes"])
    done = sum(_card_size(k) for k, c in items.items() if c == "done" and k in _s["nodes"])
    proof = sum(1 for k, c in items.items() if c == "done" and k in _s["nodes"] and _s["nodes"][k]["state"][0] != "done")
    return committed, done, proof


def _current_sprint():
    sp = _sp.get("sprints") or []
    for s in sp:
        if s.get("state") == "active":
            return s
    t = _s["today"]
    return next((s for s in sp if s["start"] <= t <= s["end"]), None)


def _board_href(here):
    return posixpath.relpath(f"{DIR}/board/index.html", posixpath.dirname(here) or ".")


def _sprint_now(here):
    s = _current_sprint()
    link = f'<a class="pl-btn pl-board-link" href="{_board_href(here)}" target="_blank">스프린트 보드 열기 (전체 화면, 끌어서 옮기기)</a>'
    if not s:
        return f'<div class="pl-sprint-now"><p class="pl-note">진행 중인 스프린트가 없습니다. 보드에서 시작합니다.</p>{link}</div>'
    items = s.get("items") or {}
    cnt = defaultdict(int)
    for c in items.values():
        cnt[c] += 1
    committed, done, proof = _sprint_stats(s)
    left = (s["end"] - _s["today"]).days
    cols = " · ".join(f"{COL_KO[c]} {cnt[c]}" for c in SPRINT_COLS)
    blocked = len(s.get("blocked") or {})
    pct = 100 * done / committed if committed else 0
    return (f'<div class="pl-sprint-now"><div class="pl-sprint-h"><b>{html.escape(s["id"])}</b> {s["start"]} ~ {s["end"]} '
            f'<span class="pl-st pl-st-doing">{SPRINT_STATE_KO.get(s.get("state"), "")}</span>'
            f'<span class="pl-note"> 남은 날 {max(0, left)}일</span></div>'
            f'<div class="pl-sprint-goal">목표: {html.escape(str(s.get("goal") or "(정하지 않음)"))}</div>'
            f'<div class="pl-stage-p"><span class="pl-bar"><span style="width:{min(100, pct):.0f}%"></span></span>'
            f'<span>끝낸 {done:g} / 약속 {committed:g} 포인트 · {cols}{f" · 막힘 {blocked}" if blocked else ""}'
            f'{f" · 근거 필요 {proof}" if proof else ""}</span></div>{link}</div>')


def _velocity_svg():
    sp = _sp.get("sprints") or []
    if not sp:
        return ""
    W, H, L, B, T = 640, 170, 40, 28, 12
    vals = [_sprint_stats(s)[:2] for s in sp]
    vmax = max([1.0] + [max(v) for v in vals]) * 1.15
    bw = (W - L - 10) / max(1, len(sp))
    y = lambda v: T + (H - T - B) * (1 - v / vmax)  # noqa: E731
    o = [f'<svg class="pl-svg pl-vel" viewBox="0 0 {W} {H}" role="img" aria-label="스프린트별 약속과 끝낸 포인트">']
    for k in range(4):
        v = vmax * k / 3
        o.append(f'<line class="pl-grid" x1="{L}" x2="{W - 10}" y1="{y(v):.1f}" y2="{y(v):.1f}"/>'
                 f'<text class="pl-ax" x="{L - 6}" y="{y(v) + 4:.1f}" text-anchor="end">{v:.0f}</text>')
    for i, (s, (c, d)) in enumerate(zip(sp, vals)):
        x0 = L + i * bw + bw * 0.18
        w = bw * 0.3
        tip = f'{s["id"]} {s["start"]}~{s["end"]}: 약속 {c:g}, 끝냄 {d:g} 포인트'
        o.append(f'<g data-tip="{_attr(tip)}"><rect class="pl-vel-c" x="{x0:.1f}" y="{y(c):.1f}" width="{w:.1f}" height="{y(0) - y(c):.1f}" rx="2"/>'
                 f'<rect class="pl-vel-d" x="{x0 + w + 2:.1f}" y="{y(d):.1f}" width="{w:.1f}" height="{y(0) - y(d):.1f}" rx="2"/></g>'
                 f'<text class="pl-ax" x="{x0 + w + 1:.1f}" y="{H - 10}" text-anchor="middle">{html.escape(s["id"])}</text>')
    o.append("</svg>")
    return ('<div class="pl-chart">' + "".join(o) + '</div><div class="pl-legend"><span class="pl-lg pl-lg-c">약속 (스프린트에 넣은 일)</span>'
            '<span class="pl-lg pl-lg-d">끝냄</span><span>막대에 마우스를 올리면 숫자</span></div>')


def _sprints_page(here):
    sp = _sp.get("sprints") or []
    link = f'<p><a class="pl-btn pl-board-link" href="{_board_href(here)}" target="_blank">스프린트 보드 열기 (전체 화면)</a></p>'
    rows = ["<table class='pl-table'><thead><tr><th>스프린트</th><th>기간</th><th>상태</th><th>목표</th><th>약속</th><th>끝냄</th>"
            "<th>이월</th><th>막힘</th><th>회고</th></tr></thead><tbody>"]
    for s in reversed(sp):
        c, d, proof = _sprint_stats(s)
        carried = ", ".join(html.escape(str(x)) for x in s.get("carried") or [])
        blocked = "<br>".join(f"{html.escape(k)}: {html.escape(str(v))}" for k, v in (s.get("blocked") or {}).items())
        r = s.get("retro") or {}
        retro = "<br>".join(f"<b>{lab}</b> {html.escape(str(r[k]))}" for k, lab in (("good", "잘됨"), ("problem", "문제"), ("try", "다음에"))
                            if r.get(k))
        note = f'<div class="pl-sub">{html.escape(str(s["note"]))}</div>' if s.get("note") else ""
        rows.append(f'<tr><td><a href="{_board_href(here)}#sprint={html.escape(s["id"])}" target="_blank"><b>{html.escape(s["id"])}</b></a></td>'
                    f'<td>{s["start"]} ~ {s["end"]}</td><td>{SPRINT_STATE_KO.get(s.get("state"), "")}</td>'
                    f'<td>{html.escape(str(s.get("goal") or ""))}{note}</td><td>{c:g}</td><td>{d:g}{f" (근거 필요 {proof})" if proof else ""}</td>'
                    f'<td>{carried}</td><td>{blocked}</td><td>{retro}</td></tr>')
    rows.append("</tbody></table>")
    return link + _velocity_svg() + "".join(rows)


def _epic_color(i):
    pal = ["#6250d6", "#2a78d6", "#1baf7a", "#eb6834", "#c0328f", "#0b8a8a", "#b8860b", "#7a7a85", "#d93025", "#4f7a28"]
    return pal[i % len(pal)]


def _board_js(config):
    here = f"{DIR}/board/index.html"
    epics = [nid for nid in _s["order"] if _s["nodes"][nid]["level"] == "epic"]
    ecol = {e: _epic_color(i) for i, e in enumerate(epics)}
    cards = []
    for nid in _card_ids():
        n = _s["nodes"][nid]
        ep = _epic_of(nid)
        chain, p = [], n.get("parent")
        while p and _s["nodes"][p]["level"] != "epic":
            chain.append(str(_s["nodes"][p]["title"]))
            p = _s["nodes"][p].get("parent")
        subs = [{"id": c, "title": str(_s["nodes"][c]["title"]), "state": _s["nodes"][c]["state"][0],
                 "href": posixpath.relpath(f"roadmap/items/{_s['nodes'][c]['roadmap']}.html", f"{DIR}/board") if _s["nodes"][c].get("roadmap") else ""}
                for c in n["children"]]
        dod = []
        for c in n.get("dod") or []:
            dod.append(str(c.get("text") if isinstance(c, dict) else c))
        sz = _node_size(nid)
        cards.append({
            "id": nid, "title": str(n["title"]), "level": n["level"], "kind": n.get("kind") or "",
            "wave": _wave(nid), "epic": ep, "chain": list(reversed(chain)), "size": list(sz) if sz else None,
            "state": n["state"][0], "date": str(n["state"][1] or ""), "issue": n.get("issue"),
            "roadmap": posixpath.relpath(f"roadmap/items/{n['roadmap']}.html", f"{DIR}/board") if n.get("roadmap") else "",
            "added": str(n["added"]), "removed": str(n["removed"] or ""), "dod": dod, "subs": subs})
    data = {
        "today": str(_s["today"]), "built": dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "issues_url": _issues_url[0], "team_dod": [str(x) for x in _s["sc"].get("team_dod") or []],
        "epics": [{"id": e, "short": str(_s["nodes"][e].get("short") or _s["nodes"][e]["title"]),
                   "title": str(_s["nodes"][e]["title"]), "color": ecol[e]} for e in epics],
        "cards": cards, "cols": [[c, COL_KO[c]] for c in SPRINT_COLS],
        "sprints": json.loads(json.dumps((_sp.get("cfg") or {}).get("sprints") or [], default=str)),
        "cadence_days": int((_sp.get("cfg") or {}).get("cadence_days") or 7),
        "wip_limit": int((_sp.get("cfg") or {}).get("wip_limit") or 3),
        "save": (_sp.get("cfg") or {}).get("save") or {"port": 8002, "from_ports": [8001]},
    }
    return "window.PLAN_BOARD = " + json.dumps(data, ensure_ascii=False) + ";\n"


# ---------------- MkDocs events ----------------
def _fill_nav(nav, files):
    for item in nav or []:
        if isinstance(item, dict):
            for k, v in item.items():
                if isinstance(v, list):
                    if f"{DIR}/README.md" in v:
                        item[k] = files
                        return True
                    if _fill_nav(v, files):
                        return True
    return False


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
    if os.path.exists(os.path.join(config["docs_dir"], DIR, "scope.yml")) and config["nav"]:
        pages = [f"{DIR}/{p}" for p in PAGES]
        if not _fill_nav(config["nav"], pages) and not _mentions(config["nav"], f"{DIR}/README.md"):
            config["nav"].insert(1, {"현황판": pages})       # after 개요 (docs-standard §2)
    return config


def on_files(files, config, **kwargs):
    url = str((config.get("extra") or {}).get("issues_url") or "")
    _issues_url[0] = url if not url or url.endswith("/") else url + "/"
    _index_docs(config["docs_dir"])
    if not _load(config["docs_dir"]):
        return files
    _load_sprints(config["docs_dir"])
    for name in ("scope.yml", "risks.yml", "issues.json", "sprints.json"):
        f = files.get_file_from_path(f"{DIR}/{name}")
        if f is not None:
            files.remove(f)                                  # sources, not published files
    files.append(File.generated(config, f"{DIR}/board/data.js", content=_board_js(config)))
    return files


MARKERS = {"plan-summary": _summary, "plan-burnup": _burnups, "plan-stages": _stages, "plan-epics": _epics, "plan-questions": _questions,
           "plan-tree": _tree, "plan-changes": _changes, "risk-summary": _risk_summary, "risk-matrix": _risk_matrix,
           "risk-top": _risk_top, "risk-trend": _risk_trend, "risk-register": _risk_register,
           "plan-sprint-now": _sprint_now, "plan-sprints": _sprints_page}


def on_page_markdown(markdown, page, config, **kwargs):
    if not _s or "<!-- plan-" not in markdown and "<!-- risk-" not in markdown:
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

_kitconf.gate(globals(), "plan")
