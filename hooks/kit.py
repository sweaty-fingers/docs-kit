"""MkDocs hook: add docs-kit's shared pages and assets to a project's build, and apply the project's tab choice.

Everything under assets/ is added to the site at the same path, as if it were in the project's docs/ directory:

  assets/_kit/...        stylesheets and scripts (referenced by mkdocs.base.yml)
  assets/adr/...         ADR index, decision log, C4 page, guide, template, viewer
  assets/docs-kit.md     "문서 사이트 사용법" page
  assets/docs-standard.md "문서 규격" page (document types, sections, formats)
  assets/<feature>/      index pages, guides and templates of each tab (arc42, plan, weekly, ...)

A file with the same path in the project's docs/ wins, so a project can override any kit page or asset. The kit's
assets are watched by `mkdocs serve`.

Tabs (features, hooks/kitconf.py, the project's docs-kit.yml):
  - a feature that is off: its kit pages are still built but kept out of the menu (links to its templates work),
    and the project's own pages in its folder too (unless the project's nav lists them). Its hook does nothing.
  - a 'nav' feature that is on (작업 내역, 실행 가이드, 참고, 배경, 용어집, 모델, 공용 파일): its pages are put in the
    menu when the project's nav does not list any of them (README.md first, then by number).
  - hooks/kit_nav.py (last hook) moves the tabs that hooks added to their place in the standard order.
Markers: "<!-- kit-features -->" (tabs, on / off, what each holds) and "<!-- kit-areas -->" (area values) on any page.
The "문서 규격" and "문서 사이트 사용법" pages are appended to the nav when the project's nav does not mention them.
Enabled by `hooks:` in mkdocs.base.yml (first in the list: it reads the settings for the other hooks).
"""
import logging
import os
import sys

from mkdocs.structure.files import File, InclusionLevel

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kitconf  # noqa: E402

log = logging.getLogger("mkdocs.hooks.kit")
KIT = kitconf.KIT
ASSETS = os.path.join(KIT, "assets")
GUIDE_PAGE = "docs-kit.md"
GUIDE_TITLE = "문서 사이트 사용법"
STANDARD_PAGE = "docs-standard.md"
STANDARD_TITLE = "문서 규격"


def _mentions_prefix(nav, prefix):
    for item in nav or []:
        if isinstance(item, str) and item.startswith(prefix):
            return True
        if isinstance(item, dict):
            for v in item.values():
                if (isinstance(v, str) and v.startswith(prefix)) or (isinstance(v, list) and _mentions_prefix(v, prefix)):
                    return True
    return False


def _nav_pages(docs_dir, sub):
    d = os.path.join(docs_dir, sub)
    if not os.path.isdir(d):
        return []
    names = sorted((f for f in os.listdir(d) if f.endswith(".md") and f != "template.md"), key=kitconf.natural)
    names.sort(key=lambda f: f != "README.md")
    return [f"{sub}/{f}" for f in names]


def _add_nav_feature(nav, feat, docs_dir):
    if feat.id == "history":
        if kitconf.mentions(nav, "history.md"):
            return
        if not os.path.exists(os.path.join(docs_dir, "history.md")):
            log.warning("kit: feature history is on but docs/history.md is missing (.docs-kit/bin/kit.py enable history)")
            return
        for i, item in enumerate(nav):
            if kitconf.title_of(item) == "개요":
                v = item["개요"]
                item["개요"] = ([v] if isinstance(v, str) else list(v)) + ["history.md"]
                return
        nav.append({feat.title: "history.md"})
        return
    if _mentions_prefix(nav, feat.path + "/"):
        return                                    # the project lists these pages itself
    pages = _nav_pages(docs_dir, feat.path)
    if not pages:
        log.warning("kit: feature %s is on but docs/%s/ has no page (.docs-kit/bin/kit.py enable %s)",
                    feat.id, feat.path, feat.id)
        return
    nav.append({feat.title: pages[0] if len(pages) == 1 and pages[0].endswith("README.md") else pages})


