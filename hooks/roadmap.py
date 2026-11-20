"""MkDocs hook: roadmap (docs/roadmap/roadmap.yml) — done and planned work as a transit map, one page per item.

One data file is the whole roadmap, so a change of plan is an edit of that file (statuses, follow-ups, tracks):

  tracks:  lanes, top to bottom (id, name, color)            e.g. 환경·문서, 핵심 기능, 화면
  units:   work units (id, name, summary): items in a unit read as one flow (업무별 흐름)
  items:   id, title, track (one id, or a list of ADJACENT tracks = merged work drawn across them), unit,
           status (done | doing | next | later | future | dropped), date (YYYY-MM-DD: when done; its week column),
           after (ids it follows: arrows), refs (ADR-0016, VR-0013, G11, A3, R4, 배경 20, #60, !35, a docs path
           "guides/g11_x.md#anchor", or a URL), summary

Columns, left to right: one per week (Monday) that has dated items, then 지금 (doing), 다음 (next), 그다음 (later),
나중 (future). Planned work has horizons, not dates (Now / Next / Later), so moving it is one word.

- The map lives in a standalone viewer, roadmap/viewer/ (like the C4 viewer): the map on the left, and clicking a
  station opens a panel with its details, before / after, related documents grouped by kind (결정, 검증, 가이드,
  배경·아키텍처, 이슈·MR, ...) as links, and the other items of its unit. Filters by unit, status, text; #item=<id>
  opens an item (shareable). The hook writes roadmap/viewer/data.js (map SVG + items); the viewer files are kit
  assets (assets/roadmap/viewer/). An item fed from two or more tracks, or drawn across several, is an interchange.
- "<!-- roadmap-map -->" embeds that viewer (with a link to open it full screen).
- "<!-- roadmap-units -->": per unit, its items in order with status and links.
- "<!-- roadmap-table -->": every item (status, track, when, title).
- roadmap/items/<id>.md is generated per item (not in the nav): card, summary, what it follows and what follows,
  related documents (refs as links with their titles), the other items of its unit.
- Nav: the section that lists roadmap/README.md is filled with README and guide.md.
- Checks (WARNING): unknown track / unit / after id, non-adjacent tracks, cycles, done without date, unknown status,
  duplicate ids, refs that resolve to no document.
"""
from __future__ import annotations

import datetime as dt
import html
import logging
import os
import re
from collections import defaultdict

import json
import posixpath

import yaml
from mkdocs.structure.files import File, InclusionLevel

log = logging.getLogger("mkdocs.hooks.roadmap")

KIT_ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")
DIR = "roadmap"
DATA = f"{DIR}/roadmap.yml"
FIXED_PAGES = ["README.md", "guide.md"]
STATUS = {"done": "완료", "doing": "진행 중", "next": "다음", "later": "그다음", "future": "나중", "dropped": "취소"}
HORIZON = [("doing", "지금"), ("next", "다음"), ("later", "그다음"), ("future", "나중")]
NODE_W, NODE_H, GUT, GAP, LABEL_W, HEAD_H = 140, 46, 40, 22, 108, 42
SUB_W, LANE_PAD = NODE_W + GUT, GAP           # a sub-column: a box and the gap to its right (for lines)
_NUMFILE = re.compile(r"^(\d{4})-[a-z0-9-]+\.md$")
_DOCS = {"VR": "records", "ADR": "adr", "EXP": "experiments", "P": "publications"}

_rm = {}            # the loaded roadmap
_docs = {}          # ("ADR", "0016") -> path, ("G", "11") -> path, ...
_issues = [""]
VIEWER = f"{DIR}/viewer/index.html"
# related documents in the panel, in this order: (kind, heading)
REF_KINDS = [("adr", "결정 (ADR)"), ("vr", "검증 기록 (VR)"), ("exp", "실험"), ("guide", "실행 가이드·참고"),
             ("arch", "아키텍처·배경"), ("pub", "문서함"), ("issue", "이슈·MR"), ("doc", "다른 문서"), ("web", "외부 링크"),
             ("text", "그 밖의 참조")]
_PATH_KIND = [("adr/", "adr"), ("records/", "vr"), ("experiments/", "exp"), ("guides/", "guide"),
              ("reference/", "guide"), ("arc42/", "arch"), ("background/", "arch"), ("glossary/", "arch"),
              ("publications/", "pub")]


