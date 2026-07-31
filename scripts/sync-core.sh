#!/usr/bin/env bash
#
# core/core.js is the single source of truth for the color engine.
#
# An extension package has to contain it physically — a manifest cannot
# reference files outside the package root — so extension-chrome/ carries a
# generated copy, which is what keeps "load unpacked" working with no build
# step at all. This script refreshes that copy; test/sync.test.mjs fails if the
# copy and the source ever drift apart, so the duplication cannot rot silently.
#
set -euo pipefail

cd "$(dirname "$0")/.."

HEADER='/* GENERATED FILE — do not edit. Source of truth: core/core.js (refresh with scripts/sync-core.sh). */'

for target in extension-chrome/src; do
  mkdir -p "$target"
  { printf '%s\n' "$HEADER"; cat core/core.js; } > "$target/core.js"
  echo "synced core/core.js → $target/core.js"
done
