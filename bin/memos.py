#!/usr/bin/env python3
"""Work memos (memos tab) for agents and people: find and read the memos written in the memo app.

    .docs-kit/bin/memos.py list                                   memos (not archived / trashed), newest first
    .docs-kit/bin/memos.py list --work "업무 이름" --tag 회의 --since 2026-11-01 --until 2026-11-30 -q 접촉
    .docs-kit/bin/memos.py list --archived --json                 also archived ones; machine-readable
    .docs-kit/bin/memos.py show 20261121-153012 20261120          full text (an id, or the start of ids: a day)
    .docs-kit/bin/memos.py show work:"업무 이름" tag:회의 since:2026-11-01

Selectors (show, and weekly_draft.py --memos): a memo id or its start (20261121 = that day), tag:<tag> (also its
sub-tags), work:<업무>, since:<YYYY-MM-DD>, until:<YYYY-MM-DD> (by the day the memo was written). Ids and tags/works
add memos; since/until narrow them. Archived memos count when named or selected; trashed ones never.
Where memos live: docs-kit.yml `memos.dir` (default docs/memos). Standard library only (Python 3.8+); reads files only.
"""
import argparse
import json
import os
import re
import sys

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.abspath(os.environ.get("DOCS_ROOT") or os.path.dirname(KIT))
ID = re.compile(r"^\d{8}-\d{6}(-\d+)?$")


def memo_dir(root=ROOT):
    d = "docs/memos"
    p = os.path.join(root, "docs-kit.yml")
    if os.path.exists(p):
        text = open(p, encoding="utf-8").read()
        m = re.search(r"^memos\s*:\s*\{[^}\n]*\bdir\s*:\s*['\"]?([^,'\"}\n]+)", text, re.M) or \
            re.search(r"^memos\s*:\s*\n(?:[ \t]+.*\n)*?[ \t]+dir\s*:\s*['\"]?([^'\"#\n]+)", text, re.M)
        if m:
            d = m.group(1).strip()
    return os.path.normpath(os.path.join(root, d))


def _value(v):
    v = v.strip()
    if not v:
        return ""
    try:
        return json.loads(v)
    except ValueError:
        pass
    if v.startswith("[") and v.endswith("]"):
        return [x.strip().strip("'\"") for x in v[1:-1].split(",") if x.strip()]
    if v in ("true", "false"):
        return v == "true"
    return v.strip("'\"")


def parse(mid, text):
    meta, body = {}, text.replace("\r\n", "\n")
    m = re.match(r"^---\n(.*?)\n---\n?(.*)$", body, re.S)
    if m:
        body = m.group(2)
        try:
            import yaml  # noqa: F401
            meta = yaml.safe_load(m.group(1)) or {}
        except Exception:  # noqa: BLE001 - no PyYAML or odd YAML: the simple line reader below
            meta = {}
            for line in m.group(1).split("\n"):
                k = re.match(r"^([A-Za-z_]+)\s*:\s*(.*)$", line)
                if k:
                    meta[k.group(1)] = _value(k.group(2))
    body = body.lstrip("\n")
    first = next((l for l in body.split("\n") if l.strip()), "")
    tags = meta.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",")]
    s = lambda k: "" if meta.get(k) is None else str(meta.get(k))  # noqa: E731
    return {"id": mid, "title": s("title") or re.sub(r"^#+\s*", "", first)[:80], "created": s("created"),
            "updated": s("updated") or s("created"), "work": s("work"), "tags": [str(t).lstrip("#") for t in tags if str(t).strip()],
            "pinned": meta.get("pinned") is True, "archived": meta.get("archived") is True, "trashed": s("trashed"), "body": body}


def load(root=ROOT):
    d = memo_dir(root)
    out = []
    for f in sorted(os.listdir(d)) if os.path.isdir(d) else []:
        mid = f[:-3]
        if f.endswith(".md") and ID.match(mid):
            out.append(parse(mid, open(os.path.join(d, f), encoding="utf-8").read()))
    return sorted(out, key=lambda m: m["updated"], reverse=True)


def has_tag(m, t):
    return any(x == t or x.startswith(t + "/") for x in m["tags"])


