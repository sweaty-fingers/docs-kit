#!/usr/bin/env bash
# Build the same docs with the MkDocs edition (tag v0.15.4) and with this kit, then compare the two sites with
# bin/site_diff.py (prd.md M7: MIG-2 addresses, MIG-3 migrate, MIG-4 page / title / anchor / link comparison).
#
#   bin/compare_editions.sh                    # the selftest fixture project (every tab)
#   bin/compare_editions.sh /path/to/project   # a real project's docs/ and docs-kit.yml (or mkdocs.yml)
#
# Needs git (the tag), Python 3 with venv (MkDocs Material 9.5.49 is installed into a throwaway venv; network on the
# first run) and what bin/docs.sh build needs. Accepted differences: tests/site-diff-allow.txt.
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${1:-}"
OLD_TAG="${DOCS_OLD_TAG:-v0.15.4}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/docs-kit-compare.XXXXXX")"
trap '[ -n "${KEEP_TMP:-}" ] || rm -rf "${WORK:?}"' EXIT
VENV="${DOCS_MKDOCS_VENV:-${TMPDIR:-/tmp}/docs-kit-mkdocs-venv}"

if [[ ! -x "$VENV/bin/mkdocs" ]]; then
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q "mkdocs-material==9.5.49"
fi

# ---- A: the MkDocs edition
A="$WORK/old"
mkdir -p "$A/.docs-kit"
git -C "$KIT" archive "$OLD_TAG" | tar -x -C "$A/.docs-kit"
DOCS_ROOT="$A" "$A/.docs-kit/bin/init.sh" "Compare" all >/dev/null 2>&1 || true
if [[ -z "$SRC" ]]; then
  cp -R "$KIT/tests/fixtures/all/docs/." "$A/docs/"
  cat "$KIT/tests/fixtures/all/README.append.md" >> "$A/docs/README.md"
else
  rm -rf "${A:?}/docs"
  cp -R "$SRC/docs" "$A/docs"
  [[ -f "$SRC/docs-kit.yml" ]] && cp "$SRC/docs-kit.yml" "$A/docs-kit.yml"
  [[ -f "$SRC/mkdocs.yml" ]] && cp "$SRC/mkdocs.yml" "$A/mkdocs.yml"
fi
# MkDocs reserves the front-matter key `template:` (a page template); the Astro edition does not. Rename it in the
# copy only, the same for both builds, so the MkDocs edition can build a project written for the Astro edition.
{ grep -rl '^template: ' "$A/docs" --include='*.md' 2>/dev/null || true; } | while read -r f; do
  sed -i.bak 's/^template: /template_version: /' "$f" && rm -f "$f.bak"
done
(cd "$A" && "$VENV/bin/mkdocs" build 2>&1 | grep -E '^(WARNING|ERROR)' | grep -v 'not included in the "nav"' || true)

# ---- B: this kit, after kit.py migrate (MIG-3)
B="$WORK/new"
mkdir -p "$B"
cp -R "$A/docs" "$B/docs"
cp "$A/docs-kit.yml" "$B/docs-kit.yml"
[[ -f "$A/mkdocs.yml" ]] && cp "$A/mkdocs.yml" "$B/mkdocs.yml"
DOCS_ROOT="$B" python3 "$KIT/bin/kit.py" migrate >/dev/null
DOCS_ROOT="$B" DOCS_RUNNER="${DOCS_RUNNER:-host}" "$KIT/bin/docs.sh" build 2>&1 | grep -E 'WARNING|docs-kit:' || true

# ---- viewer, board and short addresses (not compared page by page): same files on both sides (MIG-2)
paths() { (cd "$1" && find . \( -path '*viewer*' -o -path '*board*' -o -path './r/*' \) -type f | grep -vE 'vendor/|\.map$' | sort); }
if ! diff <(paths "$A/build/site") <(paths "$B/build/site") >/dev/null; then
  echo "viewer / board / short address files differ:"; diff <(paths "$A/build/site") <(paths "$B/build/site") || true
  status=1
else
  status=0
fi
python3 "$KIT/bin/site_diff.py" "$A/build/site" "$B/build/site" --allow "$KIT/tests/site-diff-allow.txt" || status=1
exit $status
