"""docs-kit project settings: which tabs (features) are on, the area list, and the feature catalog.

Shared by the MkDocs hooks (imported from hooks/*.py) and by the host tool bin/kit.py, so it uses the standard library
only and runs on Python 3.8 (PyYAML is used when present, else a small parser for the file's simple shape).

The project keeps one file at its root, next to mkdocs.yml:

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

A feature that is off is left out completely: its hook does nothing (gate()), its kit pages are built but not put in
the menu (so links to its templates still work), and project pages in its folder stay published but out of the menu.
Turning a feature on again needs no other change: `.docs-kit/bin/kit.py enable <id>` also copies its starter files.
"""
import functools
import os
import re

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_NAME = "docs-kit.yml"


class Feature:
    """One tab. kind 'hook': a kit hook fills the menu and pages; kind 'nav': plain project pages that hooks/kit.py
    puts in the menu (no other processing). path: the docs/ folder or file that holds the project's part."""

    def __init__(self, fid, title, kind, path, rank, summary, starters=(), recommends=(), data=None):
        self.id, self.title, self.kind, self.path, self.rank = fid, title, kind, path, rank
        self.summary, self.starters, self.recommends = summary, list(starters), list(recommends)
        self.data = data or path            # what `auto` looks for in docs/


# Menu order = docs-standard §2. rank decides where an auto-added tab goes (hooks/kit_nav.py).
FEATURES = [
    Feature("history", "작업 내역", "nav", "history.md", 1,
            "끝난 작업을 최신순 한 줄씩 (결과 링크, 재현 명령, 자세한 문서). 메뉴 '개요' 아래",
            starters=["docs/history.md"]),
    Feature("plan", "현황판", "hook", "plan", 2,
            "단계별 진행(Epic > … > WBS), 작업량과 진척·예측, 연구 질문, 리스크 대장, 스프린트 보드",
            starters=["docs/plan/scope.yml", "docs/plan/risks.yml", "docs/plan/sprints.json"],
            recommends=["roadmap"], data="plan/scope.yml"),
    Feature("weekly", "주간 보고", "hook", "weekly", 3,
            "회의용 진행 보고(업무별 배경·한 일·결과·다음), 업무별 흐름"),
    Feature("roadmap", "로드맵", "hook", "roadmap", 4,
            "한 일과 할 일의 노선도(트랙, 지금·다음·나중), 항목 페이지",
            starters=["docs/roadmap/roadmap.yml"], data="roadmap/roadmap.yml"),
    Feature("graph", "문서 지도", "hook", "graph", 5,
            "모든 문서와 연결(링크, 머리말 관계, 비슷한 내용), 주제별 성운, 점검, 문서에 질문(로컬 모델)"),
    Feature("quality", "근거 점검", "hook", "quality", 6,
            "문서의 주장(번호, 경로, 포트, 수치)을 원천과 대조, 검색 평가, 할루시네이션 사례",
            starters=["docs/quality/config.json", "docs/quality/questions.json", "docs/quality/incidents.json"]),
    Feature("publications", "문서함", "hook", "publications", 7,
            "발행물 P-NNNN: 개요(갱신), 보고서·릴리스 노트·해설·발표(스냅숏)"),
    Feature("arc42", "아키텍처", "hook", "arc42", 8,
            "arc42 섹션 A1~A12(정본), 섹션 현황표", starters=["docs/arc42/"], recommends=["adr"]),
    Feature("adr", "ADR", "hook", "adr", 9,
            "결정 기록, 의사결정 로그, C4 모델과 아키텍처 뷰어",
            starters=["docs/adr/0001-record-architecture-decisions.md", "docs/adr/c4-model.yml"]),
    Feature("experiments", "실험", "hook", "experiments", 10,
            "실험 EXP-NNNN: 연구 질문·가설 하나 = 문서 하나, 실패도 남김", recommends=["records"]),
    Feature("records", "검증 기록", "hook", "records", 11,
            "검증 기록 VR-NNNN: 실행해서 확인한 결과와 증거, 재현(repro.sh, expected.txt)"),
    Feature("models", "모델", "nav", "models", 12,
            "모델 카드 MC-NNNN: 승격된 모델의 용도, 데이터, 근거 VR, 한계", starters=["docs/models/README.md"],
            recommends=["experiments", "records"]),
    Feature("guides", "실행 가이드", "nav", "guides", 13,
            "실행 가이드 G<N>: 명령 → 기대 결과 → 안 될 때", starters=["docs/guides/g1_getting_started.md"]),
    Feature("reference", "참고", "nav", "reference", 14,
            "참고 R<N>: 여러 문서가 찾아보는 값의 표(주소, 포트, 보관소)", starters=["docs/reference/r1_ports.md"]),
    Feature("shared", "공용 파일", "nav", "shared", 15,
            "모두가 같은 버전을 써야 하는 파일의 현재 버전과 받는 곳", starters=["docs/shared/README.md"]),
    Feature("background", "배경", "nav", "background", 16,
            "배경 지식, 관련 연구 조사, 도구 설명 (부록 A, NN_ 번호)", starters=["docs/background/01_background.md"]),
    Feature("glossary", "용어집", "nav", "glossary", 17,
            "모든 용어의 한 줄 뜻과 설명 위치 (= A12)", starters=["docs/glossary/README.md"]),
]
BY_ID = {f.id: f for f in FEATURES}
CORE_TITLES = {"개요": 0, "문서 규격": 90, "문서 사이트 사용법": 91}
RANK = dict(CORE_TITLES, **{f.title: f.rank for f in FEATURES})

