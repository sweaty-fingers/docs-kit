#!/usr/bin/env python3
"""Grounding check: verify the checkable claims in a project's documents against their sources (a proxy for
hallucination: a statement that cites something that is not there, or a number that is not in the evidence).

    python3 .docs-kit/bin/docs_check.py [--root .] [--json] [--changed] [--record] [--only path ...]

Like FActScore (atomic facts checked one by one against a knowledge source) but with deterministic sources instead
of a language model, so every verdict can be reproduced:

  doc-id     ADR-/VR-/EXP-/P-NNNN exists                                    false -> 틀림
  issue      #N is in docs/plan/issues.json (the tracker snapshot)           false -> 틀림
  path       a repository path in `code` exists (or a glob matches; with a commit hash on the line, in that
             commit - a document that points into history)                   false -> 틀림
  port       a port 8000-9999 written in prose is in the ports reference     false -> 틀림
  option     `tools/x.sh sub --flag`: sub and --flag appear in that script    missing -> 확인 못 함
  ident      a code identifier in `code` (snake_case, CamelCase, f()) is in the code / config      -> 확인 못 함
  vr-number  a decimal number with a unit in a VR is in that VR's raw outputs (assets/VR-NNNN/)   -> 확인 못 함
  number     a decimal number with a unit in a report / guide / overview is in some VR / EXP / ADR -> 확인 못 함
  superseded a living document cites a record that a newer one supersedes, without the newer one -> 낡음
  stale      (git) code a living document points to changed after the document (> 14 days)        -> 낡음

Verdicts: ok (근거 있음), false (틀림: the cited thing does not exist), unverified (확인 못 함: not found where it
should be - a human or agent checks), stale (낡음). Report: claims, findings and per-document / per-layer rates, plus
the retrieval evaluation (docs/quality/questions.json: question -> expected documents, hit@1, recall@5, MRR with
bin/docs_search.py). --record appends the summary to docs/quality/history.json (trend on the 근거 점검 page).
--changed checks only files changed against git HEAD (and untracked), for use before a commit.

Standard library only (Python 3.8+). Rules per project: docs/quality/config.json (code roots, ignore lists).
"""
import argparse
import datetime as dt
import fnmatch
import glob
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import docs_search  # noqa: E402

DEFAULT_CFG = {
    "code_roots": ["packages", "tools", "docker", "deploy", "config", ".docs-kit/hooks", ".docs-kit/bin", "docs/plan",
                   "docs/roadmap", "docs/graph", "mkdocs.yml", ".docs-kit/mkdocs.base.yml"],
    "path_roots": ["tools", "packages", "docs", "docker", "deploy", "config", "assets", ".docs-kit", "notebooks", "build"],
    "ports_doc": "",          # the ports reference; empty: the first docs/reference/r*_ports*.md
    "number_free": ["docs/background/", "docs/glossary/", "docs/reference/"],
    "ident_ignore": [],
    "path_ignore": ["build/*"],
    "path_external": [],      # paths in other repositories or on the device (not checkable here)
    "path_planned": [],       # paths the documents plan but that do not exist yet
    "immutable": ["docs/adr/", "docs/records/", "docs/weekly/", "docs/history.md", "docs/publications/"],
}
UNITS = r"(?:N·m|N|mm|cm|ms|Hz|kHz|kg|g|rad|deg|°|%|%p|s|초|MB|GB|N·s|m/s|rad/s|W|V|A)"
NUM_RE = re.compile(r"(?<![\w.#/-])(-?\d+\.\d+)\s?" + UNITS + r"(?![\w/])")
# Boundaries are ASCII on purpose: Korean particles attach to ids ("VR-0012를", "#61을"), and \b would treat the
# Hangul as part of the word and miss them.
DOCID_RE = re.compile(r"(?<![A-Za-z0-9_])(ADR|VR|EXP|P|MC)-(\d{4})(?![0-9])")
ISSUE_RE = re.compile(r"(?<![A-Za-z0-9_&/#`\[])#(\d{1,4})(?![0-9A-Za-z_-])")
PORT_RE = re.compile(r"(?:(?<=:)|(?<=포트 )|(?<=port ))([89]\d{3})(?![0-9])")
CODE_RE = re.compile(r"`([^`\n]+)`")
IDENT_RE = re.compile(r"^(?:[a-z][a-z0-9]*(?:_[a-z0-9]+)+|[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+|[A-Za-z_][A-Za-z0-9_.]*\(\))$")
SCRIPT_RE = re.compile(r"((?:tools|\.docs-kit/bin)/[\w./-]+\.(?:sh|py))((?:\s+[^\s|;&`]+)*)")
LAYER_OF = docs_search.layer


