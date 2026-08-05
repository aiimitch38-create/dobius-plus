#!/bin/bash
# Install the freshly built dobius/ v2 app into /Applications/Dobius+.app.
# Run DETACHED (nohup) — the installer must outlive the app it replaces,
# because Claude sessions run inside that app. Logs to /tmp/dobius-install.log.
# Assumes `pnpm run build:unpack` already succeeded (build first, install second).
set -euo pipefail

REPO="/Users/bayou/Projects (Code)/dobius-plus"
BUILT_APP="$REPO/dobius/dist/mac-arm64/Dobius+.app"
INSTALLED="/Applications/Dobius+.app"
APPDATA="$HOME/Library/Application Support/dobius-plus"

echo "=== install-dobius-v2 $(date) ==="

if [ ! -d "$BUILT_APP" ]; then
  echo "ERROR: built app not found at: $BUILT_APP (run pnpm run build:unpack first)" >&2
  exit 1
fi

# Why: this script used to install whatever bundle happened to be sitting in dist/.
# A stale or wrong-arch build then replaced the app and the script still exited 0.
ASAR="$BUILT_APP/Contents/Resources/app.asar"
[ -f "$ASAR" ] || { echo "ERROR: $ASAR missing — that bundle is not a real build" >&2; exit 1; }

HOST_ARCH="$(uname -m)"
BIN_ARCHES="$(lipo -archs "$BUILT_APP/Contents/MacOS/Dobius+" 2>/dev/null || echo unknown)"
case "$HOST_ARCH:$BIN_ARCHES" in
  arm64:*arm64*|x86_64:*x86_64*) ;;
  *) echo "ERROR: built app arch ($BIN_ARCHES) does not run on this host ($HOST_ARCH)" >&2; exit 1 ;;
esac

# Staleness: list every source file newer than the packaged app. This repo routinely
# carries in-flight edits unrelated to the build, so a hard block would stop legitimate
# installs; instead it fails loudly and requires an explicit, conscious override.
# Why: `find … 2>/dev/null || true` would turn a missing/unreadable source tree into an
# empty result — i.e. a silent "nothing is stale" false pass. Assert the trees exist and
# let find's own failures abort instead of hiding them.
for SRC_DIR in "$REPO/dobius/src" "$REPO/dobius/vendor/buzz-desktop/src"; do
  [ -d "$SRC_DIR" ] || { echo "ERROR: source tree missing, cannot check staleness: $SRC_DIR" >&2; exit 1; }
  [ -r "$SRC_DIR" ] || { echo "ERROR: source tree unreadable: $SRC_DIR" >&2; exit 1; }
done
STALE="$(find "$REPO/dobius/src" "$REPO/dobius/vendor/buzz-desktop/src" \
  -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) -newer "$ASAR")"
if [ -n "$STALE" ]; then
  COUNT="$(printf '%s\n' "$STALE" | wc -l | tr -d ' ')"
  echo "WARNING: $COUNT source file(s) are NEWER than the packaged app — these changes are NOT in this build:" >&2
  printf '%s\n' "$STALE" | head -10 | sed "s|$REPO/|         |" >&2
  [ "$COUNT" -gt 10 ] && echo "         … and $((COUNT - 10)) more" >&2
  echo "         app.asar packaged: $(date -r "$ASAR" '+%Y-%m-%d %H:%M:%S')" >&2
  if [ "${ALLOW_STALE:-0}" != "1" ]; then
    echo "ERROR: refusing to install. Rebuild with ./build-and-install.sh," >&2
    echo "       or re-run with ALLOW_STALE=1 if those files are deliberately not in this build." >&2
    exit 1
  fi
  echo "         ALLOW_STALE=1 set — installing anyway." >&2
fi
echo "  verified: $BIN_ARCHES bundle, packaged $(date -r "$ASAR" '+%H:%M:%S')"

echo "1/4 Graceful quit (daemon persists terminal sessions), then hard-stop"
osascript -e 'tell application "Dobius+" to quit' 2>/dev/null || true
sleep 4
# Kill only the main app process (exact name) and lingering Chromium helpers
# (--type= arg). NEVER pattern-match the whole bundle path: the detached
# terminal daemon runs "Dobius+ Helper ... daemon-entry.js" from inside the
# bundle, and killing it destroys every live terminal session.
pkill -x "Dobius\+" 2>/dev/null || true
pkill -f "Dobius\+ Helper.*--type=" 2>/dev/null || true
sleep 1

echo "2/4 Remove old app + clear Electron render caches"
rm -rf "$INSTALLED"
rm -rf "$APPDATA/Cache" "$APPDATA/Code Cache" "$APPDATA/GPUCache" \
       "$APPDATA/DawnGraphiteCache" "$APPDATA/DawnWebGPUCache" 2>/dev/null || true

echo "3/4 Copy new build (ditto preserves signature/xattrs)"
ditto "$BUILT_APP" "$INSTALLED"

echo "4/4 Relaunch"
open "$INSTALLED"
echo "=== done: $(date) — installed $(defaults read "$INSTALLED/Contents/Info" CFBundleShortVersionString 2>/dev/null || echo '?') ==="
