#!/usr/bin/env bash
# Set up a project to use docs-kit (a thin wrapper around bin/kit.py init). Run from the project root after adding
# the kit as a submodule at .docs-kit/:
#
#   git submodule add <docs-kit url> .docs-kit
#   .docs-kit/bin/init.sh "프로젝트 이름" [minimal|app|dev|research|all]     (default profile: dev)
#
# Copies template/base (mkdocs.yml, docs-kit.yml, docs/README.md) and the starter files of every tab the profile
# turns on (template/features/<id>/), never overwriting, and adds build/ to .gitignore. Change tabs later with
# .docs-kit/bin/kit.py enable | disable | profile.
set -euo pipefail
KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
args=(init --profile "${2:-dev}")
[[ -n "${1:-}" ]] && args+=(--name "$1")
exec python3 "$KIT/bin/kit.py" "${args[@]}"