def cfg_load(root):
    c = dict(DEFAULT_CFG)
    p = os.path.join(root, "docs", "quality", "config.json")
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            c.update(json.load(f))
    if not c.get("ports_doc"):
        found = sorted(glob.glob(os.path.join(root, "docs", "reference", "r*_ports*.md")))
        c["ports_doc"] = os.path.relpath(found[0], root).replace(os.sep, "/") if found else "docs/reference/r1_ports.md"
    return c


def repo_files(root, roots):
    out = []
    for r in roots:
        base = os.path.join(root, r)
        if os.path.isfile(base):
            out.append(r)
            continue
        for dp, dn, fn in os.walk(base):
            dn[:] = [d for d in dn if (not d.startswith(".") or d == ".docs-kit") and d not in ("__pycache__", "node_modules", "site")
                     and not (dp == base and d == "build")]
            for f in fn:
                out.append(os.path.relpath(os.path.join(dp, f), root).replace(os.sep, "/"))
    return out


class Ctx:
    def __init__(self, root):
        self.root = root
        self.cfg = cfg_load(root)
        self.idx = docs_search.load(root)
        self.all_files = set(repo_files(root, ["."]))
        self.suffix = {}
        for f in self.all_files:
            parts = f.split("/")
            for i in range(1, len(parts)):
                self.suffix.setdefault("/".join(parts[i:]), f)
        code = []
        for f in repo_files(root, self.cfg["code_roots"]):
            if f.endswith((".py", ".sh", ".toml", ".yml", ".yaml", ".json", ".js", ".cfg", ".xacro", ".urdf", "Dockerfile")) or "Dockerfile" in f:
                try:
                    with open(os.path.join(root, f), encoding="utf-8", errors="ignore") as fh:
                        code.append(fh.read())
                except OSError:
                    pass
        self.code = "\n".join(code)
        self.ids = {d["id"] for d in self.idx["docs"].values() if d["id"]}
        ip = os.path.join(root, "docs", "plan", "issues.json")
        self.issues = None
        if os.path.exists(ip):
            with open(ip, encoding="utf-8") as f:
                self.issues = {int(i["iid"]) for i in json.load(f).get("issues", [])}
        pp = os.path.join(root, self.cfg["ports_doc"])
        self.ports = set(re.findall(r"\b([89]\d{3})\b", open(pp, encoding="utf-8").read())) if os.path.exists(pp) else None
        # evidence for numbers: VR / EXP / ADR text and VR assets
        ev = []
        for p, d in self.idx["docs"].items():
            if d["id"].startswith(("VR-", "EXP-", "ADR-")):
                ev.append(open(os.path.join(root, p), encoding="utf-8").read())
        self.vr_assets = {}
        for d in glob.glob(os.path.join(root, "docs", "records", "assets", "VR-*")):
            txt = []
            for dp, _, fn in os.walk(d):
                for f in fn:
                    fp = os.path.join(dp, f)
                    if os.path.getsize(fp) < 5_000_000:
                        try:
                            txt.append(open(fp, encoding="utf-8", errors="ignore").read())
                        except OSError:
                            pass
            self.vr_assets[os.path.basename(d)] = "\n".join(txt)
        self.evidence = "\n".join(ev) + "\n".join(self.vr_assets.values())
        words = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
        nums = re.compile(r"(?<![\d.])\d+(?:\.\d+)?")
        self.names = set(words.findall(self.code + "\n".join(self.vr_assets.values())))   # code, config, device outputs
        self.code_nums = set(nums.findall(self.code))
        self.ev_nums = set(nums.findall(self.evidence))
        self.vr_nums = {k: set(nums.findall(v)) for k, v in self.vr_assets.items()}
        self.superseded = {d["id"]: d["superseded_by"] for d in self.idx["docs"].values() if d.get("superseded_by")}
        self.git = self._git_ok()

    def _git_ok(self):
        try:
            subprocess.run(["git", "-C", self.root, "rev-parse", "HEAD"], capture_output=True, check=True, timeout=10)
            return True
        except (OSError, subprocess.SubprocessError):
            return False

    def in_commit(self, sha, path):
        """True when the path exists in that commit (a document that points into history: `git show abc1234:x`)."""
        if not self.git:
            return False
        try:
            return subprocess.run(["git", "-C", self.root, "cat-file", "-e", f"{sha}:{path}"], capture_output=True,
                                  timeout=10).returncode == 0
        except (OSError, subprocess.SubprocessError):
            return False

    def last_commit(self, path):
        try:
            r = subprocess.run(["git", "-C", self.root, "log", "-1", "--format=%cs", "--", path], capture_output=True,
                               text=True, timeout=20)
            return r.stdout.strip() or None
        except (OSError, subprocess.SubprocessError):
            return None


