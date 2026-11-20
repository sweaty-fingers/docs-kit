#!/usr/bin/env python3
"""Material for the next weekly report (docs/weekly/, 문서 규격 §5.2): what happened since the previous report.

    .docs-kit/bin/weekly_draft.py                       material since the last report -> build/weekly/<today>_material.md
    .docs-kit/bin/weekly_draft.py --since 2026-01-05    first report: from the project start
    .docs-kit/bin/weekly_draft.py --write               also create docs/weekly/<today>.md (skeleton; never overwrites)
    .docs-kit/bin/weekly_draft.py --branch origin/main  the branch whose commits count (default: origin/main, else HEAD)

Collected (the agent writes the report from this; the person edits it):
  - the previous report's 다음 bullets per work item and its 회의 메모
  - issues from the tracker snapshot docs/plan/issues.json, by milestone (= work item): closed / opened in the period,
    still open, and issues labelled `meeting`. The snapshot is the project's own export (e.g. a GitLab or GitHub script):
        {"taken": "YYYY-MM-DD HH:MM", "issues": [{"iid": 12, "title": "...", "state": "opened|closed",
          "labels": ["..."], "milestone": "name or null", "created": "YYYY-MM-DD", "closed": "YYYY-MM-DD or null"}]}
    Without it this part is skipped (refresh it before writing the report).
  - the branch's commits, documents added (VR, ADR, EXP, P, G, R, 배경), rows of docs/history.md in the period
Work items are the roadmap's units (docs/roadmap/roadmap.yml) and the snapshot's milestones, so the report uses the same
names every week. Standard library only (Python 3.8+), runs on the host; nothing is sent anywhere.
"""
import argparse
import datetime
import json
import os
import re
import subprocess
import sys

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.abspath(os.environ.get("DOCS_ROOT") or os.path.dirname(KIT))
WEEKLY = os.path.join(ROOT, "docs", "weekly")
_REPORT = re.compile(r"^(\d{4}-\d{2}-\d{2})\.md$")
DOC_KINDS = [("docs/records/", "VR"), ("docs/adr/", "ADR"), ("docs/experiments/", "EXP"), ("docs/publications/", "P"),
             ("docs/guides/", "G"), ("docs/reference/", "R"), ("docs/background/", "배경")]


def reports():
    return sorted(f[:-3] for f in os.listdir(WEEKLY) if _REPORT.match(f)) if os.path.isdir(WEEKLY) else []


