#!/usr/bin/env bash
# Re-run a verification record (VR) and check the results against what the VR recorded.
#
#   .docs-kit/bin/repro.sh VR-0002            # run, compare, report
#   .docs-kit/bin/repro.sh VR-0002 <args>     # extra arguments go to the VR's repro.sh (e.g. a flag for the steps
#                                             # that need a device; the VR says which)
#   .docs-kit/bin/repro.sh --list             # VRs that have a reproduction
#
# The VR's docs/records/assets/<VR>/repro.sh is called as `repro.sh <out dir> [args]`. It writes only under
# <out dir>, puts key=value results in <out dir>/actual.txt, and prints "SKIP ..." as the value of a key it did not
# run. expected.txt holds the values the VR recorded (# comments allowed).
#
# What it does
#   1. Runs docs/records/assets/<VR>/repro.sh into a NEW folder
#        build/repro/<VR>/<YYYYmmdd-HHMMSS>/      (git-ignored; never the VR's evidence)
#      The script writes key=value results to actual.txt there, plus its own logs and outputs.
#   2. Compares actual.txt with docs/records/assets/<VR>/expected.txt (the values in the VR).
#      Each key: OK (same), DIFF (different), SKIP (not run, e.g. a device step), MISSING (not produced).
#      An expected value written as A..B (integers) is OK for any integer in that range: for values that
#      vary run to run without meaning anything (e.g. counts that depend on timing).
#   3. Writes report.txt next to the outputs and prints it.
# Exit code: 0 every key OK or SKIP, 1 any DIFF or MISSING, 2 the run itself failed.
# Docs: 검증 기록 README (kit page records/README.md §3)
set -uo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="${DOCS_ROOT:-$(dirname "$KIT")}"
REC="$ROOT/docs/records/assets"

if [[ "${1:-}" == "--list" || -z "${1:-}" ]]; then
  for d in "$REC"/VR-*/; do [[ -x "$d/repro.sh" ]] && basename "$d"; done
  [[ -z "${1:-}" ]] && { echo "usage: .docs-kit/bin/repro.sh <VR-NNNN> [args for the VR's repro.sh]" >&2; exit 2; }
  exit 0
fi

VR="$1"; shift
[[ "$VR" =~ ^VR-[0-9]{4}$ ]] || { echo "ERROR: give a VR id like VR-0002" >&2; exit 2; }
SCRIPT="$REC/$VR/repro.sh"; EXPECTED="$REC/$VR/expected.txt"
[[ -x "$SCRIPT" && -f "$EXPECTED" ]] || { echo "ERROR: $VR has no repro.sh + expected.txt in $REC/$VR" >&2; exit 2; }

OUT="$ROOT/build/repro/$VR/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
if [[ -z "${NO_COLOR:-}" && ( -t 1 || -n "${FORCE_COLOR:-}" ) ]]; then
  G=$'\e[1;32m' Y=$'\e[1;33m' R=$'\e[1;31m' D=$'\e[2m' N=$'\e[0m'
else G='' Y='' R='' D='' N=''; fi

echo "== $VR reproduction -> ${OUT#"$ROOT"/}"
{
  echo "# $VR reproduction"
  echo "# started: $(date -Iseconds) on $(hostname), $(basename "$ROOT") $(git -C "$ROOT" rev-parse --short HEAD)$(git -C "$ROOT" diff --quiet || echo '+dirty'), args: $*"
} > "$OUT/run.log"
if ! "$SCRIPT" "$OUT" "$@" >> "$OUT/run.log" 2>&1; then
  echo "${R}FAIL${N}  the reproduction script failed; see ${OUT#"$ROOT"/}/run.log"; tail -15 "$OUT/run.log"; exit 2
fi

ok=0; bad=0; skip=0
{
  printf '# %s reproduction report\n# expected: %s\n# actual:   %s\n\n' "$VR" "${EXPECTED#"$ROOT"/}" "${OUT#"$ROOT"/}/actual.txt"
  while IFS= read -r line; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    key="${line%%=*}"; want="${line#*=}"
    got="$(grep -m1 "^${key}=" "$OUT/actual.txt" 2>/dev/null | cut -d= -f2-)"
    if ! grep -q "^${key}=" "$OUT/actual.txt" 2>/dev/null; then st=MISSING; bad=$((bad+1))
    elif [[ "$got" == SKIP* ]]; then st=SKIP; skip=$((skip+1))
    elif [[ "$got" == "$want" ]]; then st=OK; ok=$((ok+1))
    elif [[ "$want" =~ ^([0-9]+)\.\.([0-9]+)$ ]] && lo="${BASH_REMATCH[1]}" hi="${BASH_REMATCH[2]}" \
         && [[ "$got" =~ ^[0-9]+$ ]] && (( got >= lo && got <= hi )); then st=OK; ok=$((ok+1))
    else st=DIFF; bad=$((bad+1)); fi
    printf '%-8s %-28s expected=%s' "$st" "$key" "$want"
    [[ "$st" == OK ]] || printf '  actual=%s' "${got:-<none>}"
    printf '\n'
  done < "$EXPECTED"
  printf '\n%d OK, %d SKIP, %d DIFF/MISSING\n' "$ok" "$skip" "$bad"
} > "$OUT/report.txt"

sed -e "s/^OK      /${G}OK${N}      /" -e "s/^SKIP    /${Y}SKIP${N}    /" \
    -e "s/^DIFF    /${R}DIFF${N}    /" -e "s/^MISSING /${R}MISSING${N} /" -e "s/^#.*/${D}&${N}/" "$OUT/report.txt"
echo "${D}outputs: ${OUT#"$ROOT"/}/ (run.log, actual.txt, report.txt and the script's files)${N}"
[[ $bad -gt 0 ]] && exit 1
exit 0
