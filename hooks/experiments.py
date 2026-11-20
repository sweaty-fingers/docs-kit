"""MkDocs hook: experiments (EXP, docs/experiments/) — list page, nav, cards, checks, ADR links.

An EXP is one research question or hypothesis; its runs are rows in the page, not pages.
File: docs/experiments/NNNN-*.md, title "# EXP-NNNN. <...>".

- Nav: the nav section that lists "experiments/README.md" (appended as "실험" if missing) is
  filled with list.md (실험 목록), README.md (the project's experiment plan), template.md and
  every EXP in number order.
- List: "<!-- exp-index -->" (kit page experiments/list.md) becomes a table of all EXPs.
- Card: each EXP page gets a card under its title (status, started, by, area, question, ADRs, issues).
- Issues: with `extra.issues_url` in mkdocs.yml (e.g. https://gitlab.example.com/group/project/-/issues/),
  issue numbers in the list and card link to the tracker.
- ADR pages: the card made by hooks/adr.py gets an "실험" row listing the EXPs whose `adr:` names it.
- Checks (WARNING): front-matter fields and values, title number, unknown ADR references.

Front matter: see docs/experiments/template.md (kit default: assets/experiments/template.md).
"""
import html
import logging
import os
import re

from mkdocs.utils.meta import get_data

log = logging.getLogger("mkdocs.hooks.experiments")

DIR = "experiments"
NAV_TITLE = "실험"
FIXED_PAGES = ["list.md", "README.md", "template.md"]
STATUS = {"planned": "계획", "running": "진행 중", "done": "끝남", "stopped": "중단"}
AREAS = {}  # same list as hooks/adr.py: docs-kit.yml `areas`, filled in on_config
REQUIRED = ("status", "started", "by", "area", "question")
_FILE = re.compile(r"^(\d{4})-[a-z0-9-]+\.md$")
_TITLE = re.compile(r"^#\s+EXP-(\d{4})\.\s*(.+)$", re.M)
_ADR_FILE = re.compile(r"^(\d{4})-[a-z0-9-]+\.md$")
_exps = {}   # "0001" -> {file, title, meta}
_adrs = {}   # "0001" -> file name
_issues_url = [""]


def _files(docs_dir, sub, pattern):
    d = os.path.join(docs_dir, sub)
    return sorted(f for f in os.listdir(d) if pattern.match(f)) if os.path.isdir(d) else []


def _list(v):
    return [] if v is None else v if isinstance(v, list) else [v]


def _num(v):
    s = str(v).upper().replace("ADR-", "").replace("EXP-", "")
    return f"{int(s):04d}" if s.isdigit() else s


def _load(docs_dir):
    adrs = {_ADR_FILE.match(f).group(1): f for f in _files(docs_dir, "adr", _ADR_FILE)}
    exps = {}
    for name in _files(docs_dir, DIR, _FILE):
        with open(os.path.join(docs_dir, DIR, name), encoding="utf-8") as f:
            body, meta = get_data(f.read())
        num = _FILE.match(name).group(1)
        m = _TITLE.search(body)
        where = f"{DIR}/{name}"
        if not m:
            log.warning("%s: first heading must be '# EXP-%s. <제목>'", where, num)
        elif m.group(1) != num:
            log.warning("%s: title number EXP-%s does not match file name", where, m.group(1))
        for key in REQUIRED:
            if not meta.get(key):
                log.warning("%s: front matter '%s' is missing", where, key)
        if meta.get("status") and meta["status"] not in STATUS:
            log.warning("%s: status '%s' is not one of %s", where, meta["status"], ", ".join(STATUS))
        if meta.get("area") and meta["area"] not in AREAS:
            log.warning("%s: area '%s' is not one of %s", where, meta["area"], ", ".join(AREAS))
        for a in _list(meta.get("adr")):
            if _num(a) not in adrs:
                log.warning("%s: adr '%s' has no docs/adr/%s-*.md", where, a, _num(a))
        exps[num] = {"file": name, "title": m.group(2).strip() if m else name, "meta": meta}
    return adrs, exps


def _issues(v):
    base = _issues_url[0]
    return ", ".join(f'<a href="{html.escape(base)}{i}" target="_blank" rel="noopener">#{i}</a>' if base else f"#{i}"
                     for i in _list(v))