PLACEHOLDER = re.compile(r"NNNN|\bNN\b|NN_|aNN|YYYY|<|>|\{|\}|\$|짧은|\.\.\.")


def clean_path(p):
    p = re.sub(r"[가-힣]+$", "", p.strip())          # a particle glued on: c4-model.yml의
    p = p.rstrip("/.,:)").split("#")[0]
    return re.sub(r"^\./", "", p)


def path_kind(ctx, p):
    """'external' / 'planned' from the project's lists, else None."""
    q = p.rstrip("/") + "/"
    if any(fnmatch.fnmatch(p, g) or q.startswith(g.rstrip("*")) for g in ctx.cfg["path_external"]):
        return "external"
    if any(fnmatch.fnmatch(p, g) or q.startswith(g.rstrip("*")) for g in ctx.cfg["path_planned"]):
        return "planned"
    return None


def path_exists(ctx, p, here=""):
    p = clean_path(p)
    if PLACEHOLDER.search(p) or p.startswith(("http", "nas:", "/")):
        return None                       # a pattern or a placeholder: not checkable
    if any(fnmatch.fnmatch(p, g) for g in ctx.cfg["path_ignore"]) or path_kind(ctx, p) == "external":
        return None
    if here and os.path.exists(os.path.join(ctx.root, os.path.dirname(here), p)):
        return True                       # relative to the document (assets/VR-0004/...)
    if "*" in p:
        return any(fnmatch.fnmatch(f, p) or fnmatch.fnmatch(f, "*/" + p) for f in ctx.all_files)
    if p in ctx.all_files or os.path.isdir(os.path.join(ctx.root, p)):
        return True
    if p in ctx.suffix:                   # written relative to its package (config/app/x.toml)
        return True
    return any(f.startswith(p.rstrip("/") + "/") for f in ctx.all_files)


