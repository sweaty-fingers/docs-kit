#!/usr/bin/env python3
"""docs-kit in a project: set it up, see and change which tabs are on, check and update the kit.

    .docs-kit/bin/kit.py init [--name "이름"] [--profile dev]   start files for a new project (never overwrites)
    .docs-kit/bin/kit.py status                                   kit version and state, profile, every tab on / off
    .docs-kit/bin/kit.py enable <id> [<id> ...] [--no-starters]   turn tabs on and copy their starter files
    .docs-kit/bin/kit.py disable <id> [<id> ...]                  turn tabs off (documents stay; out of the menu)
    .docs-kit/bin/kit.py profile <minimal|app|dev|research|all>   change the starting set (overrides stay)
    .docs-kit/bin/kit.py profiles                                 what each profile turns on
    .docs-kit/bin/kit.py check [--fetch]                          for the start of a session: exit 1 on any problem
    .docs-kit/bin/kit.py update                                   move the kit to origin/<its branch> (if clean), show what changed
    .docs-kit/bin/kit.py migrate                                  move site settings from mkdocs.yml into docs-kit.yml

The project is the folder that contains .docs-kit/ (or DOCS_ROOT). Settings: <project>/docs-kit.yml (bin/kitconf.py).
Edits keep the file's comments: only the lines that change are rewritten. Standard library only (Python 3.8+), so it
runs on the host without the docs image.
"""
import argparse
import datetime
import os
import re
import shutil
import subprocess
import sys

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(KIT, "bin"))
import kitconf  # noqa: E402

ROOT = os.path.abspath(os.environ.get("DOCS_ROOT") or os.path.dirname(KIT))
TEMPLATE = os.path.join(KIT, "template")
ARC42 = [(1, "goals", "목표와 요구사항"), (2, "constraints", "제약"), (3, "context", "컨텍스트와 범위"),
         (4, "solution_strategy", "해결 전략"), (5, "building_blocks", "빌딩 블록"), (6, "runtime", "런타임"),
         (7, "deployment", "배포"), (8, "crosscutting", "횡단 개념"), (9, "decisions", "결정"),
         (10, "quality", "품질 요구사항"), (11, "risks", "리스크와 기술 부채"), (12, "glossary", "용어집")]


def say(msg=""):
    print(msg)