def _badge(status):
    return f'<span class="exp-status exp-status--{status}">{STATUS.get(status, status or "?")}</span>'


def _adr_link(num, prefix):
    f = _adrs.get(_num(num))
    return f'<a href="{prefix}{f[:-3]}.html">ADR-{_num(num)}</a>' if f else f"ADR-{_num(num)}"


def _index():
    if not _exps:
        return "_아직 작성된 실험 기록이 없습니다._"
    rows = ["| EXP | 상태 | 시작 | 분야 | 질문 | 실험 기록 제목 | 관련 ADR | 이슈 |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    for num, e in sorted(_exps.items()):
        m = e["meta"]
        adrs = ", ".join(_adr_link(a, "../adr/") for a in _list(m.get("adr")))
        issues = _issues(m.get("issues"))
        rows.append(f"| [EXP-{num}]({e['file']}) | {_badge(m.get('status'))} | {m.get('started', '')} "
                    f"| {AREAS.get(m.get('area'), m.get('area', ''))} | {m.get('question', '')} | {e['title']} "
                    f"| {adrs} | {issues} |")
    counts = {}
    for e in _exps.values():
        counts[e["meta"].get("status")] = counts.get(e["meta"].get("status"), 0) + 1
    return "\n".join(rows) + f"\n\n총 {len(_exps)}건: " + " · ".join(f"{STATUS.get(k, k)} {n}" for k, n in counts.items())


def _card(num):
    m = _exps[num]["meta"]
    by = m.get("by") or []
    rows = [("상태", _badge(m.get("status"))), ("시작", str(m.get("started", ""))),
            ("실행", ", ".join(by) if isinstance(by, list) else str(by)),
            ("분야", AREAS.get(m.get("area"), m.get("area", ""))),
            ("질문", html.escape(str(m.get("question", ""))))]
    if m.get("adr"):
        rows.append(("관련 ADR", ", ".join(_adr_link(a, "../adr/") for a in _list(m["adr"]))))
    if m.get("issues"):
        rows.append(("이슈", _issues(m["issues"])))
    return '<dl class="adr-meta exp-meta">' + "".join(f"<dt>{k}</dt><dd>{v}</dd>" for k, v in rows) + "</dl>"


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
    # list, README and template always exist: the project's, or the kit's (hooks/kit.py adds them).
    files = [f"{DIR}/{p}" for p in FIXED_PAGES] + [f"{DIR}/{f}" for f in _files(config["docs_dir"], DIR, _FILE)]
    if config["nav"] and not _fill_nav(config["nav"], files):
        config["nav"].append({NAV_TITLE: files})
    return config


def on_pre_build(config, **kwargs):
    url = str((config.get("extra") or {}).get("issues_url") or "")
    _issues_url[0] = url if not url or url.endswith("/") else url + "/"
    adrs, exps = _load(config["docs_dir"])
    _adrs.clear(); _adrs.update(adrs)
    _exps.clear(); _exps.update(exps)


def on_page_markdown(markdown, page, config, **kwargs):
    src = page.file.src_uri
    if src == f"{DIR}/list.md":
        return markdown.replace("<!-- exp-index -->", _index())
    if src.startswith(DIR + "/"):
        m = _FILE.match(src[len(DIR) + 1:])
        if m and m.group(1) in _exps:
            return re.sub(r"^(#\s.+)$", lambda t: t.group(1) + "\n\n" + _card(m.group(1)) + "\n",
                          markdown, count=1, flags=re.M)
        return markdown
    if src.startswith("adr/"):
        m = _ADR_FILE.match(src[4:])
        if m:
            nums = [n for n, e in sorted(_exps.items()) if m.group(1) in [_num(a) for a in _list(e["meta"].get("adr"))]]
            if nums:  # add a row to the card that hooks/adr.py put under the title
                row = "<dt>실험</dt><dd>" + ", ".join(
                    f'<a href="../{DIR}/{_exps[n]["file"][:-3]}.html">EXP-{n}</a> {_badge(_exps[n]["meta"].get("status"))}'
                    for n in nums) + "</dd>"
                markdown = markdown.replace("</dl>", row + "</dl>", 1)
    return markdown

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


_kitconf.gate(globals(), "experiments")
