"""MkDocs hook: document map (문서 지도) — every document as a node, related documents connected, like a brain map.

How two documents are judged related (three kinds of edge, each with its reason, shown in the viewer's panel):

  link     본문 링크: the rendered page links to the other page (after all other hooks, so auto-linked
           references such as "배경 01 §4" count). Direction kept: links to / linked from (backlinks).
  rel      머리말 관계: typed relations written in front matter — VR `adr` (검증), ADR `related` (관련 결정),
           `supersedes` (대체), EXP `adr` (실험의 결정), publication `based_on` (근거 섹션), VR `guide` (실행 가이드).
           The strongest kind: someone declared it.
  sim      비슷한 내용 (suggested, not linked): a score from
             0.55 x text similarity (TF-IDF over words, Korean particles stripped, cosine)
           + 0.30 x bibliographic coupling (both point at the same documents; rare targets weigh more)
           + 0.15 x shared C4 elements (front matter `c4`; rare elements weigh more)
           Each document keeps its best 3 above a floor, only for pairs with no link or relation yet. The reasons
           (shared words, shared targets, shared elements) are kept, so a suggestion can be checked — and turned
           into a link when it is right (the viewer lists them under "점검").

Topics (주제) gather the map: the vocabulary is the roadmap's tracks (docs/roadmap/roadmap.yml `tracks`, so the
roadmap and the map speak the same words) plus `common` (공통, grey). A document's topics (at most 2, the first is
primary) come from, in this order:
  1. front matter `topics: [sim, real]`
  2. docs/graph/topics.yml (`ADR-0016: [sim]`, `G11: [sim, data]` or a docs path): for documents whose text is
     fixed once written (accepted ADRs, VRs), and to record a confirmed guess
  3. the roadmap: a document in an item's `refs` takes that item's track(s) (most frequent first)
  4. a guess from its neighbours (links, relations, similar documents), marked as a guess (추정); a document
     whose neighbours do not agree goes to common
Each topic pulls its documents to its own place; topics that link to each other a lot are placed side by side, and
a document with two topics sits between them. 점검 lists the guesses and documents whose links mostly go to
another topic than theirs.

Nodes: every page except generated roadmap item pages and templates. Kind (colour + shape) from the path:
아키텍처, 결정, 검증, 실험, 발행물·보고, 가이드·참고, 배경·용어, and 목록·안내 (section indexes, kit pages: hidden by
default, they link to everything). Size grows with the number of connections.

The viewer (graph/viewer/, kit assets) reads graph/viewer/data.js written after the build. "<!-- graph-map -->" on
a page embeds it. Enabled by `hooks:` in mkdocs.base.yml.
"""
from __future__ import annotations

import html as htmllib
import json
import logging
import math
import os
import posixpath
import re
from collections import Counter, defaultdict

import itertools

import yaml
from mkdocs.plugins import event_priority

log = logging.getLogger("mkdocs.hooks.graph")
_hidden = set()   # src paths of kit pages kept out of the menu (tab off): not on the map
KIT_ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")
DIR = "graph"
VIEWER = f"{DIR}/viewer/index.html"
KINDS = [  # (id, name) in the categorical order of the palette (viewer.css --k1..--k7), then the neutral one
    ("arch", "아키텍처"), ("adr", "결정 (ADR)"), ("vr", "검증 기록"), ("exp", "실험"), ("pub", "발행물·보고"),
    ("guide", "가이드·참고"), ("bg", "배경·용어"), ("list", "목록·안내")]
SKIP = re.compile(r"(^|/)template\.md$|^roadmap/items/|^graph/")
TOP_SIM, SIM_FLOOR = 3, 0.12

_url2src = {}
_pages = {}          # src -> {title, kind, meta, links, text}
_docs_dir = [""]