# ---- loading and checks ----
def _load(docs_dir):
    p = os.path.join(docs_dir, DATA)
    if not os.path.exists(p):
        return {}
    d = yaml.safe_load(open(p, encoding="utf-8")) or {}
    tracks = d.get("tracks") or []
    order = {t["id"]: i for i, t in enumerate(tracks)}
    units = {u["id"]: u for u in d.get("units") or []}
    items, seen = [], set()
    for it in d.get("items") or []:
        iid = str(it.get("id", ""))
        if not iid or iid in seen:
            log.warning("roadmap: item id %r missing or duplicated", iid)
            continue
        seen.add(iid)
        tr = it.get("track")
        tr = [tr] if isinstance(tr, str) else list(tr or [])
        bad = [t for t in tr if t not in order]
        if not tr or bad:
            log.warning("roadmap: item %s: unknown track %s", iid, bad or tr)
            continue
        idx = sorted(order[t] for t in tr)
        if idx != list(range(idx[0], idx[0] + len(idx))):
            log.warning("roadmap: item %s: tracks %s are not next to each other (order in tracks:)", iid, tr)
        st = it.get("status", "next")
        if st not in STATUS:
            log.warning("roadmap: item %s: status %r (one of %s)", iid, st, ", ".join(STATUS))
            st = "next"
        date = it.get("date")
        if isinstance(date, str):
            try:
                date = dt.date.fromisoformat(date)
            except ValueError:
                log.warning("roadmap: item %s: date %r is not YYYY-MM-DD", iid, date)
                date = None
        if st in ("done", "dropped") and not isinstance(date, dt.date):
            log.warning("roadmap: item %s: status %s needs a date", iid, st)
        if it.get("unit") and it["unit"] not in units:
            log.warning("roadmap: item %s: unknown unit %r", iid, it["unit"])
        items.append({**it, "id": iid, "tracks": [tracks[i]["id"] for i in idx], "status": st, "date": date,
                      "after": [str(a) for a in it.get("after") or []], "refs": list(it.get("refs") or [])})
    byid = {it["id"]: it for it in items}
    for it in items:
        for a in it["after"]:
            if a not in byid:
                log.warning("roadmap: item %s: after %r is not an item", it["id"], a)
        it["after"] = [a for a in it["after"] if a in byid]
    # cycles
    state = {}

    def visit(i, path):
        if state.get(i) == 1:
            log.warning("roadmap: cycle %s", " -> ".join(path + [i]))
            return
        if state.get(i) == 2:
            return
        state[i] = 1
        for a in byid[i]["after"]:
            visit(a, path + [i])
        state[i] = 2
    for i in byid:
        visit(i, [])
    children = defaultdict(list)
    for it in items:
        for a in it["after"]:
            children[a].append(it["id"])
    for it in items:
        it["children"] = children[it["id"]]
        it["column"] = _column(it)
        # interchange: drawn across tracks, or fed by two or more items that come from different tracks
        feeding = {t for a in it["after"] for t in byid[a]["tracks"]} | set(it["tracks"])
        it["merge"] = len(it["tracks"]) > 1 or (len(it["after"]) >= 2 and len(feeding) > 1)
    return {"title": d.get("title", "로드맵"), "tracks": tracks, "units": units, "items": items, "byid": byid}


def _week(d: dt.date) -> dt.date:
    return d - dt.timedelta(days=d.weekday())


def _column(it):
    if it["status"] in ("done", "dropped") and isinstance(it["date"], dt.date):
        return ("w", _week(it["date"]))
    if it["status"] in ("done", "dropped"):
        return ("h", "doing")
    return ("h", it["status"])


def _columns(items):
    weeks = sorted({it["column"][1] for it in items if it["column"][0] == "w"})
    used = {it["column"][1] for it in items if it["column"][0] == "h"}
    cols = [(("w", w), f"{w.month}/{w.day:02d} 주") for w in weeks]
    cols += [(("h", h), name) for h, name in HORIZON if h in used or h == "doing"]
    return cols


# ---- references ----
def _index_docs(docs_dir):
    _docs.clear()
    for kind, sub in _DOCS.items():
        d = os.path.join(docs_dir, sub)
        for f in sorted(os.listdir(d)) if os.path.isdir(d) else []:
            m = _NUMFILE.match(f)
            if m:
                _docs[(kind, m.group(1))] = f"{sub}/{f}"
    for kind, sub, pat in (("G", "guides", r"^g(\d+)_.+\.md$"), ("R", "reference", r"^r(\d+)_.+\.md$"),
                           ("A", "arc42", r"^a(\d\d)_.+\.md$"), ("BG", "background", r"^(\d\d)_.+\.md$")):
        d = os.path.join(docs_dir, sub)
        for f in sorted(os.listdir(d)) if os.path.isdir(d) else []:
            m = re.match(pat, f)
            if m:
                _docs[(kind, str(int(m.group(1))))] = f"{sub}/{f}"