def git(*args, cwd=KIT):
    r = subprocess.run(["git", "-C", cwd, *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                       universal_newlines=True)
    return r.returncode, r.stdout.strip()


def subst(text, extra=None):
    vals = {"PROJECT": os.path.basename(ROOT), "TODAY": datetime.date.today().isoformat(), "PROFILE": "dev"}
    vals.update(extra or {})
    for k, v in vals.items():
        text = text.replace("{{%s}}" % k, v)
    return text


def copy_file(src, rel, extra=None):
    dest = os.path.join(ROOT, rel)
    if os.path.exists(dest):
        say(f"keep   {rel} (exists)")
        return False
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    try:
        with open(src, encoding="utf-8") as f:
            text = f.read()
        with open(dest, "w", encoding="utf-8") as f:
            f.write(subst(text, extra))
    except UnicodeDecodeError:
        shutil.copyfile(src, dest)
    say(f"create {rel}")
    return True


# ---------------- docs-kit.yml editing (line based, comments kept) ----------------
def cfg_text():
    p = kitconf.config_path(ROOT)
    if not os.path.exists(p):
        sys.exit("no docs-kit.yml in %s: run `.docs-kit/bin/kit.py init` first" % ROOT)
    with open(p, encoding="utf-8") as f:
        return f.read()


def cfg_write(text):
    with open(kitconf.config_path(ROOT), "w", encoding="utf-8") as f:
        f.write(text)


def _comment(line):
    m = re.search(r"(\s+#.*)$", line)
    return m.group(1) if m else ""


def set_profile(name):
    lines = cfg_text().split("\n")
    for i, line in enumerate(lines):
        if re.match(r"^profile\s*:", line):
            lines[i] = f"profile: {name}" + _comment(line)
            break
    else:
        lines.insert(0, f"profile: {name}")
    cfg_write("\n".join(lines))


def set_feature(fid, value):
    """value True / False sets an override; None removes it (the profile decides)."""
    lines = cfg_text().split("\n")
    start = next((i for i, l in enumerate(lines) if re.match(r"^features\s*:", l)), None)
    if start is None:
        if value is None:
            return
        lines += ["features:", f"  {fid}: {'true' if value else 'false'}"]
        cfg_write("\n".join(lines))
        return
    head = lines[start]
    inline = re.match(r"^features\s*:\s*\{\s*\}", head)
    end = start + 1
    if not inline:
        while end < len(lines) and (lines[end].startswith((" ", "\t")) or not lines[end].strip()):
            end += 1
    block = [] if inline else lines[start + 1:end]
    idx = next((j for j, l in enumerate(block) if re.match(r"^\s+%s\s*:" % re.escape(fid), l)), None)
    if value is None:
        if idx is not None:
            del block[idx]
    else:
        new = f"  {fid}: {'true' if value else 'false'}"
        if idx is not None:
            block[idx] = new + _comment(block[idx])
        else:
            last = max([j for j, l in enumerate(block) if l.strip()] or [-1])
            block.insert(last + 1, new)
    if not any(l.strip() and not l.strip().startswith("#") for l in block):
        head = "features: {}" + _comment(head)
        block = [l for l in block if l.strip()]
    else:
        head = "features:" + _comment(head)
    lines[start:end] = [head] + block
    cfg_write("\n".join(lines))


# ---------------- starters ----------------
def arc42_starters():
    made = 0
    today = datetime.date.today().isoformat()
    for n, stem, title in ARC42:
        rel = f"docs/arc42/a{n:02d}_{stem}.md"
        dest = os.path.join(ROOT, rel)
        if os.path.exists(dest):
            continue
        body = f"<이 섹션에 들어갈 것 한 줄: [문서 규격](../docs-standard.md) §3 표의 \"A{n}\" 행>"
        if n == 9:
            body = ("결정의 근거는 ADR로 남깁니다. 목록과 의사결정 로그는 [ADR 목록](../adr/README.md)과 "
                    "[의사결정 로그](../adr/log.md)에서 자동으로 만들어집니다. 이 섹션에는 읽는 순서만 둡니다.")
        if n == 11:
            body = ("알려진 리스크와 열린 질문입니다. 현황판을 쓰면 리스크는 `docs/plan/risks.yml` 한 곳에서 관리하고, "
                    "아래 표시 줄이 그 표가 됩니다.\n\n<!-- risk-register -->")
        if n == 12:
            body = "용어는 [용어집](../glossary/README.md) 한 곳에 둡니다."
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "w", encoding="utf-8") as f:
            f.write(f"---\narc42: {n}\nstatus: empty\nowner: <이름>\nreviewed: {today}\n---\n\n# A{n}. {title}\n\n{body}\n")
        say(f"create {rel}")
        made += 1
    if not made:
        say("keep   docs/arc42/ (all 12 sections exist)")


def copy_starters(fid):
    feat = kitconf.BY_ID[fid]
    for rel in feat.starters:
        if rel.endswith("/"):
            if fid == "arc42":
                arc42_starters()
            continue
        src = os.path.join(TEMPLATE, "features", fid, rel)
        if os.path.exists(src):
            copy_file(src, rel)


def missing_starters(cfg):
    """Tabs that are on but have nothing of the project's yet (`enable` copies the starters)."""
    out = []
    for f in kitconf.FEATURES:
        if kitconf.enabled(cfg, f.id) and f.starters:
            if not os.path.exists(os.path.join(ROOT, "docs", f.data)):
                out.append(f.id)
    return out


# ---------------- commands ----------------
def track_branch():
    """The kit branch the project follows: the checked-out branch, else .gitmodules `branch` for the kit's path
    (submodules are checked out detached), else main. The Astro edition lives on `astro` (README §1)."""
    rc, branch = git("rev-parse", "--abbrev-ref", "HEAD")
    if rc == 0 and branch and branch != "HEAD":
        return branch
    rel = os.path.relpath(KIT, ROOT).replace(os.sep, "/")
    gm = os.path.join(ROOT, ".gitmodules")
    if os.path.exists(gm):
        rc, out = git("config", "-f", gm, "--get-regexp", r"^submodule\..*\.path$", cwd=ROOT)
        for line in out.splitlines() if rc == 0 else []:
            key, _, path = line.partition(" ")
            if path.strip() == rel:
                rc2, b = git("config", "-f", gm, "--get", key[: -len(".path")] + ".branch", cwd=ROOT)
                if rc2 == 0 and b:
                    return b
    return "main"