def claims_of(ctx, path):
    """Yield (kind, line, text, verdict, detail) for one document."""
    full = os.path.join(ctx.root, path)
    lines = open(full, encoding="utf-8").read().split("\n")
    _, start = docs_search.front_matter(lines)
    is_vr = path.startswith("docs/records/") and re.match(r"^\d{4}-", os.path.basename(path))
    vr_id = "VR-" + os.path.basename(path)[:4] if is_vr else ""
    living = not any(path.startswith(x) for x in ctx.cfg["immutable"])
    number_scope = not any(path.startswith(x) for x in ctx.cfg["number_free"]) and not path.startswith(("docs/adr/", "docs/experiments/"))
    fence = False
    for i in range(start, len(lines)):
        ln, no = lines[i], i + 1
        if ln.lstrip().startswith(("```", "~~~")):
            fence = not fence
            continue
        codes = [ln] if fence else CODE_RE.findall(ln)
        prose = "" if fence else CODE_RE.sub(" ", ln)
        prose = re.sub(r"\]\([^)]*\)", "]", prose)               # link targets are checked by the site build
        # doc ids
        for m in DOCID_RE.finditer(ln):
            i_ = f"{m.group(1)}-{m.group(2)}"
            if m.group(1) == "MC" and not any(x.startswith("MC-") for x in ctx.ids):
                continue
            ok = i_ in ctx.ids
            yield ("doc-id", no, i_, "ok" if ok else "false", "" if ok else "없는 문서 번호")
        # superseded records cited as current
        if living and not fence:
            for m in DOCID_RE.finditer(prose):
                i_ = f"{m.group(1)}-{m.group(2)}"
                new, chain = ctx.superseded.get(i_), []
                while new and new not in chain:          # follow the chain to the record that is current now
                    chain.append(new)
                    new = ctx.superseded.get(new)
                after = prose[m.end(): m.end() + 4]
                deliberate = after.lstrip().startswith("§") or after.startswith("의 ")   # a section or a file of that record
                if chain and not any(c in ln for c in chain) and not deliberate and path != "docs/history.md":
                    yield ("superseded", no, i_, "stale", f"{' → '.join(chain)}가 대체함: 지금 근거는 {chain[-1]}")
        # issues
        if ctx.issues is not None and not fence and not ln.lstrip().startswith("#"):
            for m in ISSUE_RE.finditer(prose):
                n = int(m.group(1))
                ok = n in ctx.issues
                yield ("issue", no, f"#{n}", "ok" if ok else "false", "" if ok else "이슈 스냅숏에 없음")
        # ports
        if ctx.ports is not None and path != ctx.cfg["ports_doc"] and not fence:
            for m in PORT_RE.finditer(prose):
                ok = m.group(1) in ctx.ports
                yield ("port", no, m.group(1), "ok" if ok else "false", "" if ok else "포트 표(" + os.path.basename(ctx.cfg["ports_doc"]) + ")에 없음")
        # code spans: paths, scripts and options, identifiers
        for c in codes:
            for tok in re.findall(r"(?<![\w/.-])((?:%s)/[\w./*<>{}가-힣-]+)" % "|".join(re.escape(r) for r in ctx.cfg["path_roots"]), c):
                tok = clean_path(tok)
                v = path_exists(ctx, tok, path)
                if v is None:
                    continue
                if not v:
                    shas = re.findall(r"(?<![0-9a-f])([0-9a-f]{7,40})(?![0-9a-f])", ln)
                    if any(ctx.in_commit(h, tok) for h in shas):
                        yield ("path", no, tok, "ok", f"커밋 {shas[0]}에 있음")
                        continue
                if not v and path_kind(ctx, tok) == "planned":
                    yield ("path", no, tok, "unverified", "계획된 경로 (아직 없음)")
                    continue
                yield ("path", no, tok, "ok" if v else "false", "" if v else "저장소에 없는 경로")
            for m in SCRIPT_RE.finditer(c):
                script = m.group(1)
                if not path_exists(ctx, script):
                    continue
                real = script if os.path.exists(os.path.join(ctx.root, script)) else ctx.suffix.get(script, script)
                try:
                    body = open(os.path.join(ctx.root, real), encoding="utf-8", errors="ignore").read()
                except OSError:
                    continue
                args = [re.sub(r"[가-힣]+$", "", x) for x in m.group(2).split()]
                for k, a in enumerate(args):
                    if a.startswith("--") and re.match(r"^--[a-z][\w-]*$", a.split("=")[0]):
                        flag = a.split("=")[0]
                        ok = flag in body or flag in ctx.code
                        yield ("option", no, f"{script} {flag}", "ok" if ok else "unverified", "" if ok else "스크립트에 없는 옵션")
                    elif k == 0 and re.match(r"^[a-z][a-z-]{2,}$", a):
                        ok = re.search(r"(?<![\w-])" + re.escape(a) + r"(?![\w-])", body) is not None
                        yield ("option", no, f"{script} {a}", "ok" if ok else "unverified", "" if ok else "스크립트에 없는 하위 명령")
            if not fence:
                t = c.strip()
                if IDENT_RE.match(t) and t not in ctx.cfg["ident_ignore"]:
                    name = t[:-2] if t.endswith("()") else t
                    name = name.split(".")[-1]
                    ok = name in ctx.names
                    yield ("ident", no, t, "ok" if ok else "unverified", "" if ok else "코드·설정에서 못 찾음")
        # numbers
        if not fence and prose.strip() and not prose.lstrip().startswith("#"):
            for m in NUM_RE.finditer(prose):
                num = m.group(1).lstrip("-")
                if is_vr:
                    if vr_id not in ctx.vr_nums:
                        continue
                    ok = num in ctx.vr_nums[vr_id] or num in ctx.code_nums   # results in the outputs, settings in the config
                    yield ("vr-number", no, m.group(0), "ok" if ok else "unverified", "" if ok else f"{vr_id} 원 출력에서 못 찾음")
                elif number_scope:
                    ok = num in ctx.ev_nums
                    yield ("number", no, m.group(0), "ok" if ok else "unverified", "" if ok else "VR·EXP·ADR에서 못 찾은 수치")