def _kind(src, docs_dir):
    name = posixpath.basename(src)
    kit = not os.path.exists(os.path.join(docs_dir, src)) and os.path.exists(os.path.join(KIT_ASSETS, src))
    if kit or name in ("README.md", "index.md", "log.md", "guide.md", "c4.md") or src in ("history.md",):
        return "list"
    top = src.split("/")[0]
    return {"arc42": "arch", "adr": "adr", "records": "vr", "experiments": "exp", "publications": "pub",
            "weekly": "pub", "guides": "guide", "reference": "guide", "shared": "guide", "models": "guide",
            "background": "bg", "glossary": "bg"}.get(top, "list")


def _short(src):
    """A short id shown before the title: ADR-0016, VR-0014, A3, G11, R4, 배경 20, P-0001, EXP-0001."""
    m = re.match(r"^(adr|records|experiments|publications)/(\d{4})-", src)
    if m:
        return {"adr": "ADR", "records": "VR", "experiments": "EXP", "publications": "P"}[m.group(1)] + "-" + m.group(2)
    for pat, fmt in ((r"^arc42/a(\d\d)_", "A{}"), (r"^guides/g(\d+)_", "G{}"), (r"^reference/r(\d+)_", "R{}"),
                     (r"^background/(\d\d)_", "배경 {}")):
        m = re.match(pat, src)
        if m:
            return fmt.format(int(m.group(1)) if not fmt.startswith("배경") else m.group(1))
    return ""


# ---- collecting ----
def on_files(files, config, **kwargs):
    _url2src.clear()
    _pages.clear()
    _hidden.clear()
    _hidden.update(f.src_uri for f in files.documentation_pages()      # kit pages of tabs that are off
                   if f.inclusion.is_not_in_nav() and os.path.abspath(f.abs_src_path or "").startswith(KIT_ASSETS))
    _docs_dir[0] = config["docs_dir"]
    for f in files.documentation_pages():
        _url2src[f.dest_uri] = f.src_uri
    src = files.get_file_from_path(f"{DIR}/topics.yml")
    if src is not None:
        files.remove(src)                        # the topic list is a source, not a published file
    return files


@event_priority(-100)            # after every other hook has added its links
def on_page_content(html, page, config, files, **kwargs):
    src = page.file.src_uri
    if SKIP.search(src):
        return html
    if src in _hidden:
        return html                              # kit pages of a tab that is off (hooks/kit.py)
    here = posixpath.dirname(page.file.dest_uri)
    links = set()
    for href in re.findall(r'href="([^"]+)"', html):
        href = htmllib.unescape(href).split("#")[0].split("?")[0]
        if not href or href.startswith(("http:", "https:", "mailto:", "/", "data:")):
            continue
        target = _url2src.get(posixpath.normpath(posixpath.join(here, href)))
        if target and target != src and not SKIP.search(target) and target not in _hidden:
            links.add(target)
    text = re.sub(r"```.*?```|~~~.*?~~~", " ", page.markdown or "", flags=re.S)
    text = re.sub(r"\]\([^)]*\)|<[^>]+>|https?://\S+", " ", text)
    _pages[src] = {"title": page.title or src, "kind": _kind(src, config["docs_dir"]), "meta": dict(page.meta or {}),
                   "links": links, "text": text}
    return html


# ---- front matter relations ----
def _index(srcs):
    idx = {}
    for s in srcs:
        for pat, key in ((r"^adr/(\d{4})-", "ADR"), (r"^records/(\d{4})-", "VR"), (r"^experiments/(\d{4})-", "EXP"),
                         (r"^guides/g(\d+)_", "G"), (r"^arc42/a(\d\d)_", "A"), (r"^reference/r(\d+)_", "R"),
                         (r"^background/(\d\d)_", "BG"), (r"^publications/(\d{4})-", "P")):
            m = re.match(pat, s)
            if m:
                idx[(key, int(m.group(1)))] = s
    return idx


def _nums(v):
    if v is None:
        return []
    if not isinstance(v, (list, tuple)):
        v = [v]
    out = []
    for x in v:
        m = re.search(r"(\d+)", str(x))
        if m:
            out.append(int(m.group(1)))
    return out


