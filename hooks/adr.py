"""MkDocs hook: ADR (docs/adr/) rendering and bookkeeping, plus the C4 model.

- Nav: the "ADR" section of the project nav (appended if missing) is filled with the fixed pages
  (README, log, c4, guide, template) and every docs/adr/NNNN-*.md in number
  order, so new ADRs need no nav edit.
- Index: "<!-- adr-index -->" in docs/adr/README.md becomes a table of all
  ADRs (number, title, status, area, date) read from their front matter.
- Decision log: "<!-- adr-log -->" in docs/adr/log.md becomes one
  chronological table with each ADR's one-line `summary`.
- C4: docs/adr/c4-model.yml holds elements, relations and views.
  The standalone viewer docs/adr/viewer/ reads adr/viewer/data.json, which
  this hook writes after each build; "<!-- c4-app -->" in c4.md embeds it, and
  "<!-- c4-elements -->" a table of all elements. "<!-- c4-view: <id> -->" on any
  page embeds the viewer showing that view. Elements named in an ADR's
  `c4:` front matter are highlighted and linked both ways.
- Header: each ADR page gets a metadata card (status badge, date, deciders,
  area, architecture elements, supersedes / superseded by) under its title.
- Checks: missing or unknown front-matter values, duplicate numbers, file
  names that do not match the title number, and broken C4 references are
  logged as WARNING.

Front-matter fields and allowed values: docs/adr/guide.md. Styles:
assets/_kit/stylesheets/adr.css. Enabled by `hooks:` in mkdocs.base.yml.
Kit pages and assets (adr/README.md, guide, viewer, ...) are added to the
build by hooks/kit.py; ADR files and c4-model.yml come from the project.
"""
import html
import json
import logging
import os
import posixpath
import re

import yaml
from mkdocs.utils.meta import get_data

log = logging.getLogger("mkdocs.hooks.adr")

ADR_DIR = "adr"
NAV_TITLE = "ADR"
FIXED_PAGES = ["README.md", "log.md", "c4.md", "guide.md", "template.md"]
C4_MODEL = "c4-model.yml"
C4_PAGE = "c4.html"
VIEWER = "viewer/index.html"  # standalone viewer under docs/adr/viewer/, data.json written at build
STATUS = {
    "proposed": "제안",
    "accepted": "승인",
    "rejected": "기각",
    "deprecated": "폐기",
    "superseded": "대체됨",
}
AREAS = {}  # area id -> name: docs-kit.yml `areas` (hooks/kitconf.py), filled in on_config
KINDS = {"person": "사람", "system": "시스템", "container": "컨테이너", "component": "컴포넌트"}
# relation kinds: flow = always on the way (several solid edges into one element: all are needed),
# alt = one of these ways depending on the case, call = the source calls the target and gets an answer back
REL_KINDS = ("flow", "alt", "call")
REQUIRED = ("status", "date", "deciders", "area", "summary")
_adrs = {}  # number -> ADR, loaded once per build in on_pre_build
_c4 = {}    # {"el": {id: element}, "rel": [...], "views": {id: view}}
_FILE = re.compile(r"^(\d{4})-[a-z0-9-]+\.md$")
_TITLE = re.compile(r"^#\s+ADR-(\d{4})\.\s*(.+)$", re.M)


# ---- loading and checks --------------------------------------------------

def _adr_files(docs_dir):
    d = os.path.join(docs_dir, ADR_DIR)
    if not os.path.isdir(d):
        return []
    return sorted(f for f in os.listdir(d) if _FILE.match(f))


def _load(docs_dir):
    """Number -> {file, title, meta} for every ADR, with consistency checks."""
    adrs = {}
    for name in _adr_files(docs_dir):
        with open(os.path.join(docs_dir, ADR_DIR, name), encoding="utf-8") as f:
            body, meta = get_data(f.read())
        num = _FILE.match(name).group(1)
        m = _TITLE.search(body)
        if not m:
            log.warning("adr/%s: first heading must be '# ADR-%s. <제목>'", name, num)
            title = name
        else:
            title = m.group(2).strip()
            if m.group(1) != num:
                log.warning("adr/%s: title number ADR-%s does not match file name", name, m.group(1))
        if num in adrs:
            log.warning("adr/%s: number %s already used by %s", name, num, adrs[num]["file"])
        for key in REQUIRED:
            if not meta.get(key):
                log.warning("adr/%s: front matter '%s' is missing", name, key)
        if meta.get("status") and meta["status"] not in STATUS:
            log.warning("adr/%s: status '%s' is not one of %s", name, meta["status"], ", ".join(STATUS))
        if meta.get("area") and meta["area"] not in AREAS:
            log.warning("adr/%s: area '%s' is not one of %s", name, meta["area"], ", ".join(AREAS))
        if meta.get("status") == "superseded" and not meta.get("superseded_by"):
            log.warning("adr/%s: status superseded needs 'superseded_by'", name)
        adrs[num] = {"file": name, "title": title, "meta": meta}
    return adrs