def git(*args):
    r = subprocess.run(["git", "-C", ROOT, *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
    return r.stdout if r.returncode == 0 else ""


def in_period(day, since, until):
    return bool(day) and since <= str(day)[:10] <= until


def previous_report(date):
    text = open(os.path.join(WEEKLY, date + ".md"), encoding="utf-8").read()
    nxt, work, memo, sec = [], None, [], None
    for line in text.splitlines():
        if line.startswith("## "):
            sec, work = line, None
            continue
        if line.startswith("### "):
            work = re.sub(r"^###\s+[\d.]+\s*", "", line)
            continue
        if sec and "회의 메모" in sec and line.strip():
            memo.append(line)
        m = re.match(r"^- \*\*다음\*\*\s*:?\s*(.*)$", line)
        if m and work:
            nxt.append(f"- {work}: {m.group(1)}")
    return nxt, memo


def units():
    """Work item names from the roadmap (units), in order."""
    p = os.path.join(ROOT, "docs", "roadmap", "roadmap.yml")
    if not os.path.exists(p):
        return []
    names, inside = [], False
    for line in open(p, encoding="utf-8"):
        if re.match(r"^units\s*:", line):
            inside = True
            continue
        if inside and re.match(r"^\S", line):
            break
        m = re.search(r"\bname:\s*([^,}]+)", line) if inside else None
        if m:
            names.append(m.group(1).strip().strip("\"'"))
    return names


def issue_line(i):
    closed = f" {i['closed']}" if i.get("closed") else ""
    return f"- #{i['iid']} [{i['state']}{closed}] {i['title']} ({','.join(i.get('labels') or [])})"


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--since", help="start date (default: the last report's date)")
    p.add_argument("--until", default=datetime.date.today().isoformat())
    p.add_argument("--branch", help="branch whose commits count (default: origin/main if it exists, else HEAD)")
    p.add_argument("--write", action="store_true", help="create docs/weekly/<until>.md as a skeleton")
    a = p.parse_args()
    prev = [d for d in reports() if d < a.until]
    since = a.since or (prev[-1] if prev else None)
    if not since:
        sys.exit("no previous report: give --since <project start date>")
    branch = a.branch or ("origin/main" if git("rev-parse", "--verify", "-q", "origin/main").strip() else "HEAD")
    out = [f"# 주간 보고 재료 {since} ~ {a.until}", "",
           f"이전 보고: docs/weekly/{prev[-1]}.md" if prev else "이전 보고: 없음 (첫 보고)", ""]
    if prev:
        nxt, memo = previous_report(prev[-1])
        out += ["## 지난 보고의 '다음'", ""] + (nxt or ["(없음)"]) + ["", "## 지난 보고의 회의 메모", ""] + (memo or ["(없음)"]) + [""]

    groups = units()
    snap = os.path.join(ROOT, "docs", "plan", "issues.json")
    if os.path.exists(snap):
        d = json.load(open(snap, encoding="utf-8"))
        issues = d.get("issues", d) if isinstance(d, dict) else d
        out += [f"이슈 스냅숏: docs/plan/issues.json ({d.get('taken', '?') if isinstance(d, dict) else '?'})", ""]
        meeting = [i for i in issues if "meeting" in (i.get("labels") or [])
                   and (i["state"] == "opened" or in_period(i.get("closed"), since, a.until))]
        out += ["## 회의 요청 이슈 (`meeting`)", ""] + ([issue_line(i) for i in meeting] or ["(없음)"]) + [""]
        for i in issues:
            ms = i.get("milestone") or "(마일스톤 없음)"
            if ms not in groups:
                groups.append(ms)
        out += ["## 업무별 이슈 (마일스톤)", ""]
        for g in groups:
            mine = [i for i in issues if (i.get("milestone") or "(마일스톤 없음)") == g]
            closed = [i for i in mine if in_period(i.get("closed"), since, a.until)]
            opened = [i for i in mine if in_period(i.get("created"), since, a.until) and i not in closed]
            still = [i for i in mine if i["state"] == "opened" and i not in opened]
            if closed or opened or still:
                out += [f"### {g}", "", "닫힘:"] + [issue_line(i) for i in closed] + ["새로 열림:"]
                out += [issue_line(i) for i in opened] + ["계속 열림:"] + [issue_line(i) for i in still] + [""]
    else:
        out += ["(이슈 스냅숏 docs/plan/issues.json 없음: 이슈는 트래커에서 직접 확인)", ""]

    rng = ["--since", since + " 00:00", "--until", a.until + " 23:59:59", branch]
    log = git("log", "--no-merges", "--format=- %ad %h %s", "--date=short", *rng).strip()
    out += [f"## 커밋 ({branch})", "", log or "(없음)", ""]
    added = git("log", "--diff-filter=A", "--name-only", "--format=", *rng).split()
    out += ["## 새 문서", ""]
    for prefix, kind in DOC_KINDS:
        files = sorted({f for f in added if f.startswith(prefix) and f.endswith(".md") and "/assets/" not in f
                        and not f.endswith(("README.md", "template.md"))})
        if files:
            out.append(f"- {kind}: " + ", ".join(f[len("docs/"):] for f in files))
    out.append("")
    hist = os.path.join(ROOT, "docs", "history.md")
    rows = [l.rstrip() for l in open(hist, encoding="utf-8") if re.match(r"^\| \d{4}-\d{2}-\d{2} \|", l)
            and since <= l[2:12] <= a.until] if os.path.exists(hist) else []
    out += ["## 작업 내역 줄", ""] + (rows or ["(없음)"]) + [""]

    os.makedirs(os.path.join(ROOT, "build", "weekly"), exist_ok=True)
    path = os.path.join(ROOT, "build", "weekly", f"{a.until}_material.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    print(f"material: {os.path.relpath(path, ROOT)} ({len(log.splitlines())} commits)")

    if a.write:
        dest = os.path.join(WEEKLY, a.until + ".md")
        if os.path.exists(dest):
            print(f"keep: {os.path.relpath(dest, ROOT)} exists")
            return
        names = [g for g in groups if g != "(마일스톤 없음)"] + ["그 밖"]
        work = "\n\n".join(f"### 3.{n} {g}\n\n- **배경**: \n- **한 일**: \n- **결과**: \n- **다음**: "
                           for n, g in enumerate(names, 1))
        who = git("config", "user.name").strip() or "<이름>"
        body = (f"---\ndate: {a.until}\nfrom: {since}\nstatus: draft\nby: [{who}]\n---\n\n# {a.until} 주간 보고\n\n"
                "## 1. 요약\n\n| 구분 | 내용 | 자세히 |\n| --- | --- | --- |\n| 막힌 것 | | |\n| 정할 것 | | §4 |\n\n"
                "## 2. 지난 회의 요청사항\n\n| 요청 | 이슈 | 상태 | 다룬 곳 |\n| --- | --- | --- | --- |\n\n"
                f"## 3. 업무별 진행\n\n{work}\n\n## 4. 정할 것과 도움 필요\n\n없음\n\n## 5. 회의 메모\n\n")
        os.makedirs(WEEKLY, exist_ok=True)
        with open(dest, "w", encoding="utf-8") as f:
            f.write(body)
        print(f"created: {os.path.relpath(dest, ROOT)} (skeleton; fill it from the material)")


if __name__ == "__main__":
    main()