def stale_of(ctx, path, paths):
    if not ctx.git or not any(path.startswith(x) for x in ("docs/arc42/", "docs/guides/", "docs/reference/", "AGENTS.md")):
        return []
    d = ctx.last_commit(path)
    if not d:
        return []
    out = []
    for p in sorted(set(paths))[:30]:
        c = ctx.last_commit(p)
        if c and c > d and (dt.date.fromisoformat(c) - dt.date.fromisoformat(d)).days > 14:
            out.append(("stale", 0, p, "stale", f"문서 {d} 이후 코드가 {c}에 바뀜"))
    return out


def changed_files(root):
    try:
        a = subprocess.run(["git", "-C", root, "diff", "--name-only", "HEAD"], capture_output=True, text=True, timeout=20).stdout
        b = subprocess.run(["git", "-C", root, "ls-files", "--others", "--exclude-standard"], capture_output=True, text=True, timeout=20).stdout
        return {x for x in (a + b).split("\n") if x.endswith(".md")}
    except (OSError, subprocess.SubprocessError):
        return set()


def _score(ctx, qs, mode, emb=None):
    rows, hit1, rec5, mrr = [], 0, 0, 0.0
    for q in qs:
        hits = docs_search.search(ctx.idx, q["q"], k=10, mode=mode, root=ctx.root, emb=emb)
        paths = [h["path"] for h in hits]
        want = q.get("expect") or []
        rank = next((i + 1 for i, h in enumerate(paths) if any(h == w or h.startswith(w) for w in want)), None)
        hit1 += rank == 1
        rec5 += bool(rank and rank <= 5)
        mrr += 1.0 / rank if rank else 0.0
        rows.append({"q": q["q"], "kind": q.get("kind", "exact"), "expect": want, "rank": rank, "top": paths[:3], "note": q.get("note", "")})
    n = max(1, len(qs))
    return {"n": len(qs), "hit1": round(hit1 / n, 3), "recall5": round(rec5 / n, 3), "mrr": round(mrr / n, 3), "rows": rows}


