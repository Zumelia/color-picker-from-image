#!/usr/bin/env bash
#
# Build the Chrome Web Store package from extension-chrome/.
#
# The archive must have manifest.json at its ROOT — zipping the repository root,
# or the extension directory as a folder, produces a package the store rejects.
# This script always zips from inside extension-chrome/ so that cannot happen
# by accident.
#
set -euo pipefail

cd "$(dirname "$0")/.."

# Never ship a stale copy of the engine.
./scripts/sync-core.sh >/dev/null

VERSION=$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' extension-chrome/manifest.json \
  | head -1 | sed 's/.*"\([0-9][0-9.]*\)".*/\1/')

if [ -z "$VERSION" ]; then
  echo "could not read version from extension-chrome/manifest.json" >&2
  exit 1
fi

OUT="color-picker-from-image-${VERSION}.zip"
rm -f "$OUT"

if command -v zip >/dev/null 2>&1; then
  ( cd extension-chrome && zip -rq "../$OUT" . -x '*.DS_Store' '*/.*' )
else
  # ops-de has no `zip` binary; python3 is always there.
  python3 - "$OUT" <<'PY'
import os, sys, zipfile
out = sys.argv[1]
root = "extension-chrome"
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for name in filenames:
            if name.startswith(".") or name == ".DS_Store":
                continue
            full = os.path.join(dirpath, name)
            z.write(full, os.path.relpath(full, root))
PY
fi

echo "$OUT"
