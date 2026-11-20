"""MkDocs hook: arc42 architecture sections (docs/arc42/) — nav, status index, cards, checks.

Each of the 12 arc42 sections is one page, docs/arc42/aNN_<name>.md, titled
"# A<N>. <제목>". Pages are the canonical place for their content (docs-standard.md).

- Nav: the section that lists "arc42/README.md" (appended as "아키텍처" if missing)
  is filled with README and a01..a12 in number order.
- Index: "<!-- arc42-index -->" in docs/arc42/README.md becomes a status table
  (section, title, what it holds (from the docs standard), what it holds now (front matter
  `summary`, optional), status, owner, reviewed, C4 views).
- Card: each section page gets a small card under its title (status, owner,
  reviewed, C4 views).
- Checks (WARNING): missing section files (all 12 should exist, empty ones with
  status empty or n/a), file/title/front-matter number mismatch, status values,
  missing owner/reviewed, unknown C4 view ids (docs/adr/c4-model.yml).
"""
import html
import logging
import os
import re

import yaml
from mkdocs.utils.meta import get_data

log = logging.getLogger("mkdocs.hooks.arc42")

DIR = "arc42"
NAV_TITLE = "아키텍처"
SECTIONS = {
    1: "목표와 요구사항", 2: "제약", 3: "컨텍스트와 범위", 4: "해결 전략",
    5: "빌딩 블록", 6: "런타임", 7: "배포", 8: "횡단 개념",
    9: "결정", 10: "품질 요구사항", 11: "리스크와 기술 부채", 12: "용어집",
}
# What each section holds: one line from docs-standard.md §3 ("담는 것"), shown in the index and the card.
HOLDS = {
    1: "과제 목표, 주요 요구사항, 이해관계자, 품질 목표 3~5개 (연구: 연구 질문·가설, 단계)",
    2: "바꿀 수 없는 기술·조직 조건: 주어진 하드웨어, 플랫폼, 일정, 다른 팀 의존",
    3: "시스템 경계, 외부 사용자·시스템, 외부 인터페이스 (무엇을, 어떤 규격으로)",
    4: "근본 선택의 요약: 구조 원칙, 핵심 기술, 품질 목표를 이루는 방법",
    5: "구성 요소(컨테이너·모듈)와 책임, 저장소 구조",
    6: "중요한 시나리오 2~5개의 실행 흐름",
    7: "실행 환경, 무엇이 어디서 도는가, 배포 경로",
    8: "여러 블록에 걸친 규칙: 데이터, 인터페이스 계약, 안전, 버전 고정·재현",
    9: "ADR 목록과 읽는 순서",
    10: "품질 시나리오와 수용 기준 (연구: 평가 프로토콜)",
    11: "리스크·기술 부채 목록, 열린 질문",
    12: "모든 용어의 한 줄 뜻과 설명 위치",
}
STATUS = {"empty": "비어 있음", "partial": "일부", "stable": "안정", "n/a": "해당 없음"}
_FILE = re.compile(r"^a(\d{2})_[a-z0-9_]+\.md$")
_TITLE = re.compile(r"^#\s+A(\d{1,2})\.\s*(.+)$", re.M)
_secs = {}  # 3 -> {file, title, meta}


def _views(docs_dir):
    p = os.path.join(docs_dir, "adr", "c4-model.yml")
    if not os.path.exists(p):
        return set()
    with open(p, encoding="utf-8") as f:
        return {v["id"] for v in (yaml.safe_load(f) or {}).get("views", [])}


def _files(docs_dir):
    d = os.path.join(docs_dir, DIR)
    return sorted(f for f in os.listdir(d) if _FILE.match(f)) if os.path.isdir(d) else []