def _load_c4(docs_dir):
    path = os.path.join(docs_dir, ADR_DIR, C4_MODEL)
    if not os.path.exists(path):
        return {"el": {}, "rel": [], "views": {}}
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    el = {}
    for e in data.get("elements", []):
        if e["id"] in el:
            log.warning("%s: element id '%s' is duplicated", C4_MODEL, e["id"])
        if e.get("kind") not in KINDS:
            log.warning("%s: element '%s' kind '%s' is not one of %s", C4_MODEL, e["id"], e.get("kind"), ", ".join(KINDS))
        el[e["id"]] = e
    for e in el.values():
        p = e.get("parent")
        if p and p not in el:
            log.warning("%s: element '%s' has unknown parent '%s'", C4_MODEL, e["id"], p)
            e["parent"] = None
    for e in el.values():  # external is inherited from the parent chain
        x = e
        while x and not x.get("external"):
            x = el.get(x.get("parent"))
        e["_ext"] = bool(x)
    rel = []
    for r in data.get("relations", []):
        bad = [k for k in ("from", "to") if r.get(k) not in el]
        if bad:
            log.warning("%s: relation %s -> %s has unknown %s", C4_MODEL, r.get("from"), r.get("to"), "/".join(bad))
            continue
        if r.get("kind", "flow") not in REL_KINDS:
            log.warning("%s: relation %s -> %s kind '%s' is not one of %s", C4_MODEL, r["from"], r["to"],
                        r.get("kind"), ", ".join(REL_KINDS))
            r["kind"] = "flow"
        rel.append(r)
    views = {}
    for v in data.get("views", []):
        if v.get("scope") and v["scope"] not in el:
            log.warning("%s: view '%s' has unknown scope '%s'", C4_MODEL, v["id"], v["scope"])
            continue
        views[v["id"]] = v
    return {"el": el, "rel": rel, "views": views}


def _adrs_by_element():
    out = {}
    for num, a in sorted(_adrs.items()):
        for eid in _list(a["meta"].get("c4") or []):
            if eid not in _c4["el"]:
                log.warning("adr/%s: c4 element '%s' is not in %s", a["file"], eid, C4_MODEL)
                continue
            out.setdefault(eid, []).append(num)
    return out


# ---- small helpers ------------------------------------------------------

def _list(value):
    return value if isinstance(value, list) else [value]


def _num(value):
    return f"{int(value):04d}" if str(value).isdigit() else str(value)


def _ref(adrs, value, prefix=""):
    num = _num(value)
    a = adrs.get(num)
    return f'<a href="{prefix}{a["file"][:-3]}.html">ADR-{num}</a>' if a else f"ADR-{num}"


def _badge(status):
    label = STATUS.get(status, status or "?")
    return f'<span class="adr-status adr-status--{status}">{label}</span>'


def _el_link(eid):
    e = _c4["el"].get(eid)
    name = html.escape(e["name"]) if e else eid
    return f'<a href="{VIEWER}#el={eid}" target="_blank">{name}</a>'


# ---- ADR pages ----------------------------------------------------------

def _index(adrs):
    if not adrs:
        return "_아직 작성된 ADR이 없습니다._"
    rows = ["| 번호 | 제목 | 상태 | 분야 | 날짜 |", "| --- | --- | --- | --- | --- |"]
    for num, a in sorted(adrs.items()):
        m = a["meta"]
        status = _badge(m.get("status"))
        if m.get("superseded_by"):
            status += f" → {_ref(adrs, m['superseded_by'])}"
        area = AREAS.get(m.get("area"), m.get("area", ""))
        rows.append(f"| [ADR-{num}]({a['file']}) | {a['title']} | {status} | {area} | {m.get('date', '')} |")
    counts = {}
    for a in adrs.values():
        s = a["meta"].get("status")
        counts[s] = counts.get(s, 0) + 1
    summary = " · ".join(f"{STATUS.get(s, s)} {n}" for s, n in counts.items())
    return "\n".join(rows) + f"\n\n총 {len(adrs)}건: {summary}"