def kit_state(fetch=False):
    """(lines, problems) about the kit checkout: version, branch, local changes, push state, newer upstream."""
    lines, problems = [], []
    ver = open(os.path.join(KIT, "VERSION")).read().strip() if os.path.exists(os.path.join(KIT, "VERSION")) else "?"
    rc, branch = git("rev-parse", "--abbrev-ref", "HEAD")
    if rc != 0:
        return [f"docs-kit {ver} (not a git checkout)"], []
    if fetch:
        git("fetch", "--quiet", "origin")
    _, dirty = git("status", "--porcelain")
    _, head = git("rev-parse", "--short", "HEAD")
    lines.append(f"docs-kit {ver} @ {head} ({'detached' if branch == 'HEAD' else branch})")
    if dirty:
        problems.append("docs-kit has uncommitted changes: finish them in the docs-kit repository "
                        "(VERSION, CHANGELOG, bin/selftest.sh, commit, push) - AGENTS.md")
    tb = track_branch()
    rc, counts = git("rev-list", "--left-right", "--count", f"HEAD...origin/{tb}")
    if rc == 0 and counts:
        ahead, behind = (int(x) for x in counts.split())
        if ahead:
            problems.append(f"docs-kit has {ahead} commit(s) not on origin/{tb}: push the docs-kit repository first")
        if behind:
            _, newer = git("show", f"origin/{tb}:VERSION")
            lines.append(f"newer docs-kit on origin/{tb}: {newer.strip()} ({behind} commit(s)); "
                         "`.docs-kit/bin/kit.py update` to take it")
    return lines, problems


def cmd_status(a):
    lines, problems = kit_state(fetch=getattr(a, "fetch", False))
    for l in lines:
        say(l)
    cfg = kitconf.load(ROOT)
    say(f"project {ROOT}")
    if not cfg["found"]:
        say("docs-kit.yml: none (profile auto: tabs whose docs/ folder exists). "
            "`.docs-kit/bin/kit.py init` writes one")
    else:
        say(f"profile {cfg['profile']}" + (f", overrides {cfg['features']}" if cfg["features"] else ""))
    say()
    say(f"{'id':<13} {'tab':<10} {'on':<4} what it holds")
    miss = set(missing_starters(cfg))
    for f in kitconf.FEATURES:
        on = kitconf.enabled(cfg, f.id)
        flag = "on" if on else "-"
        note = "  (no files yet: enable %s)" % f.id if f.id in miss else ""
        say(f"{f.id:<13} {f.title:<10} {flag:<4} {f.summary}{note}")
    for p in kitconf.unknown(cfg) + problems:
        say("WARN  " + p)


def cmd_profiles(a):
    for name, p in kitconf.PROFILES.items():
        say(f"{name:<9} {p['summary']}")
        say(" " * 10 + ", ".join(p["features"]))


def _check_ids(ids):
    bad = [i for i in ids if i not in kitconf.BY_ID]
    if bad:
        sys.exit("unknown tab id: %s (ids: %s)" % (", ".join(bad), ", ".join(kitconf.BY_ID)))


def cmd_enable(a):
    _check_ids(a.ids)
    for fid in a.ids:
        cfg = kitconf.load(ROOT)
        in_profile = cfg["profile"] in kitconf.PROFILES and fid in kitconf.PROFILES[cfg["profile"]]["features"]
        set_feature(fid, None if in_profile else True)
        say(f"on     {fid} ({kitconf.BY_ID[fid].title})")
        if not a.no_starters:
            copy_starters(fid)
        cfg = kitconf.load(ROOT)
        rec = [r for r in kitconf.BY_ID[fid].recommends if not kitconf.enabled(cfg, r)]
        if rec:
            say(f"note   {fid} works best with: {', '.join(rec)} (enable them too if the project needs them)")
    say("next   build: .docs-kit/bin/docs.sh build (no WARNING), then commit docs-kit.yml and the new files")


def cmd_disable(a):
    _check_ids(a.ids)
    for fid in a.ids:
        cfg = kitconf.load(ROOT)
        in_profile = cfg["profile"] in kitconf.PROFILES and fid in kitconf.PROFILES[cfg["profile"]]["features"]
        set_feature(fid, False if in_profile or cfg["profile"] == "auto" else None)
        say(f"off    {fid} ({kitconf.BY_ID[fid].title}): its documents stay in docs/, out of the menu")


def cmd_profile(a):
    if a.name not in kitconf.PROFILES:
        sys.exit("profile must be one of: " + ", ".join(kitconf.PROFILES))
    set_profile(a.name)
    cfg = kitconf.load(ROOT)
    say(f"profile {a.name}: " + ", ".join(f.id for f in kitconf.FEATURES if kitconf.enabled(cfg, f.id)))
    miss = missing_starters(cfg)
    if miss:
        say("note   on but without files yet: %s -> .docs-kit/bin/kit.py enable %s" % (", ".join(miss), " ".join(miss)))


