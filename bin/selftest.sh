#!/usr/bin/env bash
# Build throwaway projects from template/ with this kit (Astro edition) and fail on any WARNING or a missing output.
#   bin/selftest.sh            DOCS_RUNNER=docker|host as for bin/docs.sh (host: Node >= 22.18 on this machine)
# Checks (prd.md §10): every profile builds with no warning and its tabs in the standard order; a minimal project
# builds clean again after enable / disable; the fixture project (tests/fixtures/all/) renders the Markdown of
# FR-MD and the common features; kit.py migrate moves mkdocs.yml settings. (External requests are allowed since
# 2026-11-20, prd.md §0: no offline check.)
# Tab modules that come in later milestones (M4-M6) add their checks here when they are built.
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/docs-kit-selftest.XXXXXX")"
trap '[ -n "${KEEP_TMP:-}" ] || rm -rf "$TMP"' EXIT
bad=""
fail() { bad+=$'\n'"$1"; }

build() { # project dir -> build log (no exit on failure)
  DOCS_ROOT="$1" "$KIT/bin/docs.sh" build 2>&1 || echo "ERROR: build failed"
}
warnings() { grep -E '^(WARNING|ERROR)|ERROR:|\[(ERROR|WARN)\]' <<<"$1" | sed "s/^/$2: /" || true; }
tabs() { python3 -c 'import re,sys; print(" | ".join(re.findall(r"class=\"kit-tab\"[^>]*>\s*([^<]+?)\s*<", open(sys.argv[1], encoding="utf-8").read())))' "$1/build/site/index.html"; }
newproj() { # name profile
  mkdir -p "$TMP/$1"
  DOCS_ROOT="$TMP/$1" python3 "$KIT/bin/kit.py" init --name "$1" --profile "$2" >/dev/null
}

# ---- 0. unit tests of the site modules (prd.md §10), when Node is on the host
if command -v node >/dev/null 2>&1 && [[ -d "$KIT/site/node_modules" ]]; then
  ut="$(cd "$KIT/site" && node --test tests/*.test.ts 2>&1)" || fail "unit tests failed:"$'\n'"$(grep -E '^not ok|✖' <<<"$ut" | head -20)"
fi

# ---- 1. every profile: no warning, tabs in the standard order (docs-standard §2, features.json ranks)
for prof in minimal app dev research all; do
  newproj "p-$prof" "$prof"
  log="$(build "$TMP/p-$prof")"
  w="$(warnings "$log" "$prof")"; [[ -z "$w" ]] || fail "$w"
  t="$(tabs "$TMP/p-$prof")"
  want="$(python3 - "$KIT" "$prof" "$TMP/p-$prof" <<'PY'
import json, os, sys
kit, prof, root = sys.argv[1:]
c = json.load(open(os.path.join(kit, "site/src/config/features.json"), encoding="utf-8"))
on = set(c["profiles"][prof]["features"])
titles = ["개요"]
for f in sorted(c["features"], key=lambda f: f["rank"]):
    if f["id"] not in on or f["id"] == "history":       # history lives under 개요
        continue
    if f["id"] == "roadmap" and not os.path.exists(os.path.join(root, "docs/roadmap/roadmap.yml")): continue
    if f["id"] == "plan" and not os.path.exists(os.path.join(root, "docs/plan/scope.yml")): continue
    if f["id"] == "quality" and not os.path.isdir(os.path.join(root, "docs/quality")): continue
    titles.append(f["title"])
print(" | ".join(titles + ["문서 규격", "문서 사이트 사용법"]))
PY
)"
  [[ "$t" == "$want" ]] || fail "$prof: tabs '$t', expected '$want'"
done

# ---- 2. minimal → enable / disable (docs-kit-context §11.2)
T2="$TMP/p-minimal"
t="$(tabs "$T2")"; [[ "$t" == *ADR* && "$t" != *현황판* && "$t" != *"문서 지도"* ]] || fail "minimal: unexpected tabs: $t"
DOCS_ROOT="$T2" python3 "$KIT/bin/kit.py" enable plan roadmap weekly >/dev/null
DOCS_ROOT="$T2" python3 "$KIT/bin/kit.py" disable glossary >/dev/null
[[ -f "$T2/docs/plan/scope.yml" && -f "$T2/docs/roadmap/roadmap.yml" ]] || fail "kit.py enable: starters not copied"
log="$(build "$T2")"; w="$(warnings "$log" enabled)"; [[ -z "$w" ]] || fail "$w"
t="$(tabs "$T2")"; [[ "$t" == *현황판*주간\ 보고*로드맵*ADR* && "$t" != *용어집* ]] || fail "kit.py enable/disable: tabs $t"

