#!/bin/bash
# Build and install the CANONICAL Dobius+ v2 app (dobius/) into /Applications.
#
# HISTORY — why this file was rewritten (2026-08-05):
# It used to run `npm run build` then `npx electron-builder --mac` from the REPO ROOT.
# Step 1 correctly built v2 (root "build" = `pnpm --dir dobius build`), but step 2 used
# the root electron-builder.yml, which packages `files: dist/**` with `main:
# electron/main.js` and appId com.statusdigital.dobius-plus — i.e. the LEGACY v1 app.
# Running it would have silently replaced the installed v2 app with v1, under a
# different bundle id, and exited 0. Do not reintroduce the root packaging path.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$REPO/dobius"
BUILT_APP="$APP_DIR/dist/mac-arm64/Dobius+.app"

if [ "$(git -C "$REPO" rev-parse --show-toplevel)" != "$REPO" ]; then
  echo "ERROR: run this from the dobius-plus repo root" >&2
  exit 1
fi

echo "=== Dobius+ v2 build & install ==="

# NOTES 2026-07-12: packaging fails against a stale out/ — the afterPack verifier
# reports out/main/index.js missing from app.asar even though the log says it built.
echo "1/3 Clean out/ and dist/"
rm -rf "$APP_DIR/out" "$APP_DIR/dist"

# build:electron-vite runs run-electron-vite-build.mjs directly — the vendored
# Buzz UI is gone (native client replaced it), so there is no build:buzz-ui step.
echo "2/3 Build"
( cd "$APP_DIR" && pnpm run build:electron-vite \
  && pnpm exec electron-builder --config config/electron-builder.config.cjs --mac --arm64 --dir )

if [ ! -d "$BUILT_APP" ]; then
  echo "ERROR: build reported success but $BUILT_APP does not exist" >&2
  exit 1
fi

echo "3/3 Install"
exec "$REPO/scripts/install-dobius-v2.sh"