def cmd_init(a):
    if a.profile not in kitconf.PROFILES:
        sys.exit("profile must be one of: " + ", ".join(kitconf.PROFILES))
    extra = {"PROFILE": a.profile}
    if a.name:
        extra["PROJECT"] = a.name
    base = os.path.join(TEMPLATE, "base")
    for d, _, names in os.walk(base):
        for n in sorted(names):
            src = os.path.join(d, n)
            copy_file(src, os.path.relpath(src, base), extra)
    cfg = kitconf.load(ROOT)
    for f in kitconf.FEATURES:
        if kitconf.enabled(cfg, f.id):
            copy_starters(f.id)
    gi = os.path.join(ROOT, ".gitignore")
    text = open(gi, encoding="utf-8").read() if os.path.exists(gi) else ""
    if "build/" not in text.split("\n"):
        with open(gi, "a", encoding="utf-8") as f:
            f.write(("" if not text or text.endswith("\n") else "\n") + "build/\n")
        say("update .gitignore (build/)")
    say()
    say(f"profile {cfg['profile']}: " + ", ".join(f.id for f in kitconf.FEATURES if kitconf.enabled(cfg, f.id)))
    say("next   set site.name (and site.base for a sub-path deploy) in docs-kit.yml")
    say("       .docs-kit/bin/docs.sh build  (no WARNING), .docs-kit/bin/docs.sh start  (http://localhost:8000/)")
    say("       add the docs-kit section to AGENTS.md: .docs-kit/AGENTS-GUIDE.md §4")
    say("       git add .gitmodules .docs-kit docs-kit.yml docs .gitignore AGENTS.md && git commit")


def cmd_check(a):
    lines, problems = kit_state(fetch=a.fetch)
    cfg = kitconf.load(ROOT)
    problems += ["docs-kit.yml: " + p for p in kitconf.unknown(cfg)]
    if not cfg["found"]:
        problems.append("no docs-kit.yml: tabs follow the folders in docs/ (`.docs-kit/bin/kit.py init` to choose)")
    miss = missing_starters(cfg)
    if miss:
        problems.append("tabs on without files: %s (`.docs-kit/bin/kit.py enable %s`)" % (", ".join(miss), " ".join(miss)))
    if cfg["found"] and os.path.exists(os.path.join(ROOT, "mkdocs.yml")) and not re.search(r"^site\s*:", cfg_text(), re.M):
        problems.append("site settings are still in mkdocs.yml (`.docs-kit/bin/kit.py migrate` moves them to docs-kit.yml)")
    for l in lines:
        say("OK    " + l if not l.startswith("newer") else "INFO  " + l)
    for p in problems:
        say("WARN  " + p)
    if not problems:
        say("OK    tabs: " + ", ".join(f.id for f in kitconf.FEATURES if kitconf.enabled(cfg, f.id)))
    sys.exit(1 if problems else 0)


def cmd_update(a):
    _, problems = kit_state(fetch=True)
    if problems:
        for p in problems:
            say("WARN  " + p)
        sys.exit("update stopped: finish the docs-kit changes above first")
    old = open(os.path.join(KIT, "VERSION")).read().strip()
    tb = track_branch()
    rc, out = git("checkout", "-B", tb, f"origin/{tb}")
    if rc != 0:
        sys.exit(out)
    new = open(os.path.join(KIT, "VERSION")).read().strip()
    if old == new:
        say(f"docs-kit {new}: already the newest")
        return
    say(f"docs-kit {old} -> {new}. Changes (CHANGELOG.md):")
    with open(os.path.join(KIT, "CHANGELOG.md"), encoding="utf-8") as f:
        for line in f:
            if line.startswith("## "):
                if line[3:].startswith(old):
                    break
                say("  " + line.strip())
    say("next   .docs-kit/bin/docs.sh build (no WARNING); move documents to a new format if the CHANGELOG says so;")
    say("       git add .docs-kit && git commit -m \"docs-kit %s\"" % new)


# ---------------- migrate (prd.md §9 MIG-3) ----------------
def _yaml_scalar(v):
    s = str(v)
    if re.match(r"^[\w./:@-]+$", s) and not re.match(r"^(true|false|yes|no|on|off|null|~|\d.*)$", s, re.I):
        return s
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _nav_yaml(items, indent):
    out = []
    pad = " " * indent
    for it in items:
        if isinstance(it, dict):
            for k, v in it.items():
                if isinstance(v, list):
                    out.append(f"{pad}- {_yaml_scalar(k)}:")
                    out += _nav_yaml(v, indent + 4)
                else:
                    out.append(f"{pad}- {_yaml_scalar(k)}: {_yaml_scalar(v)}")
        else:
            out.append(f"{pad}- {_yaml_scalar(it)}")
    return out