def retrieval_eval(ctx, modes=("bm25", "hybrid")):
    """The question set per search mode (hybrid only when the local embedding server answers), and per kind
    (exact: asked in the documents' words, paraphrase: asked in other words)."""
    p = os.path.join(ctx.root, "docs", "quality", "questions.json")
    if not os.path.exists(p):
        return None
    qs = json.load(open(p, encoding="utf-8")).get("questions", [])
    emb = docs_search.Embedder(docs_search.EMBED_URL, ctx.root)
    out = {}
    for mode in modes:
        if mode != "bm25" and not emb.ok():
            continue
        r = _score(ctx, qs, mode, emb if mode != "bm25" else None)
        r["by_kind"] = {}
        for k in sorted({x["kind"] for x in r["rows"]}):
            rows = [x for x in r["rows"] if x["kind"] == k]
            n = max(1, len(rows))
            r["by_kind"][k] = {"n": len(rows), "hit1": round(sum(x["rank"] == 1 for x in rows) / n, 3),
                               "recall5": round(sum(bool(x["rank"] and x["rank"] <= 5) for x in rows) / n, 3),
                               "mrr": round(sum(1.0 / x["rank"] for x in rows if x["rank"]) / n, 3)}
        r["model"] = emb.model if mode != "bm25" else ""
        out[mode] = r
    best = out.get("hybrid") or out.get("bm25")
    return dict(best, modes={m: {k: v for k, v in r.items() if k != "rows"} for m, r in out.items()},
                mode="hybrid" if "hybrid" in out else "bm25")


def run(root, only=None):
    ctx = Ctx(root)
    docs = sorted(ctx.idx["docs"])
    if only:
        docs = [d for d in docs if d in only]
    findings, per_doc = [], {}
    for p in docs:
        counts = {"ok": 0, "false": 0, "unverified": 0, "stale": 0}
        paths = []
        for kind, no, text, verdict, detail in claims_of(ctx, p):
            counts[verdict] += 1
            if kind == "path" and verdict == "ok":
                paths.append(ctx.suffix.get(text, text))
            if verdict != "ok":
                findings.append({"path": p, "line": no, "kind": kind, "text": text, "verdict": verdict, "detail": detail})
        for kind, no, text, verdict, detail in stale_of(ctx, p, [x for x in paths if not x.startswith("docs/")]):
            counts[verdict] += 1
            findings.append({"path": p, "line": no, "kind": kind, "text": text, "verdict": verdict, "detail": detail})
        d = ctx.idx["docs"][p]
        per_doc[p] = dict(counts, id=d["id"], title=d["title"], layer=d["layer"],
                          mutable=not any(p.startswith(x) for x in ctx.cfg["immutable"]))
    tot = {k: sum(v[k] for v in per_doc.values()) for k in ("ok", "false", "unverified", "stale")}
    checkable = tot["ok"] + tot["false"] + tot["unverified"]
    layers = {}
    for v in per_doc.values():
        L = layers.setdefault(v["layer"], {"ok": 0, "false": 0, "unverified": 0, "stale": 0, "docs": 0})
        L["docs"] += 1
        for k in ("ok", "false", "unverified", "stale"):
            L[k] += v[k]
    kinds = {}
    for f in findings:
        k = kinds.setdefault(f["kind"], {"false": 0, "unverified": 0, "stale": 0})
        k[f["verdict"]] += 1
    summary = {"checkable": checkable, **tot,
               "false_rate": round(tot["false"] / checkable, 4) if checkable else 0.0,
               "unverified_rate": round(tot["unverified"] / checkable, 4) if checkable else 0.0,
               "grounded_rate": round(tot["ok"] / checkable, 4) if checkable else 0.0}
    return {"taken": dt.datetime.now().strftime("%Y-%m-%dT%H:%M"), "git": ctx.git, "summary": summary, "layers": layers,
            "kinds": kinds, "docs": per_doc, "findings": findings, "retrieval": retrieval_eval(ctx)}


