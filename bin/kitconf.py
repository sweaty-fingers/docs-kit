"""docs-kit project settings: which tabs (features) are on, the area list, and the feature catalog.

Used by the host tool bin/kit.py, so it uses the standard library only and runs on Python 3.8 (PyYAML is used when
present, else a small parser for the file's simple shape). The site (site/src/config/load.ts) reads the same catalog
(site/src/config/features.json) and the same file with the same rules.

The project keeps one file at its root:

    # docs-kit.yml
    profile: dev              # minimal | app | dev | research | all  (the starting set of tabs)
    features:                 # only what differs from the profile: true = on, false = off
      weekly: false
      experiments: true
    areas:                    # values of front matter `area` in ADR / VR / EXP (id: name)
      dev-env: 개발 환경
      data: 데이터

With no docs-kit.yml (projects from before 0.15) the profile is `auto`: a tab is on when its folder or data file exists
in docs/ (ADR always), which is how those projects were built.

A feature that is off is left out completely: its tab module does nothing, its kit pages are built but not put in the
menu (so links to its templates still work), and project pages in its folder stay published but out of the menu.
Turning a feature on again needs no other change: `.docs-kit/bin/kit.py enable <id>` also copies its starter files.
"""
import os
import re

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_NAME = "docs-kit.yml"


class Feature:
    """One tab. kind 'hook': a tab module fills the menu and pages; kind 'nav': plain project pages that the site
    puts in the menu (no other processing). path: the docs/ folder or file that holds the project's part."""

    def __init__(self, fid, title, kind, path, rank, summary, starters=(), recommends=(), data=None):
        self.id, self.title, self.kind, self.path, self.rank = fid, title, kind, path, rank
        self.summary, self.starters, self.recommends = summary, list(starters), list(recommends)
        self.data = data or path            # what `auto` looks for in docs/


# Menu order = docs-standard §2. rank decides where an auto-added tab goes (site/src/lib/nav.ts).
# The catalog lives in site/src/config/features.json so the Astro site and this module read the same list (prd.md
# FR-CFG-2).
import json as _json

with open(os.path.join(KIT, "site", "src", "config", "features.json"), encoding="utf-8") as _f:
    _CATALOG = _json.load(_f)

FEATURES = [Feature(d["id"], d["title"], d["kind"], d["path"], d["rank"], d["summary"], d.get("starters", ()),
                    d.get("recommends", ()), d.get("data")) for d in _CATALOG["features"]]
BY_ID = {f.id: f for f in FEATURES}
CORE_TITLES = dict(_CATALOG["core_titles"])
RANK = dict(CORE_TITLES, **{f.title: f.rank for f in FEATURES})
PROFILES = {name: dict(p) for name, p in _CATALOG["profiles"].items()}
DEFAULT_AREAS = dict(_CATALOG["default_areas"])


# ---------------- reading docs-kit.yml ----------------
def _scalar(v):
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    low = v.lower()
    if low in ("true", "yes", "on"):
        return True
    if low in ("false", "no", "off"):
        return False
    return v


def _strip_comment(line):
    out, q = [], None
    for i, ch in enumerate(line):
        if q:
            if ch == q:
                q = None
        elif ch in "\"'":
            q = ch
        elif ch == "#" and (i == 0 or line[i - 1] in " \t"):
            break
        out.append(ch)
    return "".join(out).rstrip()


def parse(text):
    """docs-kit.yml -> dict. PyYAML when available; otherwise the file's own simple shape (top-level keys, one level of
    `key: value` maps)."""
    try:
        import yaml  # noqa: F401
        data = yaml.safe_load(text)
        return data if isinstance(data, dict) else {}
    except ImportError:
        pass
    data, cur = {}, None
    for raw in text.splitlines():
        line = _strip_comment(raw)
        if not line.strip():
            continue
        m = re.match(r"^(\s*)([^:#]+?):\s*(.*)$", line)
        if not m:
            continue
        indent, key, val = len(m.group(1)), m.group(2).strip(), m.group(3)
        if indent == 0:
            if val.strip():
                data[key], cur = _scalar(val), None
            else:
                data[key], cur = {}, key
        elif cur is not None:
            data[cur][key] = _scalar(val)
    return data


def config_path(root):
    return os.path.join(root, CONFIG_NAME)


def load(root):
    """Settings of the project at `root` (the folder with docs-kit.yml). Always returns a dict with profile, features
    (overrides), areas and `found` (False: no docs-kit.yml, profile auto)."""
    p = config_path(root)
    if not os.path.exists(p):
        return {"profile": "auto", "features": {}, "areas": dict(DEFAULT_AREAS), "found": False, "root": root}
    with open(p, encoding="utf-8") as f:
        d = parse(f.read())
    feats = d.get("features") or {}
    areas = d.get("areas") or {}
    return {"profile": str(d.get("profile") or "dev"), "features": {str(k): bool(v) for k, v in feats.items()},
            "areas": {str(k): str(v) for k, v in areas.items()} or dict(DEFAULT_AREAS), "found": True, "root": root}


def enabled(cfg, fid):
    """Is feature `fid` on for this project?"""
    if fid in cfg["features"]:
        return cfg["features"][fid]
    prof = cfg["profile"]
    if prof == "auto":
        if fid == "adr":
            return True
        f = BY_ID.get(fid)
        return bool(f) and os.path.exists(os.path.join(cfg["root"], "docs", f.data))
    return fid in (PROFILES.get(prof) or PROFILES["dev"])["features"]


def unknown(cfg):
    """Problems in the settings (shown by bin/kit.py; the site warns about the same)."""
    out = []
    if cfg["profile"] not in PROFILES and cfg["profile"] != "auto":
        out.append("profile '%s' is not one of %s" % (cfg["profile"], ", ".join(PROFILES)))
    for k in cfg["features"]:
        if k not in BY_ID:
            out.append("feature '%s' is not one of %s" % (k, ", ".join(BY_ID)))
    return out