def _relations(src, p, idx):
    """[(target, label from src's side, label from the target's side)]"""
    meta, out = p["meta"], []
    kind = p["kind"]

    def add(key, nums, a, b):
        for n in nums:
            t = idx.get((key, n))
            if t and t != src:
                out.append((t, a, b))
    if kind == "vr":
        add("ADR", _nums(meta.get("adr")), "검증한 결정", "검증 기록")
        add("VR", _nums(meta.get("supersedes")), "대체한 기록", "대체됨")
        for g in re.findall(r"\bG(\d+)", str(meta.get("guide") or "")):
            add("G", [int(g)], "실행 가이드", "이 가이드로 한 검증")
    elif kind == "adr":
        add("ADR", _nums(meta.get("related")), "관련 결정", "관련 결정")
        add("ADR", _nums(meta.get("supersedes")), "대체한 결정", "대체됨")
    elif kind == "exp":
        add("ADR", _nums(meta.get("adr")), "실험의 결정", "관련 실험")
    if src.startswith("publications/"):
        for a in re.findall(r"\bA(\d+)", str(meta.get("based_on") or "")):
            add("A", [int(a)], "근거 섹션", "이 섹션에 근거한 발행물")
    return out


# ---- similarity ----
_JOSA = sorted("""에서는 으로는 에게서 이라는 라는 까지 부터 에서 으로 에게 처럼 보다 이나 이고 이며 하고 과 와 은 는 이 가 을 를
의 에 로 도 만""".split(), key=len, reverse=True)
_ENDS = sorted("""했습니다 합니다 입니다 습니다 됩니다 했다 한다 된다 되는 되고 하는 하면 해서 하지 하여 해야 하게 적인 적으로 할 한 된""".split(),
               key=len, reverse=True)
_STOP = set("""것 수 등 및 또는 그 이 저 때 위 더 각 모든 같은 다른 경우 위해 대한 통해 따라 지금 아직 먼저 있음 없음 있습니다 없습니다
그리고 하지만 그래서 여기 거기 이번 다시 가장 바로 the and for with from this that are was not you can use""".split())


def _tokens(text):
    out = []
    for w in re.findall(r"[가-힣]+|[A-Za-z][A-Za-z0-9_\-]{2,}", text):
        if w[0] >= "가":
            for _ in range(2):
                for e in _ENDS + _JOSA:
                    if w.endswith(e) and len(w) - len(e) >= 2:
                        w = w[: -len(e)]
                        break
            if len(w) < 2:
                continue
        else:
            w = w.lower()
        if w not in _STOP:
            out.append(w)
    return out


def _tfidf(docs):
    n = len(docs)
    df = Counter(t for d in docs.values() for t in set(d))
    vecs = {}
    for k, toks in docs.items():
        tf = Counter(toks)
        v = {t: (1 + math.log(c)) * math.log(n / df[t]) for t, c in tf.items() if 2 <= df[t] <= 0.4 * n}
        norm = math.sqrt(sum(x * x for x in v.values())) or 1.0
        vecs[k] = {t: x / norm for t, x in v.items()}
    return vecs


def _cos(a, b):
    if len(a) > len(b):
        a, b = b, a
    return sum(x * b.get(t, 0.0) for t, x in a.items())


def _weighted_sets(sets):
    n = len(sets) or 1
    df = Counter(x for s in sets.values() for x in s)
    out = {}
    for k, s in sets.items():
        v = {x: math.log(1 + n / df[x]) for x in s}
        norm = math.sqrt(sum(w * w for w in v.values())) or 1.0
        out[k] = {x: w / norm for x, w in v.items()}
    return out


# ---- output ----
# ---- topics ----
def _ref_src(ref, idx, srcs):
    r = str(ref).strip()
    m = re.match(r"^(ADR|VR|EXP|P)-(\d{4})$", r) or re.match(r"^([GAR])\s?(\d+)", r) \
        or re.match(r"^(배경|bg)\s?(\d+)", r)
    if m:
        key = {"배경": "BG", "bg": "BG"}.get(m.group(1), m.group(1))
        return idx.get((key, int(m.group(2))))
    path = r.split("#")[0]
    path = path[5:] if path.startswith("docs/") else path
    return path if path in srcs else None


