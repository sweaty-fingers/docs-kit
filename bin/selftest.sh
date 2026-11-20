#!/usr/bin/env bash
# Build a throwaway project from template/ with this kit and fail on any
# MkDocs WARNING/ERROR or a missing viewer data file.
#   bin/selftest.sh            (needs Docker; no network beyond the image)
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${DOCS_IMAGE:-squidfunk/mkdocs-material:9.5.49}"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/docs-kit-selftest.XXXXXX")"
trap '[ -n "${KEEP_TMP:-}" ] || rm -rf "$TMP"' EXIT

mkdir -p "$TMP/.docs-kit"
tar -C "$KIT" --exclude=.git -cf - . | tar -C "$TMP/.docs-kit" -xf -
DOCS_ROOT="$TMP" "$TMP/.docs-kit/bin/init.sh" "Selftest" all >/dev/null   # every tab (hooks/kitconf.py)
# Fixtures (tests/fixtures/all/): two weekly reports, a roadmap with two tracks that merge, a scope with an epic,
# a far range and a question, a sprint, a risk, a retrieval question, topics; README.append.md cites a missing
# ADR-0999 (grounding) and has 2-space nesting and a list right under text (hooks/lists.py).
FIX="$KIT/tests/fixtures/all"
cp -r "$FIX/docs/." "$TMP/docs/"
cat "$FIX/README.append.md" >> "$TMP/docs/README.md"

if ! log="$(docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$TMP:/docs" -w /docs "$IMAGE" build 2>&1)"; then
  echo "$log" | tail -20; echo "selftest FAILED (build error)"; exit 1
fi
bad="$(echo "$log" | grep -E '^(WARNING|ERROR)' || true)"
for f in index.html docs-kit.html adr/index.html adr/log.html adr/c4.html adr/guide.html \
         adr/0001-record-architecture-decisions.html adr/viewer/index.html adr/viewer/data.json \
         adr/viewer/vendor/elk.bundled.js _kit/stylesheets/theme.css r/home/index.html _kit/javascripts/links.js experiments/list.html weekly/index.html weekly/threads.html weekly/2026-01-12.html \
         _kit/vendor/mathjax/tex-mml-chtml.js _kit/vendor/mermaid/mermaid.min.js \
         roadmap/index.html roadmap/guide.html roadmap/items/ab.html roadmap/viewer/index.html roadmap/viewer/data.js \
         graph/index.html graph/viewer/index.html graph/viewer/data.js plan/index.html plan/guide.html plan/sprints.html plan/board/index.html plan/board/data.js quality/index.html; do
  [[ -f "$TMP/build/site/$f" ]] || bad+=$'\n'"MISSING build/site/$f"
done
n="$(grep -c '보고 2026-01-' "$TMP/build/site/weekly/threads.html" || true)"
[[ "$n" == 2 ]] || bad+=$'\n'"weekly threads: expected both reports, found $n"
grep -q 'rm-embed' "$TMP/build/site/roadmap/index.html" && grep -q 'rm-merge' "$TMP/build/site/roadmap/viewer/data.js" \
  && grep -q '"kind": "adr"' "$TMP/build/site/roadmap/viewer/data.js" \
  || bad+=$'\n'"roadmap: no viewer embed in roadmap/index.html, or no map / grouped refs in viewer/data.js"
grep -q '"topics": \[\["a", "갈래 A"\]' "$TMP/build/site/graph/viewer/data.js" && grep -q '"short": "ADR-0001"' "$TMP/build/site/graph/viewer/data.js" && grep -q 'viewer/index.html?embed=1' "$TMP/build/site/graph/index.html" \
  || bad+=$'\n'"graph: no ADR node in graph/viewer/data.js, or no viewer on graph/index.html"
grep -q 'class="pl-svg"' "$TMP/build/site/plan/index.html" && grep -q 'data-rval="4,5"><span class="pl-pi-s">20</span><a href="#r01"' "$TMP/build/site/plan/index.html" && grep -q 'id="ep-e1"' "$TMP/build/site/plan/index.html" \
  || bad+=$'\n'"plan: no burn-up or R01 not in the PI matrix cell 20 on plan/index.html"