def _decision_log(adrs):
    if not adrs:
        return "_아직 작성된 ADR이 없습니다._"
    rows = ["| # | 날짜 | 결정 | 상태 | 아키텍처 요소 |", "| --- | --- | --- | --- | --- |"]
    for num, a in sorted(adrs.items(), key=lambda kv: (str(kv[1]["meta"].get("date", "")), kv[0])):
        m = a["meta"]
        status = _badge(m.get("status"))
        if m.get("superseded_by"):
            status += f" → {_ref(adrs, m['superseded_by'])}"
        els = ", ".join(_el_link(e) for e in _list(m.get("c4") or []))
        summary = m.get("summary") or a["title"]
        rows.append(f"| [{num}]({a['file']}) | {m.get('date', '')} | {summary} | {status} | {els} |")
    return "\n".join(rows)


def _card(page, adrs):
    m = page.meta
    rows = [("상태", _badge(m.get("status")))]
    rows.append(("날짜", str(m.get("date", ""))))
    deciders = m.get("deciders") or []
    rows.append(("결정자", ", ".join(deciders) if isinstance(deciders, list) else str(deciders)))
    rows.append(("분야", AREAS.get(m.get("area"), m.get("area", ""))))
    if m.get("c4"):
        rows.append(("아키텍처 요소", ", ".join(_el_link(e) for e in _list(m["c4"]))))
    if m.get("supersedes"):
        rows.append(("대체한 결정", ", ".join(_ref(adrs, v) for v in _list(m["supersedes"]))))
    if m.get("superseded_by"):
        rows.append(("대체한 새 결정", _ref(adrs, m["superseded_by"])))
    if m.get("related"):
        rows.append(("관련 ADR", ", ".join(_ref(adrs, v) for v in _list(m["related"]))))
    cells = "".join(f"<dt>{k}</dt><dd>{v}</dd>" for k, v in rows)
    return f'<dl class="adr-meta">{cells}</dl>'


# ---- C4 viewer ----------------------------------------------------------
# The standalone viewer (adr/viewer/) draws the views; the hook works out what
# each view shows and writes it to adr/viewer/data.json after the build.

def _view_graph(v, by_el):
    """Nodes, edges and boxes of one view."""
    el, scope = _c4["el"], v.get("scope")
    children = {i for i, e in el.items() if (e.get("parent") or None) == scope}
    inside = children & set(v["include"]) if v.get("include") else children
    siblings = children - inside  # left out by `include`: drawn as placeholders

    def show(i):
        """Element that stands for `i` in this view, or None to hide it."""
        x = i
        while x is not None and x not in children:
            x = el[x].get("parent")
        if x is not None:
            return x
        if scope is None or i == scope:
            return None
        if v.get("outside") == "elements":  # outside the scope: the element itself (view option)
            return i
        while el[i].get("parent"):  # outside the scope: show its top-level system
            i = el[i]["parent"]
        return None if i == scope else i

    edges, kinds = {}, {}
    for r in _c4["rel"]:
        a, b = show(r["from"]), show(r["to"])
        if not a or not b or a == b:
            continue
        if scope and a not in inside and b not in inside:
            continue  # only relations that touch the view's own elements
        label = r["label"] + (f" [{r['tech']}]" if r.get("tech") else "")
        labels = edges.setdefault((a, b), [])
        if label not in labels:
            labels.append(label)
        kinds.setdefault((a, b), set()).add(r.get("kind", "flow"))
    shown = set(inside) | {x for ab in edges for x in ab}
    order = list(el)
    nodes = []
    for i in sorted(shown, key=order.index):
        role = "inside" if i in inside else "placeholder" if i in siblings else "outside"
        nodes.append({"id": i, "role": role, "box": scope if role != "outside" and scope else None})
    return {
        "id": v["id"], "title": v.get("title", v["id"]), "description": v.get("description", ""),
        "scope": scope, "direction": v.get("direction", "RIGHT"), "nodes": nodes,
        "edges": [{"from": a, "to": b, "labels": ls,
                   "kind": next(iter(kinds[(a, b)])) if len(kinds[(a, b)]) == 1 else "flow"}  # merged: solid
                  for (a, b), ls in edges.items()],
    }