def head_commit(root):
    try:
        return subprocess.run(["git", "-C", root, "rev-parse", "--short=7", "HEAD"], capture_output=True, text=True,
                              timeout=10).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def main():
    ap = argparse.ArgumentParser(description="Check the documents' checkable claims against their sources.")
    ap.add_argument("--root", default=os.getcwd())
    ap.add_argument("--json", action="store_true", help="print the full report as JSON")
    ap.add_argument("--changed", action="store_true", help="only documents changed against git HEAD (and untracked)")
    ap.add_argument("--only", nargs="*", help="only these documents (paths)")
    ap.add_argument("--record", action="store_true", help="append the summary to docs/quality/history.json")
    ap.add_argument("--retrieval", action="store_true", help="only the retrieval evaluation (JSON), e.g. to compare models")
    a = ap.parse_args()
    root = os.path.abspath(a.root)
    if a.retrieval:
        ctx = Ctx(root)
        print(json.dumps(retrieval_eval(ctx), ensure_ascii=False, indent=1))
        return 0
    only = set(a.only or [])
    if a.changed:
        only |= changed_files(root)
        if not only:
            print("바뀐 문서 없음")
            return 0
    rep = run(root, only or None)
    if a.json:
        print(json.dumps(rep, ensure_ascii=False, indent=1))
    else:
        s = rep["summary"]
        print(f"검증 가능한 주장 {s['checkable']}: 근거 있음 {s['ok']} ({100 * s['grounded_rate']:.1f}%), "
              f"틀림 {s['false']} ({100 * s['false_rate']:.2f}%), 확인 못 함 {s['unverified']} ({100 * s['unverified_rate']:.1f}%), 낡음 {s['stale']}")
        r = rep["retrieval"]
        if r:
            for m, x in (r.get("modes") or {}).items():
                kinds = ", ".join(f"{k} {v['recall5']:.2f}" for k, v in (x.get("by_kind") or {}).items())
                print(f"검색 평가 [{m}{' ' + x['model'].split('/')[-1] if x.get('model') else ''}] {x['n']}문항: hit@1 {x['hit1']:.2f}, recall@5 {x['recall5']:.2f} ({kinds}), MRR {x['mrr']:.2f}")
        for f in sorted(rep["findings"], key=lambda f: ({"false": 0, "stale": 1, "unverified": 2}[f["verdict"]], f["path"], f["line"])):
            if f["verdict"] == "false" or only:
                print(f"  {f['verdict']:<10} {f['path']}:{f['line']}  [{f['kind']}] {f['text']}  {f['detail']}")
    if a.record:
        hp = os.path.join(root, "docs", "quality", "history.json")
        h = json.load(open(hp, encoding="utf-8")) if os.path.exists(hp) else {"runs": []}
        s = dict(rep["summary"], date=dt.date.today().isoformat(), commit=head_commit(root))
        if rep["retrieval"]:
            s.update({k: rep["retrieval"][k] for k in ("hit1", "recall5", "mrr")})
        h["runs"] = [x for x in h["runs"] if x.get("date") != s["date"]] + [s]
        os.makedirs(os.path.dirname(hp), exist_ok=True)
        with open(hp, "w", encoding="utf-8") as f:
            json.dump(h, f, ensure_ascii=False, indent=1)
            f.write("\n")
        print(f"기록: {os.path.relpath(hp, root)} ({s['date']})")
        if rep["retrieval"]:
            rp = os.path.join(root, "docs", "quality", "retrieval.json")
            with open(rp, "w", encoding="utf-8") as f:
                json.dump(dict(rep["retrieval"], taken=rep["taken"], commit=s["commit"]), f, ensure_ascii=False, indent=1)
                f.write("\n")
            print(f"검색 평가 기록: {os.path.relpath(rp, root)} (방식: {', '.join(rep['retrieval'].get('modes', {}))})")
    return 1 if (only and rep["summary"]["false"]) else 0


if __name__ == "__main__":
    sys.exit(main())
