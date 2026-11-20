"""MkDocs hook: publications (docs/publications/) — finished pieces of writing that
combine canonical content for a reader: overviews, reports, release notes, notes, slides.

File docs/publications/NNNN-*.md, title "# P-NNNN. <제목>". Facts and decisions live in
the canonical documents (arc42 sections, ADR, EXP, VR, MC); a publication only
combines, quotes (pymdownx.snippets "--8<--") and links them (docs-standard.md).

- Nav: the section that lists "publications/README.md" (appended as "문서함").
- Index: "<!-- pub-index -->" in docs/publications/README.md becomes a table.
- Card under the title: kind, audience, date, status, based_on links, and for
  snapshot kinds (everything but overview) a note that the page is frozen at
  `date`/`commit` and the canonical pages hold the current state.
- Checks (WARNING): front matter fields and values, title number, based_on
  references that do not exist, snapshot kinds published without `commit`.
"""
import html
import logging
import os
import re

from mkdocs.utils.meta import get_data

log = logging.getLogger("mkdocs.hooks.publications")

DIR = "publications"
NAV_TITLE = "문서함"
KIND = {"overview": "개요", "report": "보고서", "release": "릴리스 노트", "note": "해설", "slides": "발표"}
STATUS = {"draft": "작성 중", "published": "발행", "archived": "보관"}
REQUIRED = ("kind", "audience", "date", "status", "based_on")
_FILE = re.compile(r"^(\d{4})-[a-z0-9-]+\.md$")
_TITLE = re.compile(r"^#\s+P-(\d{4})\.\s*(.+)$", re.M)
_REF = re.compile(r"^(A|ADR-|VR-|EXP-|MC-|G|R)(\d+)$")
_pubs = {}
_targets = {}  # "A3" -> "arc42/a03_context.md", "ADR-0004" -> "adr/0004-....md", ...


def _scan_targets(docs_dir):
    t = {}

    def add(sub, pat, key):
        d = os.path.join(docs_dir, sub)
        if os.path.isdir(d):
            for f in sorted(os.listdir(d)):
                m = re.match(pat, f)
                if m:
                    t[key(m)] = f"{sub}/{f}"
    add("arc42", r"^a(\d{2})_.*\.md$", lambda m: f"A{int(m.group(1))}")
    add("adr", r"^(\d{4})-.*\.md$", lambda m: f"ADR-{m.group(1)}")
    add("records", r"^(\d{4})-.*\.md$", lambda m: f"VR-{m.group(1)}")
    add("experiments", r"^(\d{4})-.*\.md$", lambda m: f"EXP-{m.group(1)}")
    add("models", r"^(\d{4})-.*\.md$", lambda m: f"MC-{m.group(1)}")
    add("guides", r"^g(\d+)_.*\.md$", lambda m: f"G{int(m.group(1))}")
    add("reference", r"^r(\d+)_.*\.md$", lambda m: f"R{int(m.group(1))}")
    return t


def _norm(ref):
    m = _REF.match(str(ref).strip())
    if not m:
        return str(ref)
    p, n = m.groups()
    return f"{p}{int(n):04d}" if p.endswith("-") else f"{p}{int(n)}"


def _files(docs_dir):
    d = os.path.join(docs_dir, DIR)
    return sorted(f for f in os.listdir(d) if _FILE.match(f)) if os.path.isdir(d) else []


def _load(docs_dir):
    pubs = {}
    for name in _files(docs_dir):
        with open(os.path.join(docs_dir, DIR, name), encoding="utf-8") as f:
            body, meta = get_data(f.read())
        num = _FILE.match(name).group(1)
        where = f"{DIR}/{name}"
        m = _TITLE.search(body)
        if not m:
            log.warning("%s: first heading must be '# P-%s. <제목>'", where, num)
        elif m.group(1) != num:
            log.warning("%s: title number P-%s does not match file name", where, m.group(1))
        for k in REQUIRED:
            if not meta.get(k):
                log.warning("%s: front matter '%s' is missing", where, k)
        if meta.get("kind") and meta["kind"] not in KIND:
            log.warning("%s: kind '%s' is not one of %s", where, meta["kind"], ", ".join(KIND))
        if meta.get("status") and meta["status"] not in STATUS:
            log.warning("%s: status '%s' is not one of %s", where, meta["status"], ", ".join(STATUS))
        if meta.get("kind") not in (None, "overview") and meta.get("status") == "published" and not meta.get("commit"):
            log.warning("%s: a published %s is a snapshot and needs 'commit'", where, meta["kind"])
        for r in meta.get("based_on") or []:
            if _norm(r) not in _targets:
                log.warning("%s: based_on '%s' does not match any document", where, r)
        pubs[num] = {"file": name, "title": m.group(2).strip() if m else name, "meta": meta}
    return pubs