grep -q '"id": "W1"' "$TMP/build/site/plan/board/data.js" && grep -q 'pl-vel' "$TMP/build/site/plan/sprints.html" \
  || bad+=$'\n'"plan: no card W1 in plan/board/data.js or no velocity chart on plan/sprints.html"
grep -q 'ADR-0999' "$TMP/build/site/quality/index.html" && grep -q '검색 평가' "$TMP/build/site/quality/index.html" \
  || bad+=$'\n'"quality: ADR-0999 not reported as false, or no retrieval evaluation on quality/index.html"
tr -d '\n' < "$TMP/build/site/index.html" | grep -qE '<p>설명:</p>[[:space:]]*<ul>[[:space:]]*<li><strong>상위</strong>:[[:space:]]*<ul>' \
  || bad+=$'\n'"lists: 2-space nested list or list under text not rendered as nested lists"
# Pages must not load scripts from a CDN.
cdn="$(grep -lE 'src="https?://' "$TMP"/build/site/*.html "$TMP"/build/site/adr/*.html 2>/dev/null || true)"
[[ -z "$cdn" ]] || bad+=$'\n'"EXTERNAL SCRIPT in: $cdn"
# Ask (bin/docs_ask.py): the per-sentence citation check (host Python, no model needed).
ask="$(python3 - "$KIT/bin" <<'PY'
import sys; sys.path.insert(0, sys.argv[1]); import docs_ask as a
ev = [{"text": "한도는 8 N, 포트 8001, 경로 tools/x.sh", "path": "docs/x.md"}]
got = [s["verdict"] for s in a.check("한도는 8 N이다 [1]. 최대 12 N이다 [1]. 근거 없는 문장. 없는 번호 [3]. 문서에서 확인 못 함", ev)[0]]
print(" ".join(got))
PY
)"
[[ "$ask" == "supported unverified unsupported unsupported none" ]] || bad+=$'\n'"ask: citation check gave '$ask'"
# Tabs (docs-kit.yml, bin/kit.py): a minimal project builds clean with only its tabs; turning tabs on copies their
# starters and builds clean again; a tab turned off leaves the menu without a "not in nav" warning.
T2="$TMP/minimal"; mkdir -p "$T2/.docs-kit"
tar -C "$KIT" --exclude=.git -cf - . | tar -C "$T2/.docs-kit" -xf -
DOCS_ROOT="$T2" python3 "$T2/.docs-kit/bin/kit.py" init --name "Minimal" --profile minimal >/dev/null
build2() { docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$T2:/docs" -w /docs "$IMAGE" build 2>&1; }
tabs() { python3 -c 'import re,sys; print(" ".join(re.findall(r"md-tabs__link[^>]*>\s*([^<]+?)\s*<", open(sys.argv[1], encoding="utf-8").read())))' "$T2/build/site/index.html"; }
log2="$(build2)"; bad+="$(echo "$log2" | grep -E '^(WARNING|ERROR)' | sed 's/^/minimal: /' || true)"
t="$(tabs)"; [[ "$t" == *ADR* && "$t" != *현황판* && "$t" != *"문서 지도"* ]] || bad+=$'\n'"minimal: unexpected tabs: $t"
DOCS_ROOT="$T2" python3 "$T2/.docs-kit/bin/kit.py" enable plan roadmap weekly >/dev/null
DOCS_ROOT="$T2" python3 "$T2/.docs-kit/bin/kit.py" disable glossary >/dev/null
[[ -f "$T2/docs/plan/scope.yml" && -f "$T2/docs/roadmap/roadmap.yml" ]] || bad+=$'\n'"kit.py enable: starters not copied"
log2="$(build2)"; bad+="$(echo "$log2" | grep -E '^(WARNING|ERROR)' | sed 's/^/enabled: /' || true)"
t="$(tabs)"; [[ "$t" == *현황판*주간\ 보고*로드맵*ADR* && "$t" != *용어집* ]] || bad+=$'\n'"kit.py enable/disable: tabs $t"

if [[ -n "$bad" ]]; then
  echo "$bad"; echo "selftest FAILED"; exit 1
fi
echo "selftest OK ($(find "$TMP/build/site" -name '*.html' | wc -l) pages)"