def _plain(md):
    """Markdown fragment -> plain text (links, code, emphasis removed)."""
    md = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", md)
    md = re.sub(r"`|\*\*", "", md)  # code ticks and bold; `_` stays (identifiers like MY_ENV_VAR)
    return re.sub(r"\s+", " ", md).strip()


def _excerpt(body, heading, after=None, limit=240):
    """First paragraph or first two bullets of an ADR section (optionally of the
    part after a bold sub-heading such as **감수할 점**), as plain text."""
    m = re.search(rf"^##\s+{heading}\s*$(.*?)(?=^##\s|\Z)", body, re.M | re.S)
    if not m:
        return ""
    text = m.group(1).strip()
    if after:
        i = text.find(f"**{after}**")
        text = text[i + len(after) + 4:].strip() if i >= 0 else ""
    if re.match(r"(?:[-*]|\d+\.)\s", text):
        bullets = re.findall(r"^\s*(?:[-*]|\d+\.)\s+(?:\[[ x]\]\s+)?(.+)$", text, re.M)
        out = " ".join(_plain(b) for b in bullets[:2])
    else:
        out = _plain(text.split("\n\n")[0])
    return out if len(out) <= limit else out[: limit - 1].rstrip() + "…"


def _app_data(docs_dir):
    by_el = _adrs_by_element()
    views = [_view_graph(v, by_el) for v in _c4["views"].values()]
    drill = {}
    for v in views:
        if v["scope"]:
            drill.setdefault(v["scope"], []).append(v["id"])
    elements = {}
    for i, e in _c4["el"].items():
        elements[i] = {
            "name": e["name"], "kind": e.get("kind"), "kindLabel": KINDS.get(e.get("kind"), ""),
            "external": e["_ext"], "parent": e.get("parent"),
            "technology": e.get("technology", ""), "description": e.get("description", ""),
            "adrs": by_el.get(i, []), "views": drill.get(i, []),
        }
    adrs = {}
    for num, a in sorted(_adrs.items()):
        m = a["meta"]
        with open(os.path.join(docs_dir, ADR_DIR, a["file"]), encoding="utf-8") as f:
            body, _ = get_data(f.read())
        adrs[num] = {
            "title": _plain(a["title"]), "summary": m.get("summary") or _plain(a["title"]),
            "status": m.get("status"), "statusLabel": STATUS.get(m.get("status"), m.get("status")),
            "area": AREAS.get(m.get("area"), m.get("area", "")),
            "url": "../" + a["file"][:-3] + ".html", "date": str(m.get("date", "")),
            "context": _excerpt(body, "배경"), "decision": _excerpt(body, "결정"),
            "tradeoff": _excerpt(body, "결과", after="감수할 점"),
        }
    return {
        "views": views, "elements": elements, "adrs": adrs,
        "relations": [{"from": r["from"], "to": r["to"], "label": r["label"], "tech": r.get("tech", ""),
                       "kind": r.get("kind", "flow")} for r in _c4["rel"]],
    }


def _app_embed():
    return (
        '<div class="c4-launch">'
        f'<a class="md-button md-button--primary" href="{VIEWER}" target="_blank">아키텍처 뷰어 열기 (전체 화면)</a> '
        '<span>새 창에서 넓게 봅니다. 아래는 같은 뷰어의 미리보기입니다.</span></div>\n\n'
        f'<iframe class="c4-embed" src="{VIEWER}?embed=1" title="C4 아키텍처 뷰어" loading="lazy"></iframe>'
    )


def _elements(by_el):
    el = _c4["el"]
    order = [i for i, e in el.items() if not e.get("parent")]
    rows = []

    def add(i, depth):
        e = el[i]
        kind = ("외부 " if e["_ext"] else "") + KINDS.get(e.get("kind"), "")
        name = ("　" * depth) + html.escape(e["name"])
        adrs = ", ".join(_ref(_adrs, n) for n in by_el.get(i, []))
        rows.append(
            f'<tr id="c4-{i}"><td>{name}</td><td>{kind}</td><td>{html.escape(e.get("technology", ""))}</td>'
            f'<td>{html.escape(e.get("description", ""))}</td><td>{adrs}</td></tr>'
        )
        for c in [c for c, x in el.items() if x.get("parent") == i]:
            add(c, depth + 1)

    for i in order:
        add(i, 0)
    head = "<tr><th>요소</th><th>종류</th><th>기술</th><th>설명</th><th>관련 ADR</th></tr>"
    return f"<table>\n<thead>{head}</thead>\n<tbody>\n" + "\n".join(rows) + "\n</tbody>\n</table>"