def _load(docs_dir):
    views = _views(docs_dir)
    secs = {}
    for name in _files(docs_dir):
        with open(os.path.join(docs_dir, DIR, name), encoding="utf-8") as f:
            body, meta = get_data(f.read())
        n = int(_FILE.match(name).group(1))
        where = f"{DIR}/{name}"
        m = _TITLE.search(body)
        if not m:
            log.warning("%s: first heading must be '# A%d. <제목>'", where, n)
        elif int(m.group(1)) != n:
            log.warning("%s: title number A%s does not match file name", where, m.group(1))
        if n not in SECTIONS:
            log.warning("%s: arc42 has sections 1..12 only", where)
        if meta.get("arc42") is not None and int(meta["arc42"]) != n:
            log.warning("%s: front matter arc42: %s does not match file name", where, meta["arc42"])
        if meta.get("status") not in STATUS:
            log.warning("%s: status '%s' is not one of %s", where, meta.get("status"), ", ".join(STATUS))
        for key in ("owner", "reviewed"):
            if not meta.get(key):
                log.warning("%s: front matter '%s' is missing", where, key)
        for v in meta.get("c4_views") or []:
            if v not in views:
                log.warning("%s: c4 view '%s' is not in docs/adr/c4-model.yml", where, v)
        if n in secs:
            log.warning("%s: section A%d already in %s", where, n, secs[n]["file"])
        secs[n] = {"file": name, "title": m.group(2).strip() if m else SECTIONS.get(n, name), "meta": meta}
    if secs:
        for n in SECTIONS:
            if n not in secs:
                log.warning("%s/: section A%d (%s) has no page; add one with status empty or n/a", DIR, n, SECTIONS[n])
    return secs


def _badge(status):
    return f'<span class="arc-status arc-status--{(status or "x").replace("/", "")}">{STATUS.get(status, status or "?")}</span>'


def _index():
    if not _secs:
        return "_아직 섹션 페이지가 없습니다._"
    rows = ["| 섹션 | 제목 | 담는 것 | 지금 들어 있는 것 | 상태 | 담당 | 검토일 | C4 뷰 |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    for n in sorted(SECTIONS):
        s = _secs.get(n)
        if not s:
            rows.append(f"| A{n} | {SECTIONS[n]} | {HOLDS[n]} | (페이지 없음) | | | | |")
            continue
        m = s["meta"]
        views = ", ".join(f"`{v}`" for v in m.get("c4_views") or [])
        now = str(m.get("summary", "")).replace("|", "\\|")
        rows.append(f"| [A{n}]({s['file']}) | {s['title']} | {HOLDS[n]} | {now} | {_badge(m.get('status'))} "
                    f"| {m.get('owner', '')} | {m.get('reviewed', '')} | {views} |")
    counts = {}
    for s in _secs.values():
        counts[s["meta"].get("status")] = counts.get(s["meta"].get("status"), 0) + 1
    return "\n".join(rows) + "\n\n" + " · ".join(f"{STATUS.get(k, k)} {v}" for k, v in counts.items())


def _card(n):
    m = _secs[n]["meta"]
    rows = [("arc42", f"A{n} · {SECTIONS.get(n, '')}"), ("담는 것", html.escape(HOLDS.get(n, ""))),
            ("상태", _badge(m.get("status"))),
            ("담당", html.escape(str(m.get("owner", "")))), ("검토일", str(m.get("reviewed", "")))]
    if m.get("c4_views"):
        rows.append(("C4 뷰", ", ".join(f"<code>{html.escape(v)}</code>" for v in m["c4_views"])))
    return '<dl class="adr-meta arc-meta">' + "".join(f"<dt>{k}</dt><dd>{v}</dd>" for k, v in rows) + "</dl>"


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
    d = os.path.join(config["docs_dir"], DIR)
    extra = sorted(f for f in os.listdir(d) if f.endswith(".md") and f not in ("README.md", "template.md")
                   and not _FILE.match(f)) if os.path.isdir(d) else []
    # sections first, then other pages kept in docs/arc42/ (e.g. a migration map)
    files = [f"{DIR}/README.md", f"{DIR}/template.md"] + [f"{DIR}/{f}" for f in _files(config["docs_dir"])] + \
        [f"{DIR}/{f}" for f in extra]
    if config["nav"] and not _fill_nav(config["nav"], files):
        config["nav"].append({NAV_TITLE: files})
    return config


def on_pre_build(config, **kwargs):
    _secs.clear()
    _secs.update(_load(config["docs_dir"]))


def on_page_markdown(markdown, page, config, **kwargs):
    src = page.file.src_uri
    if src == f"{DIR}/README.md":
        return markdown.replace("<!-- arc42-index -->", _index())
    if src.startswith(DIR + "/"):
        m = _FILE.match(src[len(DIR) + 1:])
        if m and int(m.group(1)) in _secs:
            return re.sub(r"^(#\s.+)$", lambda t: t.group(1) + "\n\n" + _card(int(m.group(1))) + "\n",
                          markdown, count=1, flags=re.M)
    return markdown

# ---------------- tab on / off (docs-kit.yml, hooks/kitconf.py) ----------------
import os as _os  # noqa: E402
import sys as _sys  # noqa: E402

_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import kitconf as _kitconf  # noqa: E402

_kitconf.gate(globals(), "arc42")