# ---- 3. the fixture project: every tab, the fixtures of tests/fixtures/all/
P="$TMP/p-all"
cp -r "$KIT/tests/fixtures/all/docs/." "$P/docs/"
cat "$KIT/tests/fixtures/all/README.append.md" >> "$P/docs/README.md"
log="$(build "$P")"; w="$(warnings "$log" all)"; [[ -z "$w" ]] || fail "$w"
S="$P/build/site"
for f in index.html docs-kit.html docs-standard.html adr/index.html adr/log.html adr/c4.html adr/guide.html \
         adr/0001-record-architecture-decisions.html adr/viewer/index.html adr/viewer/vendor/elk.bundled.js r/home/index.html \
         experiments/list.html weekly/index.html weekly/threads.html weekly/2026-01-12.html roadmap/index.html roadmap/guide.html \
         graph/index.html plan/index.html plan/guide.html plan/sprints.html quality/index.html glossary/index.html guides/g2_markdown.html \
         _kit/kit.css _kit/kit.js _kit/vendor/mermaid/mermaid.esm.min.mjs _kit/vendor/katex/katex.min.css _kit/vendor/pretendard/pretendardvariable-dynamic-subset.css \
         _kit/vendor/jetbrains-mono/index.css _kit/pagefind/pagefind.js; do
  [[ -f "$S/$f" ]] || fail "MISSING build/site/$f"
done
tr -d '\n' < "$S/index.html" | grep -qE '<p>설명:</p>[[:space:]]*<ul>[[:space:]]*<li><strong>상위</strong>:[[:space:]]*<ul>' \
  || fail "lists: 2-space nested list or list under text not rendered as nested lists"
md="$(python3 - "$S/guides/g2_markdown.html" <<'PY'
import sys
h = open(sys.argv[1], encoding="utf-8").read()
a = h[h.find("<article"):h.find("</article>")]
checks = {
    "admonition": 'class="admonition tip"' in a and "도움말 제목" in a and '<p class="admonition-title">Warning</p>' in a,
    "details": '<details class="admonition info">' in a and '<details class="admonition note" open>' in a,
    "nested admonition": 'class="admonition danger"' in a,
    "content tabs": a.count('class="kit-tabs__panel"') == 2,
    "table row anchor": 'id="sec-2-2-1"' in a,
    "attr_list": 'id="para-id"' in a and "kit-test-link" in a,
    "math": 'class="katex"' in a and "katex-display" in a,
    "mermaid": '<pre class="mermaid">' in a,
    "task list": a.count("kit-task") == 2,
    "indented code": "indented code block" in a and "<pre" in a,
    "snippet": "끼워 넣은 문장입니다." in a,
    "snippet escape": '--8&#x3C;-- "guides/_snippet.txt:part"' in a,
    "md in html": "kit-dev-only" in a and "<strong>Markdown</strong>" in a,
    "short links": "kit-short" in a,
    "section links": 'href="#21-' in a and "01_background.html#1-" in a and "g1_getting_started.html#2-" in a,
}
print(" ".join(k for k, v in checks.items() if not v))
PY
)"
[[ -z "$md" ]] || fail "markdown (guides/g2_markdown.html) not as expected: $md"
grep -q 'location.replace' "$S/r/home/index.html" || fail "short address r/home/ is not a redirect page"
# record tabs (M4): indexes, cards with back links, the C4 viewer data
rec="$(python3 - "$S" <<'PY'
import json, re, sys
S = sys.argv[1]
def art(p):
    h = open(f"{S}/{p}", encoding="utf-8").read()
    return h[h.find("<article"):h.find("</article>")]