def _title(docs_dir, path):
    try:
        for line in open(os.path.join(docs_dir, path.split("#")[0]), encoding="utf-8"):
            if line.startswith("# "):
                return line[2:].strip()
    except OSError:
        pass
    return path


def resolve(ref, docs_dir):
    """A ref -> (label, target): target is a docs-relative .md path, an http URL, or None (plain text)."""
    r = str(ref).strip()
    issues = _issues[0]
    if re.fullmatch(r"#\d+", r):
        return f"이슈 {r}", (issues + r[1:] if issues else None)
    if re.fullmatch(r"!\d+", r):
        return f"MR {r}", (issues.replace("/issues/", "/merge_requests/") + r[1:] if issues else None)
    if r.startswith(("http://", "https://")):
        return r, r
    m = re.fullmatch(r"(ADR|VR|EXP|P)-(\d{4})", r)
    if m:
        p = _docs.get((m.group(1), m.group(2)))
        return (_title(docs_dir, p), p) if p else (r, None)
    m = re.fullmatch(r"(G|R|A)\s?(\d+)(?:\s*(§[\d.]+))?", r)
    if m:
        p = _docs.get((m.group(1), str(int(m.group(2)))))
        return ((_title(docs_dir, p) + (f" {m.group(3)}" if m.group(3) else "")), p) if p else (r, None)
    m = re.fullmatch(r"(?:배경|bg)\s?(\d+)", r)
    if m:
        p = _docs.get(("BG", str(int(m.group(1)))))
        return (f"배경 {_title(docs_dir, p)}", p) if p else (r, None)
    if ".md" in r:
        p = r[len("docs/"):] if r.startswith("docs/") else r
        for base in (docs_dir, KIT_ASSETS):               # the project's docs, or a page the kit adds
            if os.path.exists(os.path.join(base, p.split("#")[0])):
                return _title(base, p), p
        return r, None
    return r, None


# ---- the map (inline SVG) ----
def _wrap(text, width_px=NODE_W - 14, max_lines=2):
    """Break a title into lines that fit (Hangul ~12 px, ASCII ~7 px at 12 px font)."""
    lines, cur, w = [], "", 0.0
    for ch in text:
        cw = 12.0 if ord(ch) > 0x2E80 else 7.0
        if w + cw > width_px and cur:
            lines.append(cur)
            cur, w = "", 0.0
            if len(lines) == max_lines:
                break
        cur += ch
        w += cw
    if len(lines) < max_lines and cur:
        lines.append(cur)
    if len(lines) == max_lines and "".join(lines) != text:
        lines[-1] = lines[-1][:-1] + "…"
    return lines


