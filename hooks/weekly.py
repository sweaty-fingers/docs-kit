"""MkDocs hook: weekly reports (docs/weekly/) — list, nav, cards, work threads, checks.

A weekly report covers the time since the previous report, organised by WORK (a work item =
an issue-tracker milestone), not by day. File: docs/weekly/YYYY-MM-DD.md (the writing date),
title "# YYYY-MM-DD 주간 보고". Each work item is a "### N.M <name>" heading under
"## 3. 업무별 진행" with the bullets **배경**, **한 일**, **결과**, **다음** (and optional **막힌 것**).

- Nav: the nav section that lists "weekly/README.md" is filled with README (list), threads.md
  (업무별 흐름), template.md and every report, newest first. Appended as "주간 보고" when the
  project has no such section (the tab is on: docs-kit.yml, hooks/kitconf.py).
- List: "<!-- weekly-index -->" becomes a table (date, period, status, work items).
- Threads: "<!-- weekly-threads -->" (threads.md) becomes, per work item, every report's
  한 일 / 결과 newest first, with links to the report section. One work item = one heading name in
  every report, so a work item reads as one story across weeks instead of being scattered.
- Card: each report gets a card under its title (period, status, by, meeting, commit, previous / next).
- Links: in weekly pages, plain issue numbers (#12), merge requests (!27; with `extra.issues_url`) and
  document numbers (VR-0004, ADR-0011, EXP-0001, P-0001) become links. Code and existing links are left as-is.
- Checks (WARNING): front matter, file name = date, title, `from` = the previous report's date,
  `commit` when published, missing bullets in a work item.
"""
import html
import logging
import os
import re

from mkdocs.utils.meta import get_data
from pymdownx.slugs import slugify

log = logging.getLogger("mkdocs.hooks.weekly")

DIR = "weekly"
NAV_TITLE = "주간 보고"
FIXED_PAGES = ["README.md", "threads.md", "template.md"]
STATUS = {"draft": ("작성 중", "running"), "published": ("발행", "done")}
REQUIRED = ("date", "from", "status", "by")
BULLETS = ("배경", "한 일", "결과", "다음")
_FILE = re.compile(r"^(\d{4}-\d{2}-\d{2})\.md$")
_TITLE = re.compile(r"^#\s+(\d{4}-\d{2}-\d{2})\s+주간 보고\s*$", re.M)
_H2 = re.compile(r"^##\s+(?:\d+\.\s*)?(.+?)\s*$")
_H3 = re.compile(r"^###\s+(?:[\d.]+\s+)?(.+?)\s*$")
_BULLET = re.compile(r"^- \*\*(.+?)\*\*\s*:?\s*(.*)$")
_slug = slugify(case="lower")
_DOCS = {"VR": "records", "ADR": "adr", "EXP": "experiments", "P": "publications"}
_NUMFILE = re.compile(r"^(\d{4})-[a-z0-9-]+\.md$")
_KEEP = re.compile(r"(```.*?```|`[^`\n]*`|!?\[[^\]]*\]\([^)]*\)|<[^>\n]+>|^[ \t]*#+[ \t][^\n]*$)", re.S | re.M)
_REF = re.compile(r"(?<![\w&#/!\[])(?:#(\d{1,5})|!(\d{1,5})|\b(VR|ADR|EXP|P)-(\d{4}))(?![\w-])")
_issues_url = [""]
_doc_files = {}   # ("VR", "0004") -> "records/0004-....md"
_reports = {}   # "2026-11-11" -> {file, meta, work: [(name, anchor, {bullet: text})]}


def _files(docs_dir):
    d = os.path.join(docs_dir, DIR)
    return sorted((f for f in os.listdir(d) if _FILE.match(f)), reverse=True) if os.path.isdir(d) else []