def cmd_migrate(a):
    """Move site settings from mkdocs.yml (MkDocs edition) into docs-kit.yml. Safe to run again: keys that
    docs-kit.yml already has are kept. mkdocs.yml is left in place for the user to delete."""
    mk = os.path.join(ROOT, "mkdocs.yml")
    if not os.path.exists(mk):
        sys.exit("no mkdocs.yml in %s: nothing to migrate" % ROOT)
    try:
        import yaml
    except ImportError:
        sys.exit("kit.py migrate needs PyYAML to read mkdocs.yml (pip install pyyaml), or copy the settings by hand "
                 "(docs-kit.yml: site, links, rerun, nav)")

    class Loader(yaml.SafeLoader):
        pass

    Loader.add_multi_constructor("tag:yaml.org,2002:python/", lambda loader, suffix, node: None)
    with open(mk, encoding="utf-8") as f:
        m = yaml.load(f, Loader=Loader) or {}
    text = cfg_text()
    have = {k for k in ("site", "links", "rerun", "nav") if re.search(r"^%s\s*:" % k, text, re.M)}
    extra = m.get("extra") or {}
    links = extra.get("links") or {}
    add = []
    if "site" not in have:
        add.append("site:")
        add.append(f"  name: {_yaml_scalar(m.get('site_name') or os.path.basename(ROOT))}")
        logo = ((m.get("theme") or {}).get("icon") or {}).get("logo")
        if logo:
            add.append(f"  logo_icon: {_yaml_scalar(str(logo).replace('material/', ''))}")
        if extra.get("issues_url"):
            add.append(f"  issues_url: {_yaml_scalar(extra['issues_url'])}")
        if links.get("shared_port") is not None:
            add.append(f"  shared_port: {links['shared_port']}")
    if "links" not in have and links.get("short"):
        add.append("links:")
        for e in links["short"]:
            add.append("  - {name: %s, to: %s, title: %s}" % (_yaml_scalar(e.get("name", "")), _yaml_scalar(e.get("to", "")),
                                                            _yaml_scalar(e.get("title", ""))))
    if "rerun" not in have and extra.get("rerun"):
        r = extra["rerun"]
        add.append("rerun: {%s}" % ", ".join("%s: %s" % (k, _yaml_scalar(v)) for k, v in r.items()))
    if "nav" not in have and m.get("nav"):
        add.append("nav:")
        add += _nav_yaml(m["nav"], 2)
    if not add:
        say("docs-kit.yml already has site / links / rerun / nav: nothing to move")
        return
    cfg_write(text.rstrip("\n") + "\n\n# moved from mkdocs.yml by kit.py migrate\n" + "\n".join(add) + "\n")
    say("update docs-kit.yml (" + ", ".join(sorted({l.split(":")[0] for l in add if not l.startswith(" ")})) + ")")
    say("note   mkdocs.yml is not used by the Astro edition; delete it when the site builds clean "
        "(.docs-kit/bin/docs.sh build)")


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sp = p.add_subparsers(dest="cmd")
    s = sp.add_parser("init")
    s.add_argument("--name")
    s.add_argument("--profile", default="dev")
    s.set_defaults(fn=cmd_init)
    s = sp.add_parser("status")
    s.add_argument("--fetch", action="store_true")
    s.set_defaults(fn=cmd_status)
    sp.add_parser("profiles").set_defaults(fn=cmd_profiles)
    s = sp.add_parser("enable")
    s.add_argument("ids", nargs="+")
    s.add_argument("--no-starters", action="store_true")
    s.set_defaults(fn=cmd_enable)
    s = sp.add_parser("disable")
    s.add_argument("ids", nargs="+")
    s.set_defaults(fn=cmd_disable)
    s = sp.add_parser("profile")
    s.add_argument("name")
    s.set_defaults(fn=cmd_profile)
    s = sp.add_parser("check")
    s.add_argument("--fetch", action="store_true")
    s.set_defaults(fn=cmd_check)
    sp.add_parser("update").set_defaults(fn=cmd_update)
    sp.add_parser("migrate").set_defaults(fn=cmd_migrate)
    a = p.parse_args()
    if not getattr(a, "fn", None):
        a = p.parse_args(["status"])
    a.fn(a)


if __name__ == "__main__":
    main()