# ---- MkDocs events ------------------------------------------------------

def on_config(config, **kwargs):
    files = [f"{ADR_DIR}/{p}" for p in FIXED_PAGES] + [
        f"{ADR_DIR}/{f}" for f in _adr_files(config["docs_dir"])
    ]
    for item in config["nav"] or []:
        if isinstance(item, dict) and NAV_TITLE in item:
            item[NAV_TITLE] = files
            break
    else:
        if config["nav"]:  # with no nav at all, MkDocs lists every page by itself
            config["nav"].append({NAV_TITLE: files})
    return config


def on_pre_build(config, **kwargs):
    _adrs.clear()
    _adrs.update(_load(config["docs_dir"]))
    _c4.clear()
    _c4.update(_load_c4(config["docs_dir"]))


_VIEW_LINE = re.compile(r"^[ \t]*<!--\s*c4-view:\s*([\w-]+)((?:\s+\w+=\S+)*)\s*-->[ \t]*$")
_FENCE = re.compile(r"^[ \t]*(`{3,}|~{3,})")


def _view_embeds(markdown, page):
    """<!-- c4-view: <view id> [height=N] --> on any page -> the C4 viewer showing that view."""
    if "c4-view:" not in markdown:
        return markdown
    viewer = posixpath.relpath(f"{ADR_DIR}/{VIEWER}", posixpath.dirname(page.file.dest_uri) or ".")
    out, fence = [], None
    for line in markdown.split("\n"):
        f = _FENCE.match(line)
        if f:
            if fence is None:
                fence = f.group(1)
            elif f.group(1)[0] == fence[0] and len(f.group(1)) >= len(fence):
                fence = None
        m = None if fence else _VIEW_LINE.match(line)
        if m:
            vid = m.group(1)
            opts = dict(kv.split("=", 1) for kv in m.group(2).split())
            if vid not in _c4["views"]:
                log.warning("%s: c4-view '%s' is not a view in %s", page.file.src_uri, vid, C4_MODEL)
            else:
                title = html.escape(_c4["views"][vid].get("title", vid))
                h = int(opts.get("height", 520))
                line = (f'<div class="c4-inline"><div class="c4-inline__bar"><span>C4 · {title}</span>'
                        f'<a href="{viewer}#view={vid}" target="_blank">전체 화면</a></div>'
                        f'<iframe class="c4-embed" style="height:{h}px" src="{viewer}?embed=1#view={vid}" '
                        f'title="C4: {title}" loading="lazy"></iframe></div>')
        out.append(line)
    return "\n".join(out)


def on_page_markdown(markdown, page, config, **kwargs):
    src = page.file.src_uri
    markdown = _view_embeds(markdown, page)
    if not src.startswith(ADR_DIR + "/"):
        return markdown
    name = src[len(ADR_DIR) + 1:]
    if name == "README.md":
        return markdown.replace("<!-- adr-index -->", _index(_adrs))
    if name == "log.md":
        return markdown.replace("<!-- adr-log -->", _decision_log(_adrs))
    if name == "c4.md":
        markdown = markdown.replace("<!-- c4-app -->", _app_embed())
        return markdown.replace("<!-- c4-elements -->", _elements(_adrs_by_element()))
    if _FILE.match(name):
        card = _card(page, _adrs)
        # Insert the card right after the title line.
        return re.sub(r"^(#\s.+)$", lambda m: m.group(1) + "\n\n" + card + "\n", markdown, count=1, flags=re.M)
    return markdown


def on_post_build(config, **kwargs):
    # The standalone viewer (adr/viewer/) reads this file.
    out = os.path.join(config["site_dir"], ADR_DIR, "viewer", "data.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    data = _app_data(config["docs_dir"])
    data["site"] = config["site_name"]
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)

# ---------------- tab on / off (docs-kit.yml, hooks/kitconf.py) ----------------
import os as _os  # noqa: E402
import sys as _sys  # noqa: E402

_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import kitconf as _kitconf  # noqa: E402

_on_config_kit = on_config


def on_config(config, **kwargs):  # noqa: F811
    AREAS.clear()
    AREAS.update(_kitconf.areas(config))   # docs-kit.yml `areas`
    return _on_config_kit(config, **kwargs)


_kitconf.gate(globals(), "adr")