d = json.load(open(f"{S}/adr/viewer/data.json", encoding="utf-8"))
adr2 = art("adr/0002-build-the-site-with-astro.html")
checks = {
    "adr index": "ADR-0002" in art("adr/index.html") and "adr-status--accepted" in art("adr/index.html"),
    "adr log": "docs-kit Astro" in art("adr/log.html"),
    "adr card back links": "0001-site-builds.html" in adr2 and "0001-search-quality.html" in adr2,
    "vr index": "VR-0001" in art("records/index.html"),
    "exp index": "EXP-0001" in art("experiments/list.html"),
    "arc42 index": len(re.findall(r'href="a\d\d_', art("arc42/index.html"))) == 12,
    "publication card": "a01_goals.html" in art("publications/0001-overview.html"),
    "c4 data": [v["id"] for v in d["views"]] == ["context", "system"] and d["elements"]["app"].get("records") == ["0001"]
               and d["adrs"]["0002"].get("records") == ["0001"],
    "c4 view embed": "viewer/index.html?embed=1#view=context" in art("guides/g2_markdown.html"),
}
print(" ".join(k for k, v in checks.items() if not v))
PY
)"
[[ -z "$rec" ]] || fail "record tabs not as expected: $rec"
# ---- 4. ask (bin/docs_ask.py): the per-sentence citation check (host Python, no model needed)
ask="$(python3 - "$KIT/bin" <<'PY'
import sys; sys.path.insert(0, sys.argv[1]); import docs_ask as a
ev = [{"text": "한도는 8 N, 포트 8001, 경로 tools/x.sh", "path": "docs/x.md"}]
got = [s["verdict"] for s in a.check("한도는 8 N이다 [1]. 최대 12 N이다 [1]. 근거 없는 문장. 없는 번호 [3]. 문서에서 확인 못 함", ev)[0]]
print(" ".join(got))
PY
)"
[[ "$ask" == "supported unverified unsupported unsupported none" ]] || fail "ask: citation check gave '$ask'"

# ---- 5. kit.py migrate: mkdocs.yml settings move to docs-kit.yml, a second run changes nothing
M="$TMP/p-migrate"; newproj p-migrate minimal
python3 - "$M/docs-kit.yml" <<'PY'
import re, sys
p = sys.argv[1]; t = open(p, encoding="utf-8").read()
t = re.sub(r"\nsite:.*", "\n", t, flags=re.S)          # an old project: no site / links / nav in docs-kit.yml
open(p, "w", encoding="utf-8").write(t)
PY
cat > "$M/mkdocs.yml" <<'YML'
INHERIT: .docs-kit/mkdocs.base.yml
site_name: "옛 프로젝트"
extra:
  links:
    shared_port: 8000
    short:
      - {name: home, to: README.md, title: 첫 페이지}
markdown_extensions:
  - toc:
      slugify: !!python/object/apply:pymdownx.slugs.slugify
        kwds: {case: lower}
nav:
  - 개요: README.md
YML
log="$(build "$M")"; grep -q 'settings read from mkdocs.yml' <<<"$log" || fail "migrate: no warning while settings are in mkdocs.yml"
DOCS_ROOT="$M" python3 "$KIT/bin/kit.py" migrate >/dev/null
grep -q '^site:' "$M/docs-kit.yml" && grep -q 'name: "옛 프로젝트"' "$M/docs-kit.yml" && grep -q 'shared_port: 8000' "$M/docs-kit.yml" \
  || fail "migrate: site settings not written to docs-kit.yml"
before="$(cat "$M/docs-kit.yml")"; DOCS_ROOT="$M" python3 "$KIT/bin/kit.py" migrate >/dev/null
[[ "$before" == "$(cat "$M/docs-kit.yml")" ]] || fail "migrate: a second run changed docs-kit.yml"
log="$(build "$M")"; w="$(warnings "$log" migrated)"; [[ -z "$w" ]] || fail "$w"
# record checks: a broken ADR (no front matter, wrong title number) gives its warnings
printf '# ADR-0005. 번호가 다른 결정\n' > "$M/docs/adr/0003-broken.md"
log="$(build "$M")"
grep -q "WARNING adr: adr/0003-broken.md: front matter 'status' is missing" <<<"$log" && grep -q "title number ADR-0005 does not match" <<<"$log" \
  || fail "adr checks: no warning for a broken ADR"

if [[ -n "$bad" ]]; then
  echo "$bad"; echo "selftest FAILED"; exit 1
fi
echo "selftest OK ($(find "$S" -name '*.html' | wc -l | tr -d ' ') pages)"