def _topics(srcs, rels, sims, docs_dir):
    """src -> (topics, source); and the topic vocabulary [(id, name)] in map order. None without a roadmap."""
    rp = os.path.join(docs_dir, "roadmap", "roadmap.yml")
    if not os.path.exists(rp):
        return None, []
    rm = yaml.safe_load(open(rp, encoding="utf-8")) or {}
    vocab = [(t["id"], t.get("name", t["id"])) for t in rm.get("tracks") or []]
    valid = {t for t, _ in vocab} | {"common"}
    order = {t: i for i, (t, _) in enumerate(vocab)}
    idx = _index(srcs)
    srcset = set(srcs)
    out = {}

    def clean(v, where):
        v = [v] if isinstance(v, str) else list(v or [])
        bad = [t for t in v if t not in valid]
        if bad:
            log.warning("graph: %s: unknown topic %s (topics are the roadmap's track ids, or common)", where, bad)
        return [t for t in v if t in valid][:2]
    for src in srcs:                                     # 1. front matter
        t = clean(_pages[src]["meta"].get("topics"), src)
        if t:
            out[src] = (t, "머리말")
    op = os.path.join(docs_dir, DIR, "topics.yml")       # 2. confirmed list
    if os.path.exists(op):
        for key, v in (yaml.safe_load(open(op, encoding="utf-8")) or {}).items():
            src = _ref_src(key, idx, srcset)
            if not src:
                log.warning("graph: %s/topics.yml: %r is no document", DIR, key)
                continue
            t = clean(v, f"{DIR}/topics.yml {key}")
            if t and src not in out:
                out[src] = (t, "확인")
    counts = defaultdict(Counter)                        # 3. the roadmap
    for it in rm.get("items") or []:
        tracks = it.get("track")
        tracks = [tracks] if isinstance(tracks, str) else list(tracks or [])
        for r in it.get("refs") or []:
            src = _ref_src(r, idx, srcset)
            if src:
                counts[src].update(t for t in tracks if t in order)
    for src, c in counts.items():
        if src not in out and c:
            top = sorted(c, key=lambda t: (-c[t], order[t]))
            out[src] = (top[:1] + [t for t in top[1:2] if c[t] * 2 >= c[top[0]]], "로드맵")
    for src in srcs:
        if src not in out and _pages[src]["kind"] == "list":
            out[src] = (["common"], "목록")
    nbr = defaultdict(Counter)                           # 4. neighbours
    for a in srcs:
        for b in _pages[a]["links"]:
            nbr[a][b] += 1.0
            nbr[b][a] += 1.0
        for b, _ in rels[a]:
            nbr[a][b] += 1.5
        for score, b, _ in sims.get(a, []):
            nbr[a][b] += 3 * score
    guess = {}
    for _ in range(3):
        new = {}
        for a in srcs:
            if a in out:
                continue
            votes = Counter()
            for b, w in nbr[a].items():
                tb = out.get(b, (None,))[0] or guess.get(b)
                if not tb or tb == ["common"]:
                    continue
                k = 1.0 if b in out else 0.5
                votes[tb[0]] += w * k
                if len(tb) > 1:
                    votes[tb[1]] += 0.5 * w * k
            total = sum(votes.values())
            if not total:
                new[a] = ["common"]
                continue
            top = votes.most_common(2)
            if top[0][1] / total < 0.45:              # neighbours do not agree: common
                new[a] = ["common"]
            else:
                new[a] = [top[0][0]] + [t for t, v in top[1:] if v >= 0.6 * top[0][1]]
        guess = new
    for a, t in guess.items():
        out[a] = (t, "추정")
    # place topics that link to each other next to each other (a ring; 7 topics: 720 orders, try them all)
    ids = [t for t, _ in vocab]
    w = Counter()
    for a in srcs:
        for b in _pages[a]["links"] | {x for x, _ in rels[a]}:
            ta, tb = out[a][0][0], out[b][0][0]
            if ta != tb and "common" not in (ta, tb):
                w[frozenset((ta, tb))] += 1
    best, ring = -1, ids
    if 2 < len(ids) <= 8:
        for perm in itertools.permutations(ids[1:]):
            cyc = (ids[0],) + perm
            v = sum(w[frozenset((cyc[i], cyc[(i + 1) % len(cyc)]))] for i in range(len(cyc)))
            if v > best:
                best, ring = v, list(cyc)
    names = dict(vocab)
    return out, [(t, names[t]) for t in ring]