def select(memos, selectors):
    """Memos named by selectors (see the module help), oldest first. Unknown selectors -> SystemExit with a message."""
    live = [m for m in memos if not m["trashed"]]
    picked, since, until, bad = [], None, None, []
    for s in selectors:
        if s.startswith("since:"):
            since = s[6:]
        elif s.startswith("until:"):
            until = s[6:]
        elif s.startswith("tag:"):
            picked += [m for m in live if has_tag(m, s[4:].lstrip("#"))]
        elif s.startswith("work:"):
            picked += [m for m in live if m["work"] == s[5:]]
        elif re.match(r"^\d{8}(-\d{0,6}(-\d+)?)?$", s):
            hit = [m for m in live if m["id"].startswith(s)]
            if not hit:
                bad.append(s)
            picked += hit
        else:
            bad.append(s)
    if bad:
        raise SystemExit("no memo for: %s (ids from `memos.py list`, or tag:<태그>, work:<업무>, since:/until:<날짜>)" % ", ".join(bad))
    if not picked and (since or until):
        picked = [m for m in live if not m["archived"]]
    seen, out = set(), []
    for m in picked:
        day = m["created"][:10]
        if m["id"] in seen or (since and day < since) or (until and day > until):
            continue
        seen.add(m["id"])
        out.append(m)
    return sorted(out, key=lambda m: m["created"])


def as_text(m, level=2):
    """A memo as Markdown under a heading of `level`; headings in its body move below that level."""
    head = [f"{'#' * level} {m['id']} {m['title']}", "",
            f"- 업무: {m['work'] or '(없음)'}", f"- 태그: {', '.join('#' + t for t in m['tags']) or '(없음)'}",
            f"- 쓴 날: {m['created'][:16].replace('T', ' ')} · 고친 날: {m['updated'][:16].replace('T', ' ')}"]
    if m["archived"]:
        head.append("- 보관함")
    body, fence = [], False
    for line in m["body"].rstrip().split("\n"):
        if line.startswith(("```", "~~~")):
            fence = not fence
        body.append("#" * level + line if not fence and re.match(r"^#{1,6}\s", line) else line)
    return "\n".join(head) + "\n\n" + "\n".join(body) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter,
                                 epilog=__doc__.split("\n\n", 1)[1])
    sub = ap.add_subparsers(dest="cmd", required=True)
    ls = sub.add_parser("list", help="find memos")
    ls.add_argument("--work", help="업무 (exact)")
    ls.add_argument("--tag", action="append", default=[], help="tag (also its sub-tags); repeat for all of them")
    ls.add_argument("--since", help="written on or after YYYY-MM-DD")
    ls.add_argument("--until", help="written on or before YYYY-MM-DD")
    ls.add_argument("-q", "--query", help="words that must all appear (title, body, 업무, tags)")
    ls.add_argument("--archived", action="store_true", help="include archived memos")
    ls.add_argument("--trash", action="store_true", help="only memos in the trash")
    ls.add_argument("--json", action="store_true")
    sh = sub.add_parser("show", help="print memos in full")
    sh.add_argument("selectors", nargs="+")
    sh.add_argument("--json", action="store_true")
    a = ap.parse_args()
    memos = load()
    if a.cmd == "list":
        out = []
        for m in memos:
            if a.trash != bool(m["trashed"]) or (m["archived"] and not a.archived and not a.trash):
                continue
            day = m["created"][:10]
            if (a.work and m["work"] != a.work) or any(not has_tag(m, t.lstrip("#")) for t in a.tag) \
                    or (a.since and day < a.since) or (a.until and day > a.until):
                continue
            if a.query:
                hay = " ".join([m["title"], m["body"], m["work"], " ".join("#" + t for t in m["tags"])]).lower()
                if not all(w in hay for w in a.query.lower().split()):
                    continue
            out.append(m)
        if a.json:
            print(json.dumps([{k: v for k, v in m.items() if k != "body"} for m in out], ensure_ascii=False, indent=1))
            return
        if not out:
            print(f"(no memos in {os.path.relpath(memo_dir(), ROOT)})")
            return
        for m in out:
            flags = ("*" if m["pinned"] else " ") + ("a" if m["archived"] else " ")
            tags = " ".join("#" + t for t in m["tags"])
            print(f"{m['id']}{flags} {m['created'][:10]}  [{m['work'] or '-'}]  {m['title']}  {tags}".rstrip())
        print(f"\n{len(out)} memo(s) in {os.path.relpath(memo_dir(), ROOT)}  (* pinned, a archived)")
    else:
        picked = select(memos, a.selectors)
        if a.json:
            print(json.dumps(picked, ensure_ascii=False, indent=1))
            return
        if not picked:
            sys.exit("no memos selected")
        print("\n".join(as_text(m) for m in picked))


if __name__ == "__main__":
    main()