def _work_items(body, where):
    """### headings under the "업무별 진행" section -> [(name, anchor, {bullet: text})]."""
    items, cur, in_work, bullet = [], None, False, None
    for line in body.splitlines():
        if line.startswith("## "):
            in_work = "업무별 진행" in (_H2.match(line).group(1) if _H2.match(line) else "")
            cur = None
            continue
        if not in_work:
            continue
        if line.startswith("### "):
            heading = line[4:].strip()
            name = _H3.match(line).group(1)
            cur = (name, _slug(heading, "-"), {})
            items.append(cur)
            bullet = None
            continue
        if cur is None:
            continue
        m = _BULLET.match(line)
        if m:
            bullet = m.group(1).strip()
            cur[2][bullet] = m.group(2).strip()
        elif bullet and line.startswith("  ") and line.strip():
            cur[2][bullet] += "\n" + line.rstrip()
        elif line.startswith("- ") or (line.strip() and not line.startswith(" ")):
            bullet = None
    for name, _, b in items:
        missing = [k for k in BULLETS if k not in b]
        if missing:
            log.warning("%s: work item '%s' has no %s", where, name, ", ".join(f"**{k}**" for k in missing))
    return items


def _load(docs_dir):
    out = {}
    names = _files(docs_dir)
    for i, name in enumerate(names):
        date = _FILE.match(name).group(1)
        where = f"{DIR}/{name}"
        with open(os.path.join(docs_dir, DIR, name), encoding="utf-8") as f:
            body, meta = get_data(f.read())
        meta = {k: (str(v) if k in ("date", "from", "meeting", "commit") and v is not None else v)
                for k, v in meta.items()}
        for key in REQUIRED:
            if not meta.get(key):
                log.warning("%s: front matter '%s' is missing", where, key)
        if meta.get("date") and meta["date"] != date:
            log.warning("%s: date %s does not match the file name", where, meta["date"])
        if meta.get("status") and meta["status"] not in STATUS:
            log.warning("%s: status '%s' is not one of %s", where, meta["status"], ", ".join(STATUS))
        if meta.get("status") == "published" and not meta.get("commit"):
            log.warning("%s: published without 'commit' (the snapshot it reports on)", where)
        prev = names[i + 1][:-3] if i + 1 < len(names) else None
        if prev and meta.get("from") and meta["from"] != prev:
            log.warning("%s: from %s is not the previous report's date %s", where, meta["from"], prev)
        m = _TITLE.search(body)
        if not m:
            log.warning("%s: first heading must be '# %s 주간 보고'", where, date)
        elif m.group(1) != date:
            log.warning("%s: title date %s does not match the file name", where, m.group(1))
        if not re.search(r"^##\s+.*업무별 진행", body, re.M):
            log.warning("%s: no '## 3. 업무별 진행' section", where)
        out[date] = {"file": name, "meta": meta, "prev": prev,
                     "next": names[i - 1][:-3] if i > 0 else None, "work": _work_items(body, where)}
    return out


def _badge(status):
    label, cls = STATUS.get(status, (status or "?", "planned"))
    return f'<span class="exp-status exp-status--{cls}">{label}</span>'


def _period(r):
    return f"{r['meta'].get('from', '?')} ~ {r['meta'].get('date', '?')}"


def _index():
    if not _reports:
        return "_아직 작성된 주간 보고가 없습니다._"
    rows = ["| 보고 | 기간 | 상태 | 다룬 업무 |", "| --- | --- | --- | --- |"]
    for date, r in _reports.items():
        work = ", ".join(f"[{html.escape(n)}]({r['file']}#{a})" for n, a, _ in r["work"])
        rows.append(f"| [{date}]({r['file']}) | {_period(r)} | {_badge(r['meta'].get('status'))} | {work} |")
    return "\n".join(rows)


def _threads():
    order, by_work = [], {}
    for date, r in _reports.items():            # newest first
        for name, anchor, b in r["work"]:
            if name not in by_work:
                order.append(name)
                by_work[name] = []
            by_work[name].append((date, r, anchor, b))
    if not order:
        return "_아직 작성된 주간 보고가 없습니다._"
    out = ["업무: " + " · ".join(f"[{html.escape(n)}](#{_slug(n, '-')})" for n in order), ""]
    for name in order:
        out += [f"## {name}", ""]
        for date, r, anchor, b in by_work[name]:
            out.append(f"**[{date}]({r['file']}#{anchor})** ({_period(r)})")
            out.append("")
            for key in ("한 일", "결과", "막힌 것"):
                if b.get(key):
                    out.append(f"- **{key}**: {b[key]}")
            out.append("")
    return "\n".join(out)