def on_config(config, **kwargs):
    kitconf.reset()
    cfg = kitconf.for_config(config)
    for problem in kitconf.unknown(cfg):
        log.warning("kit: docs-kit.yml: %s", problem)
    config["watch"].append(ASSETS)
    nav = config["nav"]
    kitconf.nav_state["original"] = {kitconf.title_of(it) for it in nav or [] if kitconf.title_of(it)}
    if nav:
        for feat in kitconf.FEATURES:
            if feat.kind == "nav" and kitconf.enabled(cfg, feat.id):
                _add_nav_feature(nav, feat, config["docs_dir"])
        for page, title in ((STANDARD_PAGE, STANDARD_TITLE), (GUIDE_PAGE, GUIDE_TITLE)):
            if not kitconf.mentions(nav, page):
                nav.append({title: page})
    return config


def _feature_of(rel):
    top = rel.split("/", 1)[0]
    if "/" not in rel:
        top = rel                                 # history.md
    for f in kitconf.FEATURES:
        if f.path == top:
            return f
    return None


def on_files(files, config, **kwargs):
    cfg = kitconf.for_config(config)
    nav = config["nav"]
    off = {f.id for f in kitconf.FEATURES if not kitconf.enabled(cfg, f.id)}
    for root, _, names in os.walk(ASSETS):
        for name in sorted(names):
            rel = os.path.relpath(os.path.join(root, name), ASSETS).replace(os.sep, "/")
            if files.get_file_from_path(rel):
                continue  # the project's own file overrides the kit
            f = File(rel, ASSETS, config["site_dir"], config["use_directory_urls"])
            feat = _feature_of(rel)
            if feat and feat.id in off and rel.endswith(".md"):
                f.inclusion = InclusionLevel.NOT_IN_NAV   # built, linkable, not in the menu
            files.append(f)
    # The project's pages of a feature that is off: published, not in the menu (no "not in nav" warning).
    for f in files.documentation_pages():
        feat = _feature_of(f.src_uri)
        if feat and feat.id in off and not kitconf.mentions(nav, f.src_uri):
            f.inclusion = InclusionLevel.NOT_IN_NAV
    return files


def _features_table(config):
    cfg = kitconf.for_config(config)
    prof = cfg["profile"] + ("" if cfg["found"] else " (docs-kit.yml 없음: 폴더가 있는 탭만)")
    rows = [f"묶음(profile): **{prof}**. 바꾸는 법: `.docs-kit/bin/kit.py enable <id>`, `disable <id>`, "
            "`profile <이름>` ([문서 규격](docs-standard.md) §13).", "",
            "| id | 탭 | 상태 | 담는 것 | 함께 쓰면 좋은 탭 |", "| --- | --- | --- | --- | --- |"]
    for f in kitconf.FEATURES:
        on = kitconf.enabled(cfg, f.id)
        rows.append(f"| `{f.id}` | {f.title} | {'**켬**' if on else '끔'} | {f.summary} | "
                    f"{', '.join(kitconf.BY_ID[r].title for r in f.recommends)} |")
    rows += ["", "| 묶음 | 켜지는 탭 |", "| --- | --- |"]
    for name, p in kitconf.PROFILES.items():
        rows.append(f"| `{name}` | {p['summary']}: {', '.join(kitconf.BY_ID[i].title for i in p['features'])} |")
    return "\n".join(rows)


def _areas_table(config):
    rows = ["| `area` 값 | 분야 |", "| --- | --- |"]
    rows += [f"| `{k}` | {v} |" for k, v in kitconf.areas(config).items()]
    return "\n".join(rows) + "\n\n분야 목록은 프로젝트의 `docs-kit.yml` `areas`에서 바꿉니다."


def on_page_markdown(markdown, page, config, **kwargs):
    lines = markdown.split("\n")
    changed = False
    for i, line in enumerate(lines):
        s = line.strip()
        if s == "<!-- kit-features -->":
            lines[i], changed = _features_table(config), True
        elif s == "<!-- kit-areas -->":
            lines[i], changed = _areas_table(config), True
    return "\n".join(lines) if changed else markdown

