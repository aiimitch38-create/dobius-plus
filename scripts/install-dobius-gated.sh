#!/bin/bash
# The ONLY sanctioned way to install a Dobius+ build into /Applications.
#
# Why this exists (2026-09-02): multiple sessions/lanes kept silently
# overwriting each other's installs — Carson watched his UI "revert" mid-test.
# This script (a) stamps provenance INSIDE the installed app so the owner is
# always knowable, (b) refuses to clobber a different lane's install without
# --take-over, and (c) is the one path allowed through the global
# dobius-install-gate hook that blocks raw cp/rm/mv against the app bundle.
#
# Usage: install-dobius-gated.sh <path-to-built-Dobius+.app> [--take-over]
set -euo pipefail

APP_SRC="${1:?usage: install-dobius-gated.sh <built .app path> [--take-over]}"
TAKE_OVER="${2:-}"
DEST="/Applications/Dobius+.app"
PROV_REL="Contents/Resources/INSTALL-PROVENANCE.json"
LOCK="$HOME/.dobius-install.lock"

[ -d "$APP_SRC" ] || { echo "ERROR: no app bundle at $APP_SRC" >&2; exit 1; }

# Provenance of the build we're about to install.
SRC_REPO=$(cd "$(dirname "$APP_SRC")" && git rev-parse --show-toplevel 2>/dev/null || echo "unknown")
SRC_BRANCH=$(cd "$SRC_REPO" 2>/dev/null && git branch --show-current 2>/dev/null || echo "unknown")
SRC_COMMIT=$(cd "$SRC_REPO" 2>/dev/null && git rev-parse --short HEAD 2>/dev/null || echo "unknown")

# Ownership check: a different branch's install needs an explicit takeover.
if [ -f "$DEST/$PROV_REL" ] && [ "$TAKE_OVER" != "--take-over" ]; then
  CUR_BRANCH=$(python3 -c "import json;print(json.load(open('$DEST/$PROV_REL')).get('branch','unknown'))" 2>/dev/null || echo unknown)
  if [ "$CUR_BRANCH" != "unknown" ] && [ "$CUR_BRANCH" != "$SRC_BRANCH" ]; then
    echo "REFUSED: /Applications/Dobius+.app currently belongs to branch '$CUR_BRANCH'." >&2
    echo "Your build is from '$SRC_BRANCH'. Re-run with --take-over to replace it" >&2
    echo "(and tell the other lane), or merge the branches instead." >&2
    exit 3
  fi
fi

# Simple lock so two installs can't interleave.
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "REFUSED: another install is in progress (lock: $LOCK). Remove it if stale." >&2
  exit 4
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

osascript -e 'quit app "Dobius+"' 2>/dev/null || true
for _ in $(seq 1 10); do
  pgrep -f "Dobius\\+.app/Contents/MacOS/Dobius\\+$" > /dev/null || break
  sleep 1
done

# Staged swap: full copy beside the target, then instant rename — never a
# half-copied bundle even if something relaunches the app mid-install.
STAGE="/Applications/Dobius+.new.app"
export DOBIUS_INSTALL_GATE=1
rm -rf "$STAGE"
cp -R "$APP_SRC" "$STAGE"
python3 - "$STAGE/$PROV_REL" "$SRC_BRANCH" "$SRC_COMMIT" "$SRC_REPO" <<'EOF'
import json, sys, datetime, os
path, branch, commit, repo = sys.argv[1:5]
json.dump({
    "branch": branch,
    "commit": commit,
    "repo": repo,
    "installedAt": datetime.datetime.now().isoformat(timespec="seconds"),
    "installedBy": os.environ.get("USER", "unknown"),
}, open(path, "w"), indent=2)
EOF
rm -rf "$DEST"
mv "$STAGE" "$DEST"
open -a "$DEST"

echo "INSTALLED: $SRC_BRANCH@$SRC_COMMIT -> $DEST"
echo "$(date '+%F %T') install $SRC_BRANCH@$SRC_COMMIT from $SRC_REPO" >> "$HOME/.dobius-install-history.log"