def _ref_link(ref, prefix):
    key = _norm(ref)
    t = _targets.get(key)
    return f'<a href="{prefix}{t[:-3]}.html">{html.escape(key)}</a>' if t else html.escape(str(ref))


def _index():
    if not _pubs:
        return "_아직 발행물이 없습니다._"
    rows = ["| 번호 | 제목 | 종류 | 독자 | 날짜 | 상태 |", "| --- | --- | --- | --- | --- | --- |"]
    for num, p in sorted(_pubs.items()):
        m = p["meta"]
        rows.append(f"| [P-{num}]({p['file']}) | {p['title']} | {_kind(m.get('kind'))} | {m.get('audience', '')} "
                    f"| {m.get('date', '')} | {STATUS.get(m.get('status'), m.get('status', ''))} |")
    return "\n".join(rows)


def _kind(k):
    return f'<span class="pub-kind pub-kind--{k}">{KIND.get(k, k or "?")}</span>'


def _card(num):
    m = _pubs[num]["meta"]
    rows = [("종류", _kind(m.get("kind"))), ("독자", html.escape(str(m.get("audience", "")))),
            ("날짜", str(m.get("date", ""))), ("상태", STATUS.get(m.get("status"), str(m.get("status", ""))))]
    if m.get("commit"):
        rows.append(("기준 커밋", f"<code>{html.escape(str(m['commit']))}</code>"))
    if m.get("based_on"):
        rows.append(("엮은 정본", ", ".join(_ref_link(r, "../") for r in m["based_on"])))
    card = '<dl class="adr-meta pub-meta">' + "".join(f"<dt>{k}</dt><dd>{v}</dd>" for k, v in rows) + "</dl>"
    if m.get("kind") not in (None, "overview"):
        card += ('\n\n<div class="admonition note"><p class="admonition-title">스냅숏</p><p>'
                 f"이 문서는 {html.escape(str(m.get('date', '')))} 기준으로 고정된 글입니다. "
                 "현재 상태는 위 \"엮은 정본\"의 문서를 봅니다.</p></div>")
    return card


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
    files = [f"{DIR}/README.md", f"{DIR}/template.md"] + [f"{DIR}/{f}" for f in _files(config["docs_dir"])]
    if config["nav"] and not _fill_nav(config["nav"], files):
        config["nav"].append({NAV_TITLE: files})
    return config


def on_pre_build(config, **kwargs):
    _targets.clear()
    _targets.update(_scan_targets(config["docs_dir"]))
    _pubs.clear()
    _pubs.update(_load(config["docs_dir"]))


def on_page_markdown(markdown, page, config, **kwargs):
    src = page.file.src_uri
    if src == f"{DIR}/README.md":
        return markdown.replace("<!-- pub-index -->", _index())
    if src.startswith(DIR + "/"):
        m = _FILE.match(src[len(DIR) + 1:])
        if m and m.group(1) in _pubs:
            return re.sub(r"^(#\s.+)$", lambda t: t.group(1) + "\n\n" + _card(m.group(1)) + "\n",
                          markdown, count=1, flags=re.M)
    return markdown

# ---------------- tab on / off (docs-kit.yml, hooks/kitconf.py) ----------------
import os as _os  # noqa: E402
import sys as _sys  # noqa: E402

_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import kitconf as _kitconf  # noqa: E402

_kitconf.gate(globals(), "publications")
