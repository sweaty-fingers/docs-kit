"""MkDocs hook: verification records (VR, docs/records/) — index, nav, cards, checks,
and links between records, ADRs and the C4 viewer.

A VR is one run that checked something (environment, build, device comparison)
with its evidence; it is added, not edited. File: docs/records/NNNN-*.md, title
"# VR-NNNN. <...>", evidence and reproduction in docs/records/assets/VR-NNNN/.

- Nav: the nav section that lists "records/README.md" (appended as "검증 기록" if
  missing) is filled with README, template and every VR in number order.
- Index: "<!-- vr-index -->" in docs/records/README.md becomes a table of all VRs.
- Card: each VR page gets a card under its title (result badge, date, by, area,
  host, commit, procedure, ADRs, C4 elements, reproduction files, supersedes /
  superseded by — the latter worked out from the other VRs).
- ADR pages: the card made by hooks/adr.py gets a "검증 기록" row listing the VRs
  whose `adr:` names it (this hook runs after adr.py).
- C4 viewer: adr/viewer/data.json (written by adr.py) gets `records` and, per
  element and per ADR, the VR numbers; the viewer shows them.
- Checks (WARNING): front-matter fields and values, title number, unknown ADR or
  VR references, missing reproduction files (assets/VR-NNNN/repro.sh, expected.txt).

Front matter: see the project's docs/records/template.md (kit default:
assets/records/template.md). Styles: assets/_kit/stylesheets/adr.css.
"""
import html
import json
import logging
import os
import re

from mkdocs.utils.meta import get_data

log = logging.getLogger("mkdocs.hooks.records")

DIR = "records"
NAV_TITLE = "검증 기록"
FIXED_PAGES = ["README.md", "template.md"]
RESULT = {"pass": "통과", "partial": "부분 통과", "fail": "실패"}
AREAS = {}  # same list as hooks/adr.py: docs-kit.yml `areas`, filled in on_config
REQUIRED = ("result", "date", "by", "area", "subject")
_FILE = re.compile(r"^(\d{4})-[a-z0-9-]+\.md$")
_TITLE = re.compile(r"^#\s+VR-(\d{4})\.\s*(.+)$", re.M)
_ADR_FILE = re.compile(r"^(\d{4})-[a-z0-9-]+\.md$")
_vrs = {}    # "0001" -> {file, title, meta, superseded_by}
_adrs = {}   # "0001" -> file name (for links)


def _files(docs_dir, sub, pattern):
    d = os.path.join(docs_dir, sub)
    return sorted(f for f in os.listdir(d) if pattern.match(f)) if os.path.isdir(d) else []


def _list(v):
    return [] if v is None else v if isinstance(v, list) else [v]


def _num(v):
    s = str(v).upper().replace("VR-", "").replace("ADR-", "")
    return f"{int(s):04d}" if s.isdigit() else s


def _load(docs_dir):
    adrs = {_ADR_FILE.match(f).group(1): f for f in _files(docs_dir, "adr", _ADR_FILE)}
    vrs = {}
    for name in _files(docs_dir, DIR, _FILE):
        with open(os.path.join(docs_dir, DIR, name), encoding="utf-8") as f:
            body, meta = get_data(f.read())
        num = _FILE.match(name).group(1)
        m = _TITLE.search(body)
        title = m.group(2).strip() if m else name
        where = f"{DIR}/{name}"
        if not m:
            log.warning("%s: first heading must be '# VR-%s. <제목>'", where, num)
        elif m.group(1) != num:
            log.warning("%s: title number VR-%s does not match file name", where, m.group(1))
        if num in vrs:
            log.warning("%s: number %s already used by %s", where, num, vrs[num]["file"])
        for key in REQUIRED:
            if not meta.get(key):
                log.warning("%s: front matter '%s' is missing", where, key)
        if meta.get("result") and meta["result"] not in RESULT:
            log.warning("%s: result '%s' is not one of %s", where, meta["result"], ", ".join(RESULT))
        if meta.get("area") and meta["area"] not in AREAS:
            log.warning("%s: area '%s' is not one of %s", where, meta["area"], ", ".join(AREAS))
        for a in _list(meta.get("adr")):
            if _num(a) not in adrs:
                log.warning("%s: adr '%s' has no docs/adr/%s-*.md", where, a, _num(a))
        ev = os.path.join(docs_dir, DIR, "assets", f"VR-{num}")
        for f in ("repro.sh", "expected.txt"):
            if not os.path.exists(os.path.join(ev, f)):
                log.warning("%s: reproduction file %s/assets/VR-%s/%s is missing", where, DIR, num, f)
        vrs[num] = {"file": name, "title": title, "meta": meta, "superseded_by": []}
    for num, v in vrs.items():
        for s in _list(v["meta"].get("supersedes")):
            s = _num(s)
            if s in vrs:
                vrs[s]["superseded_by"].append(num)
            else:
                log.warning("%s/%s: supersedes VR-%s, which does not exist", DIR, v["file"], s)
    return adrs, vrs


# ---- rendering ----------------------------------------------------------

def _badge(result):
    return f'<span class="vr-result vr-result--{result}">{RESULT.get(result, result or "?")}</span>'


def _vr_link(num, prefix=""):
    v = _vrs.get(num)
    return f'<a href="{prefix}{v["file"][:-3]}.html">VR-{num}</a>' if v else f"VR-{num}"


def _adr_link(num, prefix):
    f = _adrs.get(_num(num))
    return f'<a href="{prefix}{f[:-3]}.html">ADR-{_num(num)}</a>' if f else f"ADR-{_num(num)}"