def _card(date):
    r = _reports[date]
    m = r["meta"]
    by = m.get("by") or []
    rows = [("기간", _period(r)), ("상태", _badge(m.get("status"))),
            ("작성", html.escape(", ".join(by) if isinstance(by, list) else str(by)))]
    if m.get("meeting"):
        rows.append(("회의", html.escape(m["meeting"])))
    if m.get("commit"):
        rows.append(("기준 커밋", f"<code>{html.escape(m['commit'])}</code>"))
    nav = []
    if r["prev"]:
        nav.append(f'<a href="{r["prev"]}.html">← {r["prev"]}</a>')
    if r["next"]:
        nav.append(f'<a href="{r["next"]}.html">{r["next"]} →</a>')
    nav.append('<a href="threads.html">업무별 흐름</a>')
    rows.append(("다른 보고", " · ".join(nav)))
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
    reports = _files(config["docs_dir"])
    files = [f"{DIR}/{p}" for p in FIXED_PAGES] + [f"{DIR}/{f}" for f in reports]
    if config["nav"] and not _fill_nav(config["nav"], files):
        config["nav"].append({NAV_TITLE: files})     # the tab is on (docs-kit.yml): show it, even before the first report
    return config


def _link_refs(markdown):
    """#12, !27, VR-0004 ... -> links (weekly pages are written from issue and document numbers)."""
    issues = _issues_url[0]
    mrs = issues.replace("/issues/", "/merge_requests/") if issues else ""

    def one(m):
        if m.group(1) and issues:
            return f"[#{m.group(1)}]({issues}{m.group(1)})"
        if m.group(2) and mrs:
            return f"[!{m.group(2)}]({mrs}{m.group(2)})"
        if m.group(3):
            f = _doc_files.get((m.group(3), m.group(4)))
            if f:
                return f"[{m.group(3)}-{m.group(4)}](../{f})"
        return m.group(0)

    parts = _KEEP.split(markdown)
    return "".join(p if i % 2 else _REF.sub(one, p) for i, p in enumerate(parts))


def on_pre_build(config, **kwargs):
    url = str((config.get("extra") or {}).get("issues_url") or "")
    _issues_url[0] = url if not url or url.endswith("/") else url + "/"
    _doc_files.clear()
    for kind, sub in _DOCS.items():
        d = os.path.join(config["docs_dir"], sub)
        for f in (os.listdir(d) if os.path.isdir(d) else []):
            m = _NUMFILE.match(f)
            if m:
                _doc_files[(kind, m.group(1))] = f"{sub}/{f}"
    _reports.clear()
    _reports.update(_load(config["docs_dir"]))


def on_page_markdown(markdown, page, config, **kwargs):
    src = page.file.src_uri
    if src == f"{DIR}/README.md":
        return markdown.replace("<!-- weekly-index -->", _index())
    if src == f"{DIR}/threads.md":
        return markdown.replace("<!-- weekly-threads -->", _link_refs(_threads()))
    if src.startswith(DIR + "/"):
        m = _FILE.match(src[len(DIR) + 1:])
        if m and m.group(1) in _reports:
            markdown = _link_refs(markdown)
            return re.sub(r"^(#\s.+)$", lambda t: t.group(1) + "\n\n" + _card(m.group(1)) + "\n",
                          markdown, count=1, flags=re.M)
    return markdown

# ---------------- tab on / off (docs-kit.yml, hooks/kitconf.py) ----------------
import os as _os  # noqa: E402
import sys as _sys  # noqa: E402

_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import kitconf as _kitconf  # noqa: E402

_kitconf.gate(globals(), "weekly")