PROFILES = {
    "minimal": {
        "summary": "가장 작은 시작: 결정, 실행 가이드, 용어집",
        "features": ["adr", "guides", "glossary"]},
    "app": {
        "summary": "당장 쓸 앱·도구 제작: 결정, 로드맵, 가이드·참고, 작업 내역",
        "features": ["adr", "roadmap", "guides", "reference", "history", "glossary"]},
    "dev": {
        "summary": "개발 과제: arc42 아키텍처, 결정, 검증, 주간 보고·현황판·로드맵, 문서 지도·근거 점검",
        "features": ["history", "plan", "weekly", "roadmap", "graph", "quality", "publications", "arc42", "adr",
                     "records", "guides", "reference", "shared", "glossary"]},
    "research": {
        "summary": "연구 과제: 배경·실험·검증·모델, 결정, 주간 보고·현황판(연구 질문)·로드맵, 문서 지도·근거 점검",
        "features": ["history", "plan", "weekly", "roadmap", "graph", "quality", "publications", "adr", "experiments",
                     "records", "models", "guides", "background", "glossary"]},
    "all": {
        "summary": "모든 탭 (연구와 개발을 함께 하는 과제)",
        "features": [f.id for f in FEATURES]},
}
DEFAULT_AREAS = {
    "arch": "구조·설계",
    "dev-env": "개발 환경",
    "platform": "플랫폼·연동",
    "data": "데이터",
    "quality": "품질·시험",
    "safety": "안전·보안",
    "ops": "배포·운영",
    "docs": "문서",
}


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
    """Settings of the project at `root` (the folder with mkdocs.yml). Always returns a dict with profile, features
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
    """Problems in the settings (shown as build warnings and by bin/kit.py)."""
    out = []
    if cfg["profile"] not in PROFILES and cfg["profile"] != "auto":
        out.append("profile '%s' is not one of %s" % (cfg["profile"], ", ".join(PROFILES)))
    for k in cfg["features"]:
        if k not in BY_ID:
            out.append("feature '%s' is not one of %s" % (k, ", ".join(BY_ID)))
    return out


# ---------------- for the hooks ----------------
_cache = {}
nav_state = {"original": set()}   # top-level nav titles as the project wrote them (hooks/kit.py)


def root_of(config):
    return os.path.dirname(os.path.abspath(config["config_file_path"])) if config.get("config_file_path") else os.getcwd()


def for_config(config):
    """Settings for a MkDocs config, read once per build (on_config of hooks/kit.py clears the cache)."""
    root = root_of(config)
    if root not in _cache:
        _cache[root] = load(root)
    return _cache[root]


def reset():
    _cache.clear()


def areas(config):
    return for_config(config)["areas"]


def gate(namespace, fid):
    """Make the hook module whose globals are `namespace` do nothing while feature `fid` is off: every on_* event
    returns its first argument unchanged (config, files, markdown, html, ...). Call at the end of the module."""
    state = {"on": True}

    def wrap(name, fn):
        @functools.wraps(fn)
        def inner(*args, **kwargs):
            if name == "on_config":
                config = args[0] if args else kwargs.get("config")
                state["on"] = enabled(for_config(config), fid)
            if not state["on"]:
                if args:
                    return args[0]
                return next(iter(kwargs.values()), None) if name != "on_post_build" else None
            return fn(*args, **kwargs)
        return inner

    has_config = "on_config" in namespace
    for name in [n for n in list(namespace) if n.startswith("on_") and callable(namespace[n])]:
        namespace[name] = wrap(name, namespace[name])
    if not has_config:                           # the state must be set at the start of every build
        def on_config(config, **kwargs):
            return config
        namespace["on_config"] = wrap("on_config", on_config)


# ---------------- nav helpers ----------------
def mentions(nav, path):
    for item in nav or []:
        if item == path:
            return True
        if isinstance(item, dict):
            for v in item.values():
                if v == path or (isinstance(v, list) and mentions(v, path)):
                    return True
    return False


def title_of(item):
    if isinstance(item, dict) and item:
        return next(iter(item))
    return None


_NUM = re.compile(r"(\d+)")


def natural(name):
    return [int(t) if t.isdigit() else t for t in _NUM.split(name)]