def _index():
    if not _vrs:
        return "_아직 작성된 검증 기록이 없습니다._"
    rows = ["| VR | 결과 | 날짜 | 분야 | 확인한 것 | 근거가 되는 ADR | 절차 |", "| --- | --- | --- | --- | --- | --- | --- |"]
    for num, v in sorted(_vrs.items()):
        m = v["meta"]
        res = _badge(m.get("result"))
        if v["superseded_by"]:
            res += " → " + ", ".join(_vr_link(n) for n in v["superseded_by"])
        adrs = ", ".join(_adr_link(a, "../adr/") for a in _list(m.get("adr")))
        rows.append(
            f"| [VR-{num}]({v['file']}) | {res} | {m.get('date', '')} | {AREAS.get(m.get('area'), m.get('area', ''))} "
            f"| {m.get('subject') or v['title']} | {adrs} | {m.get('guide', '')} |"
        )
    counts = {}
    for v in _vrs.values():
        counts[v["meta"].get("result")] = counts.get(v["meta"].get("result"), 0) + 1
    return "\n".join(rows) + f"\n\n총 {len(_vrs)}건: " + " · ".join(f"{RESULT.get(k, k)} {n}" for k, n in counts.items())


def _card(num):
    v = _vrs[num]
    m = v["meta"]
    rows = [("결과", _badge(m.get("result"))), ("날짜", str(m.get("date", "")))]
    by = m.get("by") or []
    rows.append(("실행", ", ".join(by) if isinstance(by, list) else str(by)))
    rows.append(("분야", AREAS.get(m.get("area"), m.get("area", ""))))
    for key, label in (("host", "장비"), ("commit", "저장소"), ("guide", "절차")):
        if m.get(key):
            rows.append((label, html.escape(str(m[key]))))
    if m.get("adr"):
        rows.append(("근거가 되는 ADR", ", ".join(_adr_link(a, "../adr/") for a in _list(m["adr"]))))
    if m.get("c4"):
        rows.append(("아키텍처 요소", ", ".join(
            f'<a href="../adr/viewer/index.html#el={e}" target="_blank">{html.escape(str(e))}</a>' for e in _list(m["c4"]))))
    rows.append(("재현", f'<a href="assets/VR-{num}/repro.sh">repro.sh</a>, '
                         f'<a href="assets/VR-{num}/expected.txt">expected.txt</a>'))
    if m.get("supersedes"):
        rows.append(("대신하는 기록", ", ".join(_vr_link(_num(s)) for s in _list(m["supersedes"]))))
    if v["superseded_by"]:
        rows.append(("이 기록을 대신하는 새 기록", ", ".join(_vr_link(n) for n in v["superseded_by"])))
    cells = "".join(f"<dt>{k}</dt><dd>{val}</dd>" for k, val in rows)
    cls = " vr-meta--superseded" if v["superseded_by"] else ""
    return f'<dl class="adr-meta vr-meta{cls}">{cells}</dl>'


def _vrs_for_adr(adr_num):
    return [n for n, v in sorted(_vrs.items()) if adr_num in [_num(a) for a in _list(v["meta"].get("adr"))]]


# ---- MkDocs events ------------------------------------------------------

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
    # README and template always exist: the project's, or the kit's (hooks/kit.py adds them).
    files = [f"{DIR}/{p}" for p in FIXED_PAGES] + [f"{DIR}/{f}" for f in _files(config["docs_dir"], DIR, _FILE)]
    if config["nav"] and not _fill_nav(config["nav"], files):
        config["nav"].append({NAV_TITLE: files})
    return config


def on_pre_build(config, **kwargs):
    adrs, vrs = _load(config["docs_dir"])
    _adrs.clear(); _adrs.update(adrs)
    _vrs.clear(); _vrs.update(vrs)


def on_page_markdown(markdown, page, config, **kwargs):
    src = page.file.src_uri
    if src == f"{DIR}/README.md":
        return markdown.replace("<!-- vr-index -->", _index())
    if src.startswith(DIR + "/"):
        m = _FILE.match(src[len(DIR) + 1:])
        if m and m.group(1) in _vrs:
            return re.sub(r"^(#\s.+)$", lambda t: t.group(1) + "\n\n" + _card(m.group(1)) + "\n",
                          markdown, count=1, flags=re.M)
        return markdown
    if src.startswith("adr/"):
        m = _ADR_FILE.match(src[4:])
        if m:
            nums = _vrs_for_adr(m.group(1))
            if nums:  # add a row to the card that hooks/adr.py put under the title
                row = "<dt>검증 기록</dt><dd>" + ", ".join(
                    _vr_link(n, "../records/") + " " + _badge(_vrs[n]["meta"].get("result")) for n in nums) + "</dd>"
                markdown = markdown.replace("</dl>", row + "</dl>", 1)
    return markdown


def on_post_build(config, **kwargs):
    path = os.path.join(config["site_dir"], "adr", "viewer", "data.json")
    if not os.path.exists(path) or not _vrs:
        return
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    data["records"] = {
        n: {"title": v["title"], "subject": v["meta"].get("subject") or v["title"],
            "result": v["meta"].get("result"), "resultLabel": RESULT.get(v["meta"].get("result"), ""),
            "date": str(v["meta"].get("date", "")), "url": f"../../{DIR}/{v['file'][:-3]}.html",
            "supersededBy": v["superseded_by"]}
        for n, v in sorted(_vrs.items())
    }
    for n, v in sorted(_vrs.items()):
        for e in _list(v["meta"].get("c4")):
            if e in data.get("elements", {}):
                data["elements"][e].setdefault("records", []).append(n)
        for a in _list(v["meta"].get("adr")):
            if _num(a) in data.get("adrs", {}):
                data["adrs"][_num(a)].setdefault("records", []).append(n)
    with open(path, "w", encoding="utf-8") as f:
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


_kitconf.gate(globals(), "records")