def _mismatch(srcs, rels, topics):
    """Documents with a declared topic whose links mostly go to another topic."""
    out = []
    for a in srcs:
        t, src = topics.get(a, ([], ""))
        if src not in ("머리말", "확인", "로드맵") or t == ["common"]:
            continue
        votes = Counter()
        for b in _pages[a]["links"] | {x for x, _ in rels[a]}:
            tb = topics.get(b, ([], ""))[0]
            if tb and tb[0] != "common":
                votes[tb[0]] += 1
        total = sum(votes.values())
        if total >= 3:
            other, n = max(((k, v) for k, v in votes.items() if k not in t), key=lambda kv: kv[1], default=(None, 0))
            own = sum(votes[k] for k in t)
            if other and n / total >= 0.5 and own / total <= 0.2:
                out.append((a, other))
    return out


def _data(config):
    srcs = sorted(_pages)
    idx = _index(srcs)
    pid = {s: i for i, s in enumerate(srcs)}
    rels = defaultdict(list)                     # src -> [(target, label)]
    for s in srcs:
        for t, a, b in _relations(s, _pages[s], idx):
            rels[s].append((t, a))
            rels[t].append((s, b))
    linked = set()
    for s in srcs:
        for t in _pages[s]["links"]:
            linked.add(frozenset((s, t)))
        for t, _ in rels[s]:
            linked.add(frozenset((s, t)))
    content = [s for s in srcs if _pages[s]["kind"] != "list"]
    text = _tfidf({s: _tokens(_pages[s]["text"]) for s in content})
    targets = _weighted_sets({s: set(_pages[s]["links"]) | {t for t, _ in rels[s]} for s in content})
    c4 = _weighted_sets({s: {str(x) for x in (_pages[s]["meta"].get("c4") or [])} for s in content})
    sims = defaultdict(list)                     # src -> [(score, other, why)]
    for i, a in enumerate(content):
        for b in content[i + 1:]:
            if frozenset((a, b)) in linked:
                continue
            st, sc, s4 = _cos(text[a], text[b]), _cos(targets[a], targets[b]), _cos(c4[a], c4[b])
            score = 0.55 * st + 0.30 * sc + 0.15 * s4
            if score < SIM_FLOOR:
                continue
            why = []
            words = sorted((t for t in text[a] if t in text[b]), key=lambda t: -text[a][t] * text[b][t])[:5]
            if words:
                why.append("같은 낱말: " + ", ".join(words))
            common = sorted(targets[a].keys() & targets[b].keys(), key=lambda t: -targets[a][t] * targets[b][t])[:3]
            if common:
                why.append("같은 문서를 가리킴: " + ", ".join(_short(t) or _pages[t]["title"] for t in common))
            elems = sorted(c4[a].keys() & c4[b].keys())
            if elems:
                why.append("같은 구성요소(C4): " + ", ".join(elems))
            sims[a].append((score, b, why))
            sims[b].append((score, a, why))
    keep = set()
    for a, lst in sims.items():
        for score, b, why in sorted(lst, reverse=True)[:TOP_SIM]:
            keep.add((min(a, b), max(a, b)))
    topics, ring = _topics(srcs, rels, {a: [x for x in lst if (min(a, x[1]), max(a, x[1])) in keep]
                                        for a, lst in sims.items()}, _docs_dir[0])
    topics = topics or {}
    off = dict(_mismatch(srcs, rels, topics))
    here = f"{DIR}/viewer"
    nodes = []
    for s in srcs:
        p, m = _pages[s], _pages[s]["meta"]
        url = next((u for u, ss in _url2src.items() if ss == s), s[:-3] + ".html")
        summary = m.get("summary") or m.get("subject") or m.get("question") or ""
        state = m.get("result") or m.get("status") or ""
        sim_list = [{"j": pid[b], "score": round(sc, 3), "why": why}
                    for sc, b, why in sorted(sims.get(s, []), reverse=True) if (min(s, b), max(s, b)) in keep]
        short = _short(s)
        title = re.sub(r"^((ADR|VR|EXP|P)-\d{4}|[AGR]\d+|\d+)\.?\s+", "", p["title"]) if short else p["title"]
        nodes.append({"id": s, "t": title, "short": short, "k": p["kind"], "area": str(m.get("area") or ""),
                      "sum": str(summary)[:400], "state": str(state), "url": posixpath.relpath(url, here),
                      "out": sorted(pid[t] for t in p["links"] if t in pid),
                      "rel": [{"j": pid[t], "label": lab} for t, lab in rels[s] if t in pid],
                      "sim": sim_list, "topics": topics.get(s, ([], ""))[0], "tsrc": topics.get(s, ([], ""))[1],
                      "off": off.get(s, "")})
    ask = {"port": 8003, "from_ports": [8001], "start": "python3 .docs-kit/bin/docs_ask.py --serve"}
    qc = os.path.join(_docs_dir[0], "quality", "config.json")
    if os.path.exists(qc):
        try:
            ask.update(json.load(open(qc, encoding="utf-8")).get("ask") or {})
        except ValueError:
            pass
    return {"title": config.get("site_name", "문서 지도"), "kinds": KINDS, "nodes": nodes, "ask": ask,
            "topics": [list(t) for t in ring] + ([["common", "공통"]] if ring else []),
            "areas": sorted({n["area"] for n in nodes if n["area"]})}


