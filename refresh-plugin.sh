#!/usr/bin/env bash
# refresh-plugin.sh — re-install a Solace Architect plugin from GitHub
# and refresh its SAM-project config.
#
# Pip caches already-installed package versions, so `sam plugin install`
# / `pip install` no-op when the version string hasn't changed even if
# the upstream source moved forward. This script wraps the force-reinstall
# incantation AND re-runs `sam plugin add` so the local
# configs/gateways/<plugin>.yaml stays in sync with the wheel's config.
#
# Pass the plugin name exactly as it appears as a subdirectory in the
# plugins repo (e.g. solace-architect-webui-entrypoint). The same name
# is used as the SAM component name.
#
# Usage:
#   ./refresh-plugin.sh <plugin> [--ref <branch-or-sha>] [--skip-add]
#
# Examples:
#   ./refresh-plugin.sh solace-architect-webui-entrypoint
#   ./refresh-plugin.sh solace-architect-discovery --ref develop
#   ./refresh-plugin.sh solace-architect-webui-entrypoint --skip-add
#
# Environment:
#   SA_PLUGINS_REPO  Override the upstream git URL (default: this repo).

set -euo pipefail

REPO_URL="${SA_PLUGINS_REPO:-https://github.com/gvensan/sam-solace-architect-agents.git}"

usage() {
  sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

[ $# -ge 1 ] || usage 1
case "$1" in -h|--help) usage 0 ;; esac

plugin="$1"; shift

ref=""
skip_add="0"
while [ $# -gt 0 ]; do
  case "$1" in
    --ref)       ref="$2"; shift 2 ;;
    --skip-add)  skip_add="1"; shift ;;
    -h|--help)   usage 0 ;;
    *)           echo "Unknown arg: $1" >&2; usage 1 ;;
  esac
done

url="git+${REPO_URL}"
[ -n "$ref" ] && url="${url}@${ref}"
url="${url}#subdirectory=${plugin}"

echo "→ refreshing ${plugin}"
echo "  source: ${url}"

# Clear pip's wheel cache for this package so a same-version commit on the
# same ref actually re-downloads. Failures here are non-fatal (cache might
# not exist, or pip might be too old to support `cache remove`).
pip cache remove "${plugin//-/_}*" >/dev/null 2>&1 || true

pip install --force-reinstall --no-deps "$url"

if [ "$skip_add" = "0" ]; then
  echo "→ re-registering '${plugin}' as a SAM component (refreshes local config)"
  sam plugin add "$plugin" --plugin "$plugin"
fi

# Sanity check: show where the package landed + mtime of a key file
module_name="${plugin//-/_}"
loc=$(python -c "import importlib, pathlib; m = importlib.import_module('${module_name}'); print(pathlib.Path(m.__file__).parent)" 2>/dev/null || echo "")
if [ -n "$loc" ]; then
  echo "✓ installed at: $loc"
  for f in component.py app.py; do
    [ -f "$loc/$f" ] && ls -l "$loc/$f"
  done
fi

echo
echo "Restart your SAM run to pick up the new code:"
echo "  sam run"
