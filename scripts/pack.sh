#!/usr/bin/env bash
set -euo pipefail

destination=$(realpath -m "${1:?Usage: bash scripts/pack.sh OUTPUT_DIRECTORY}")
mkdir -p "$destination"
cd "$(dirname "$0")/.."

for manifest in packages/*/package.json; do
  if bun -e 'process.exit((await Bun.file(process.argv[1]).json()).private ? 1 : 0)' "$manifest"; then
    (
      cd "$(dirname "$manifest")"
      bun pm pack --destination "$destination" --ignore-scripts --quiet
    )
  fi
done