def _layout(rm):
    """Where everything goes. Columns are split into sub-columns so that work that follows other work in the same
    column sits to its right; an item takes the row of its predecessor on the same track when it is free (straight
    lines), otherwise the nearest free row."""
    tracks, items, byid = rm["tracks"], rm["items"], rm["byid"]
    cols = _columns(items)
    cidx = {c: i for i, (c, _) in enumerate(cols)}
    tix = {t["id"]: i for i, t in enumerate(tracks)}
    for it in items:
        it["_c"] = cidx[it["column"]]
    depth = {}

    def sub(it):
        if it["id"] not in depth:
            depth[it["id"]] = 0
            same = [byid[a] for a in it["after"] if byid[a]["_c"] == it["_c"]]
            depth[it["id"]] = max([sub(a) + 1 for a in same] or [0])
        return depth[it["id"]]
    nsub = [1] * len(cols)
    for it in items:
        it["_s"] = sub(it)
        nsub[it["_c"]] = max(nsub[it["_c"]], it["_s"] + 1)
    used = defaultdict(set)                                # (track, col, sub) -> rows taken
    row = {}

    def want(it):
        for a in it["after"]:
            if a in row and set(byid[a]["tracks"]) & set(it["tracks"]):
                return row[a]
        return None
    pending = sorted(items, key=lambda it: (it["_c"], it["_s"], tix[it["tracks"][0]], str(it.get("date") or ""),
                                            it["id"]))
    for it in pending:
        w = want(it)
        keys = [(t, it["_c"], it["_s"]) for t in it["tracks"]]
        free = lambda r: all(r not in used[k] for k in keys)     # noqa: E731
        if w is not None and free(w):
            r = w
        else:
            r, d = None, 0
            base = w if w is not None else 0
            while r is None:
                for cand in (base - d, base + d):
                    if cand >= 0 and free(cand):
                        r = cand
                        break
                d += 1
        row[it["id"]] = r
        for k in keys:
            used[k].add(r)
    lane_n = []
    for t in tracks:
        rows = [r for (tt, _, _), rs in used.items() if tt == t["id"] for r in rs]
        lane_n.append(max(rows) + 1 if rows else 1)
    lane_h = [n * (NODE_H + GAP) - GAP + 2 * LANE_PAD for n in lane_n]
    lane_y = [HEAD_H]
    for h in lane_h[:-1]:
        lane_y.append(lane_y[-1] + h)
    col_x = [LABEL_W]
    for n in nsub[:-1]:
        col_x.append(col_x[-1] + n * SUB_W)
    W = col_x[-1] + nsub[-1] * SUB_W + 8
    H = lane_y[-1] + lane_h[-1] + 4
    pos = {}
    for it in items:
        x = col_x[it["_c"]] + it["_s"] * SUB_W + GUT / 2
        rows = [lane_y[tix[t]] + LANE_PAD + row[it["id"]] * (NODE_H + GAP) for t in it["tracks"]]
        pos[it["id"]] = {"x": x, "y0": rows[0], "y1": rows[-1] + NODE_H, "mids": [r + NODE_H / 2 for r in rows]}
    channels = sorted(lane_y[i] + LANE_PAD + k * (NODE_H + GAP) - GAP / 2
                      for i in range(len(tracks)) for k in range(lane_n[i] + 1))
    return {"cols": cols, "nsub": nsub, "col_x": col_x, "lane_y": lane_y, "lane_h": lane_h, "W": W, "H": H,
            "pos": pos, "tix": tix, "channels": channels}