def on_post_build(config, **kwargs):
    if not _pages:
        return
    out = os.path.join(config["site_dir"], DIR, "viewer", "data.js")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write("window.DOCGRAPH = " + json.dumps(_data(config), ensure_ascii=False) + ";\n")


def on_page_markdown(markdown, page, config, **kwargs):
    if "<!-- graph-map -->" not in markdown:
        return markdown
    viewer = posixpath.relpath(VIEWER, posixpath.dirname(page.file.dest_uri) or ".")
    return markdown.replace("<!-- graph-map -->", (
        f'<div class="rm-inline"><div class="rm-inline__bar"><span>문서 지도 · 문서를 누르면 옆에 연결과 이유</span>'
        f'<a href="{viewer}" target="_blank">전체 화면</a></div>'
        f'<iframe class="rm-embed" style="height:780px" src="{viewer}?embed=1" title="문서 지도" loading="lazy">'
        f'</iframe></div>'))


def on_config(config, **kwargs):
    nav = config["nav"]
    if nav and not _mentions(nav, f"{DIR}/README.md"):
        # after 로드맵 (or 주간 보고, or 개요) — docs-standard §2
        at = next((i + 1 for i, it in enumerate(nav) if isinstance(it, dict) and next(iter(it)) == "로드맵"), None)
        at = at or next((i + 1 for i, it in enumerate(nav) if isinstance(it, dict) and next(iter(it)) == "주간 보고"), 1)
        nav.insert(at, {"문서 지도": f"{DIR}/README.md"})
    return config


def _mentions(nav, path):
    for item in nav or []:
        if item == path:
            return True
        if isinstance(item, dict):
            for v in item.values():
                if v == path or (isinstance(v, list) and _mentions(v, path)):
                    return True
    return False

# ---------------- tab on / off (docs-kit.yml, hooks/kitconf.py) ----------------
import os as _os  # noqa: E402
import sys as _sys  # noqa: E402

_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import kitconf as _kitconf  # noqa: E402

_kitconf.gate(globals(), "graph")