def _route(lay, a, b, lanes_used):
    """Orthogonal path from a's right side to b's left side through the gaps between boxes (rounded corners)."""
    pa, pb = lay["pos"][a], lay["pos"][b]
    sx, tx = pa["x"] + NODE_W, pb["x"]
    sy = min(pa["mids"], key=lambda m: abs(m - sum(pb["mids"]) / len(pb["mids"])))
    ty = min(pb["mids"], key=lambda m: abs(m - sy))
    boxes = list(lay["pos"].values())

    def clear_h(y, x0, x1):
        lo, hi = min(x0, x1), max(x0, x1)
        return not any(q["x"] < hi - 1 and q["x"] + NODE_W > lo + 1 and q["y0"] - 2 < y < q["y1"] + 2 for q in boxes)

    def lane(key, base, step, n=5):
        k = lanes_used[key]
        lanes_used[key] += 1
        return base + ((k % n) - n // 2) * step
    if abs(sy - ty) < 1 and clear_h(sy, sx, tx):
        return [(sx, sy), (tx, ty)]
    xa = lane(("g", round(sx)), sx + GUT / 2, 4)
    xb = lane(("g", round(tx)), tx - GUT / 2, 4)
    if tx > sx and clear_h(sy, sx, xb):                   # along the source's row, down the target's gap
        return [(sx, sy), (xb, sy), (xb, ty), (tx, ty)]
    if tx > sx and clear_h(ty, xa, tx):                   # down the source's gap, along the target's row
        return [(sx, sy), (xa, sy), (xa, ty), (tx, ty)]
    best = None
    for c in lay["channels"]:
        if clear_h(c, xa, xb):
            cost = abs(c - ty) + abs(c - sy)
            if best is None or cost < best[0]:
                best = (cost, c)
    yc = best[1] if best else min(sy, ty) - NODE_H
    yc = lane(("c", round(yc)), yc, 3, 3)
    return [(sx, sy), (xa, sy), (xa, yc), (xb, yc), (xb, ty), (tx, ty)]


def _path(pts, r=8):
    out = [f"M{pts[0][0]:.1f},{pts[0][1]:.1f}"]
    for i in range(1, len(pts) - 1):
        (x0, y0), (x1, y1), (x2, y2) = pts[i - 1], pts[i], pts[i + 1]
        d0, d1 = abs(x1 - x0) + abs(y1 - y0), abs(x2 - x1) + abs(y2 - y1)
        k = min(r, d0 / 2, d1 / 2)
        ax = x1 - (k if x1 > x0 else -k if x1 < x0 else 0)
        ay = y1 - (k if y1 > y0 else -k if y1 < y0 else 0)
        bx = x1 + (k if x2 > x1 else -k if x2 < x1 else 0)
        by = y1 + (k if y2 > y1 else -k if y2 < y1 else 0)
        out.append(f"L{ax:.1f},{ay:.1f} Q{x1:.1f},{y1:.1f} {bx:.1f},{by:.1f}")
    out.append(f"L{pts[-1][0]:.1f},{pts[-1][1]:.1f}")
    return " ".join(out)


def _svg(rm, prefix="../items/"):
    """The map as an SVG string, and its width and height. Stations link to prefix + <id>.html."""
    tracks, items = rm["tracks"], rm["items"]
    lay = _layout(rm)
    cols, W, H, lane_y, lane_h, pos = lay["cols"], lay["W"], lay["H"], lay["lane_y"], lay["lane_h"], lay["pos"]
    color = {t["id"]: t.get("color", "#888") for t in tracks}
    out = [f'<svg class="rm-svg" viewBox="0 0 {W:.0f} {H:.0f}" width="{W:.0f}" height="{H:.0f}" '
           f'xmlns="http://www.w3.org/2000/svg" role="img" aria-label="{html.escape(rm["title"])}">']
    # lanes and columns
    first_h = next((i for i, (c, _) in enumerate(cols) if c[0] == "h"), len(cols))
    for i, t in enumerate(tracks):
        out.append(f'<rect class="rm-lane rm-lane-{i % 2}" x="0" y="{lane_y[i]}" width="{W}" height="{lane_h[i]}"/>')
    for i, (c, name) in enumerate(cols):
        x, w = lay["col_x"][i], lay["nsub"][i] * SUB_W
        cls = "rm-col-now" if c == ("h", "doing") else ("rm-col-plan" if c[0] == "h" else "rm-col")
        out.append(f'<rect class="{cls}" x="{x}" y="0" width="{w}" height="{H}"/>')
    for i in range(len(tracks)):
        out.append(f'<line class="rm-lane-sep" x1="0" y1="{lane_y[i]}" x2="{W}" y2="{lane_y[i]}"/>')
    out.append(f'<line class="rm-lane-sep" x1="0" y1="{H - 4}" x2="{W}" y2="{H - 4}"/>')
    if first_h < len(cols):
        x = lay["col_x"][first_h]
        out.append(f'<line class="rm-today" x1="{x}" y1="6" x2="{x}" y2="{H}"/>')
    # edges: links to other tracks underneath, the track lines on top
    lanes_used = defaultdict(int)
    edges = []
    for it in items:
        for a in it["after"]:
            src = rm["byid"][a]
            same = bool(set(src["tracks"]) & set(it["tracks"]))
            edges.append((same, a, it["id"], color[src["tracks"][0]]))
    for same, a, b, c in sorted(edges, key=lambda e: e[0]):
        d = _path(_route(lay, a, b, lanes_used))
        out.append(f'<path class="rm-edge {"rm-edge-line" if same else "rm-edge-cross"}" data-from="{a}" '
                   f'data-to="{b}" d="{d}" stroke="{c}"/>')
    # stations
    for it in items:
        p = pos[it["id"]]
        x, y0, h = p["x"], p["y0"], p["y1"] - p["y0"]
        c = color[it["tracks"][0]]
        lines = _wrap(str(it.get("title", it["id"])), max_lines=2 if h < 2 * NODE_H else 4)
        cls = f'rm-node rm-{it["status"]}' + (" rm-merge" if it["merge"] else "")
        tip = f'{it.get("title", "")} — {STATUS[it["status"]]}' + (f', {it["date"]}' if it.get("date") else "")
        out.append(f'<a href="{prefix}{it["id"]}.html" class="rm-link"><g class="{cls}" data-id="{it["id"]}" '
                   f'data-up="{" ".join(it["after"])}" data-down="{" ".join(it["children"])}" style="--c:{c}">'
                   f'<title>{html.escape(tip)}</title>')
        if len(it["tracks"]) > 1:                         # across tracks: a band in each track's colour
            grad = f'g-{it["id"]}'
            stops = "".join(f'<stop offset="{k / max(1, len(it["tracks"]) - 1):.2f}" stop-color="{color[t]}"/>'
                            for k, t in enumerate(it["tracks"]))
            out.append(f'<defs><linearGradient id="{grad}" x1="0" y1="0" x2="0" y2="1">{stops}</linearGradient></defs>')
            out.append(f'<rect class="rm-box rm-box-span" x="{x}" y="{y0}" width="{NODE_W}" height="{h}" rx="9" '
                       f'style="stroke:url(#{grad})"/>')
        else:
            out.append(f'<rect class="rm-box" x="{x}" y="{y0}" width="{NODE_W}" height="{h}" rx="9"/>')
        ty = y0 + h / 2 - (len(lines) - 1) * 7.5 + 4
        for k, line in enumerate(lines):
            out.append(f'<text class="rm-text" x="{x + NODE_W / 2}" y="{ty + k * 15:.1f}" text-anchor="middle">'
                       f'{html.escape(line)}</text>')
        if it["merge"]:                                   # interchange: a ring like a transfer station
            out.append(f'<circle class="rm-ring" cx="{x + NODE_W}" cy="{y0}" r="6"/>')
        if it["status"] == "done":
            out.append(f'<text class="rm-check" x="{x + 8}" y="{y0 + 14}">✓</text>')
        out.append("</g></a>")
    # column heads and track names on top; the viewer keeps them in view while scrolling (viewer.js)
    out.append(f'<g class="rm-heads"><rect class="rm-sticky-bg" x="0" y="0" width="{W}" height="{HEAD_H}"/>')
    for i, (c, name) in enumerate(cols):
        x, w = lay["col_x"][i], lay["nsub"][i] * SUB_W
        out.append(f'<line class="rm-lane-sep" x1="{x}" y1="0" x2="{x}" y2="{HEAD_H}"/>'
                   f'<text class="rm-col-label" x="{x + w / 2}" y="26" text-anchor="middle">{html.escape(name)}</text>')
    out.append(f'<line class="rm-lane-sep" x1="0" y1="{HEAD_H}" x2="{W}" y2="{HEAD_H}"/>')
    out.append('</g><g class="rm-labels">')
    for i, t in enumerate(tracks):
        out.append(f'<rect class="rm-sticky-bg" x="0" y="{lane_y[i]}" width="{LABEL_W - 10}" height="{lane_h[i]}"/>'
                   f'<rect x="0" y="{lane_y[i]}" width="5" height="{lane_h[i]}" fill="{color[t["id"]]}"/>')
        for k, line in enumerate(_wrap(t["name"], LABEL_W - 26, 3)):
            out.append(f'<text class="rm-lane-label" x="14" y="{lane_y[i] + 22 + k * 16}">{html.escape(line)}</text>')
    for i in range(len(tracks)):
        out.append(f'<line class="rm-lane-sep" x1="0" y1="{lane_y[i]}" x2="{LABEL_W - 10}" y2="{lane_y[i]}"/>')
    out.append(f'<line class="rm-lane-sep" x1="{LABEL_W - 10}" y1="0" x2="{LABEL_W - 10}" y2="{H}"/>'
               f'<rect class="rm-sticky-bg" x="0" y="0" width="{LABEL_W - 10}" height="{HEAD_H}"/></g>')
    out.append("</svg>")
    return "".join(out), W, H


# ---- the viewer's data (roadmap/viewer/data.js) ----
def _ref_kind(ref, target):
    r = str(ref).strip()
    if target is None:
        return "text"
    if re.fullmatch(r"[#!]\d+", r):
        return "issue"
    if target.startswith("http"):
        return "web"
    for pre, kind in _PATH_KIND:
        if target.startswith(pre):
            return kind
    return "doc"


def _href(target, here=f"{DIR}/viewer"):
    """A docs .md path (with #anchor) -> the built page's URL relative to here."""
    if target.startswith("http"):
        return target
    path, _, anchor = target.partition("#")
    stem, name = posixpath.split(path)
    page = posixpath.join(stem, "index.html" if name in ("README.md", "index.md") else name[:-3] + ".html")
    return posixpath.relpath(page, here) + (f"#{anchor}" if anchor else "")


def _data_js(rm, docs_dir):
    svg, w, h = _svg(rm)
    tracks = {t["id"]: t["name"] for t in rm["tracks"]}
    items = {}
    for it in _ordered(rm, [i["id"] for i in rm["items"]]):
        refs = []
        for r in it["refs"]:
            label, target = resolve(r, docs_dir)
            kind = _ref_kind(r, target)
            refs.append({"kind": kind, "ref": str(r), "label": label, "href": _href(target) if target else None})
        u = rm["units"].get(it.get("unit"))
        items[it["id"]] = {
            "title": str(it.get("title", it["id"])), "status": it["status"], "statusLabel": STATUS[it["status"]],
            "when": _when(it), "tracks": [tracks[t] for t in it["tracks"]], "unit": it.get("unit") or "",
            "unitName": u["name"] if u else "", "summary": str(it.get("summary") or "").strip(),
            "after": it["after"], "children": it["children"], "refs": refs, "page": f"../items/{it['id']}.html"}
    data = {"title": rm["title"], "svg": svg, "width": w, "height": h, "items": items,
            "units": [{"id": k, "name": u["name"], "summary": u.get("summary", "")} for k, u in rm["units"].items()],
            "refKinds": REF_KINDS, "status": STATUS}
    return "window.ROADMAP = " + json.dumps(data, ensure_ascii=False) + ";\n"


def _embed(rm, page):
    """<!-- roadmap-map --> -> the viewer in a frame, as tall as the map."""
    viewer = posixpath.relpath(VIEWER, posixpath.dirname(page.file.dest_uri) or ".")
    _, _, h = _svg(rm)
    height = int(min(max(h + 70, 420), 1500))
    return (f'<div class="rm-inline"><div class="rm-inline__bar"><span>{html.escape(rm["title"])} · 역을 누르면 '
            f'옆에 상세와 관련 문서</span><a href="{viewer}" target="_blank">전체 화면</a></div>'
            f'<iframe class="rm-embed" style="height:{height}px" src="{viewer}?embed=1" '
            f'title="{html.escape(rm["title"])}" loading="lazy"></iframe></div>')


# ---- pages ----
def _st(it):
    return f'<span class="rm-st rm-st-{it["status"]}">{STATUS[it["status"]]}</span>'


def _when(it):
    if it["status"] in ("done", "dropped") and isinstance(it.get("date"), dt.date):
        return str(it["date"])
    return dict(HORIZON).get(it["status"], STATUS[it["status"]])


def _track_names(rm, it):
    names = {t["id"]: t["name"] for t in rm["tracks"]}
    return " + ".join(names[t] for t in it["tracks"])


def _ordered(rm, ids):
    """Items in flow order: by column, then date, then id."""
    cols = {c: i for i, (c, _) in enumerate(_columns(rm["items"]))}
    return sorted((rm["byid"][i] for i in ids), key=lambda it: (cols[it["column"]], str(it.get("date") or ""), it["id"]))


def _units_md(rm, prefix="items/"):
    out = []
    groups = defaultdict(list)
    for it in rm["items"]:
        groups[it.get("unit") or ""].append(it["id"])
    for uid in list(rm["units"]) + ([""] if groups.get("") else []):
        if not groups.get(uid):
            continue
        u = rm["units"].get(uid, {"name": "기타"})
        out.append(f'### {u["name"]}\n')
        if u.get("summary"):
            out.append(f'{u["summary"]}\n')
        chain = " → ".join(f'[{html.escape(str(it.get("title", it["id"])))}]({prefix}{it["id"]}.md) {_st(it)}'
                           for it in _ordered(rm, groups[uid]))
        out.append(chain + "\n")
    return "\n".join(out)


def _table_md(rm):
    rows = ["| 상태 | 언제 | 트랙 | 항목 | 업무 |", "| --- | --- | --- | --- | --- |"]
    for it in _ordered(rm, [i["id"] for i in rm["items"]]):
        u = rm["units"].get(it.get("unit"), {}).get("name", "")
        rows.append(f'| {_st(it)} | {_when(it)} | {_track_names(rm, it)} | '
                    f'[{it.get("title", it["id"])}](items/{it["id"]}.md) | {u} |')
    return "\n".join(rows)


def _item_md(rm, it, docs_dir):
    up = "../../"
    u = rm["units"].get(it.get("unit"))
    lines = [f'# {it.get("title", it["id"])}', "",
             '<div class="rm-card" markdown>', "",
             f'| 상태 | 언제 | 트랙 | 업무 |', "| --- | --- | --- | --- |",
             f'| {_st(it)} | {_when(it)} | {_track_names(rm, it)} | {u["name"] if u else "—"} |', "", "</div>", ""]
    if it.get("summary"):
        lines += [str(it["summary"]).strip(), ""]
    lines += ["## 흐름", ""]
    if it["after"]:
        lines.append("- **앞**: " + ", ".join(f'[{rm["byid"][a].get("title", a)}]({a}.md) {_st(rm["byid"][a])}'
                                              for a in it["after"]))
    if it["children"]:
        lines.append("- **뒤**: " + ", ".join(f'[{rm["byid"][c].get("title", c)}]({c}.md) {_st(rm["byid"][c])}'
                                              for c in it["children"]))
    if not it["after"] and not it["children"]:
        lines.append("- 이어지는 항목 없음")
    lines += ["", f"[로드맵에서 보기]({up}{DIR}/README.md)", ""]
    if it["refs"]:
        lines += ["## 관련 문서", ""]
        groups = defaultdict(list)
        for r in it["refs"]:
            label, target = resolve(r, docs_dir)
            if target is None:
                if re.fullmatch(r"(ADR|VR|EXP|P)-\d{4}|[GRA]\s?\d+.*|(?:배경|bg)\s?\d+|.*\.md.*", str(r)):
                    log.warning("roadmap: item %s: ref %r is no document", it["id"], r)
                groups["text"].append(str(r))
            elif target.startswith("http"):
                groups[_ref_kind(r, target)].append(f"[{label}]({target})")
            else:
                groups[_ref_kind(r, target)].append(f"[{label}]({up}{target})")
        for kind, name in REF_KINDS:
            if groups.get(kind):
                lines.append(f"- **{name}**: " + ", ".join(groups[kind]))
        lines.append("")
    if u:
        lines += [f'## 같은 업무: {u["name"]}', ""]
        if u.get("summary"):
            lines += [u["summary"], ""]
        sib = [i["id"] for i in rm["items"] if i.get("unit") == it.get("unit")]
        lines.append(" → ".join((f'**{s.get("title", s["id"])}**' if s["id"] == it["id"] else
                                 f'[{s.get("title", s["id"])}]({s["id"]}.md)') + f" {_st(s)}"
                                for s in _ordered(rm, sib)))
        lines.append("")
    return "\n".join(lines)


# ---- MkDocs events ----
def _fill_nav(nav, files):
    for item in nav or []:
        if isinstance(item, dict):
            for k, val in item.items():
                if isinstance(val, list):
                    if f"{DIR}/README.md" in val:
                        item[k] = files
                        return True
                    if _fill_nav(val, files):
                        return True
    return False


def on_config(config, **kwargs):
    if os.path.exists(os.path.join(config["docs_dir"], DATA)) and config["nav"]:
        pages = [f"{DIR}/{p}" for p in FIXED_PAGES]
        if not _fill_nav(config["nav"], pages):
            config["nav"].append({"로드맵": pages})
    return config


def on_files(files, config, **kwargs):
    url = str((config.get("extra") or {}).get("issues_url") or "")
    _issues[0] = url if not url or url.endswith("/") else url + "/"
    _index_docs(config["docs_dir"])
    _rm.clear()
    _rm.update(_load(config["docs_dir"]))
    if not _rm:
        return files
    data = files.get_file_from_path(DATA)
    if data is not None:
        files.remove(data)                       # the source, not a page or asset
    for it in _rm["items"]:
        f = File.generated(config, f"{DIR}/items/{it['id']}.md", content=_item_md(_rm, it, config["docs_dir"]))
        f.inclusion = InclusionLevel.NOT_IN_NAV
        files.append(f)
    files.append(File.generated(config, f"{DIR}/viewer/data.js", content=_data_js(_rm, config["docs_dir"])))
    return files


def on_page_markdown(markdown, page, config, **kwargs):
    if not _rm or not page.file.src_uri.startswith(DIR + "/"):
        return markdown
    if "<!-- roadmap-map -->" in markdown:
        markdown = markdown.replace("<!-- roadmap-map -->", _embed(_rm, page))
    if "<!-- roadmap-units -->" in markdown:
        markdown = markdown.replace("<!-- roadmap-units -->", _units_md(_rm))
    if "<!-- roadmap-table -->" in markdown:
        markdown = markdown.replace("<!-- roadmap-table -->", _table_md(_rm))
    return markdown

# ---------------- tab on / off (docs-kit.yml, hooks/kitconf.py) ----------------
import os as _os  # noqa: E402
import sys as _sys  # noqa: E402

_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import kitconf as _kitconf  # noqa: E402

_kitconf.gate(globals(), "roadmap")
