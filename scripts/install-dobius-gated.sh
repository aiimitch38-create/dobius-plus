#!/bin/bash
# The ONLY sanctioned way to install a Dobius+ build into /Applications.
#
# Why this exists (2026-09-02): multiple sessions/lanes kept silently
# overwriting each other's installs — Carson watched his UI "revert" mid-test.
# This script (a) stamps provenance INSIDE the installed app so the owner is
# always knowable, (b) refuses to clobber a different lane's install without
# --take-over, and (c) is the one path allowed through the global
# dobius-install-gate hook that blocks raw cp/rm/mv against the app bundle.
# build-and-install.sh and scripts/install-dobius-v2.sh are retired pointers
# to this file (BUILD-043): there is exactly one install path.
#
# Order (BUILD-043): lock → ownership/version checks → stage copy → validate
# stage → quit app → atomic swap → move the old bundle to ONE rollback copy
# outside /Applications and outside dobius/dist → remove the dist build copy.
# Any failure before the swap leaves the installed app untouched.
#
# Usage: install-dobius-gated.sh <path-to-built-Dobius+.app> [--take-over]
#
# Test overrides (fixture dirs only). The app is quit/killed/relaunched and
# LaunchServices touched ONLY when the destination is the real install path.
#   DOBIUS_INSTALL_DEST         default /Applications/Dobius+.app
#   DOBIUS_INSTALL_LOCK         default ~/.dobius-install.lock
#   DOBIUS_INSTALL_LOCK_WAIT    seconds to wait for another install (default 300)
#   DOBIUS_INSTALL_BACKUP_DIR   default ~/Library/Application Support/dobius-plus-install-backups
#   DOBIUS_INSTALL_HISTORY_LOG  default ~/.dobius-install-history.log
#   DOBIUS_INSTALL_TEST_MANAGE_APP=1  run the quit/kill/relaunch steps against a
#                                     fixture DEST (tests put recorder shims for
#                                     osascript/pgrep/pkill/open first on PATH)
#   DOBIUS_INSTALL_LSREGISTER   lsregister binary (tests pass a recorder shim)
set -euo pipefail

APP_SRC="${1:?usage: install-dobius-gated.sh <built .app path> [--take-over]}"
TAKE_OVER="${2:-}"
REAL_DEST="/Applications/Dobius+.app"
DEST="${DOBIUS_INSTALL_DEST:-$REAL_DEST}"
PROV_REL="Contents/Resources/INSTALL-PROVENANCE.json"
LOCK="${DOBIUS_INSTALL_LOCK:-$HOME/.dobius-install.lock}"
LOCK_WAIT="${DOBIUS_INSTALL_LOCK_WAIT:-300}"
BACKUP_DIR="${DOBIUS_INSTALL_BACKUP_DIR:-$HOME/Library/Application Support/dobius-plus-install-backups}"
# Why no .app suffix: LaunchServices registers directories named *.app, and a
# second bundle with the same ID is the duplicate-Dock-icon bug (#105).
ROLLBACK="$BACKUP_DIR/Dobius+.previous"
HISTORY_LOG="${DOBIUS_INSTALL_HISTORY_LOG:-$HOME/.dobius-install-history.log}"
[ -d "$APP_SRC" ] || { echo "ERROR: no app bundle at $APP_SRC" >&2; exit 1; }
[ -d "$(dirname "$DEST")" ] || { echo "ERROR: install folder $(dirname "$DEST") does not exist" >&2; exit 1; }
APP_SRC="$(cd "$APP_SRC" && pwd -P)"
DEST="$(cd "$(dirname "$DEST")" && pwd -P)/$(basename "$DEST")"
STAGE="${DEST%.app}.new.app"
# Decided on the RESOLVED path (APFS is case-insensitive), so a spelling like
# /Applications//Dobius+.app still quits, relaunches and re-registers the app.
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
MANAGE_APP=0
[ "$(lower "$DEST")" = "$(lower "$(cd "$(dirname "$REAL_DEST")" 2>/dev/null && pwd -P)/$(basename "$REAL_DEST")")" ] && MANAGE_APP=1
[ "${DOBIUS_INSTALL_TEST_MANAGE_APP:-}" = "1" ] && MANAGE_APP=1
case "$APP_SRC" in
  "$DEST"|"$DEST"/*|"$STAGE"|"$STAGE"/*)
    echo "ERROR: $APP_SRC is the installed app or its stage — pass a build" >&2
    exit 1 ;;
esac

# Lock FIRST (#104): the ownership and version checks below must see the state
# left by any install that finished while we waited, not a snapshot taken
# before it. mkdir is atomic; the lock holds our pid for diagnosis.
LOCK_HELD=0
cleanup() {
  # Whatever sits at $STAGE at exit is ours to remove: a partial/unvalidated
  # new bundle, or the old bundle whose move to the rollback dir failed.
  # Either way it must not linger as a second same-bundle-ID app.
  if [ "$LOCK_HELD" = "1" ]; then
    if [ -e "$STAGE" ]; then rm -rf "$STAGE"; fi
    rm -rf "$LOCK"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

WAITED=0
until mkdir "$LOCK" 2>/dev/null; do
  if [ "$WAITED" -ge "$LOCK_WAIT" ]; then
    OWNER=$(cat "$LOCK/pid" 2>/dev/null || echo "?")
    STATE="not running — the lock is stale"
    kill -0 "$OWNER" 2>/dev/null && STATE="still running"
    echo "REFUSED: another install holds $LOCK (pid $OWNER, $STATE) after ${LOCK_WAIT}s." >&2
    echo "Remove the lock only if that install is dead." >&2
    exit 4
  fi
  [ "$WAITED" = "0" ] && echo "Waiting for another install to finish (lock: $LOCK)…" >&2
  sleep 1
  WAITED=$((WAITED + 1))
done
LOCK_HELD=1
echo "$$" > "$LOCK/pid"

# Provenance of the build we're about to install.
SRC_REPO=$(cd "$(dirname "$APP_SRC")" && git rev-parse --show-toplevel 2>/dev/null || echo "unknown")
SRC_BRANCH=$(cd "$SRC_REPO" 2>/dev/null && git branch --show-current 2>/dev/null || echo "unknown")
SRC_COMMIT=$(cd "$SRC_REPO" 2>/dev/null && git rev-parse --short HEAD 2>/dev/null || echo "unknown")

# Ownership check: a different branch's install needs an explicit takeover.
if [ -f "$DEST/$PROV_REL" ] && [ "$TAKE_OVER" != "--take-over" ]; then
  CUR_BRANCH=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('branch','unknown'))" "$DEST/$PROV_REL" 2>/dev/null || echo unknown)
  if [ "$CUR_BRANCH" != "unknown" ] && [ "$CUR_BRANCH" != "$SRC_BRANCH" ]; then
    echo "REFUSED: $DEST currently belongs to branch '$CUR_BRANCH'." >&2
    echo "Your build is from '$SRC_BRANCH'. Re-run with --take-over to replace it" >&2
    echo "(and tell the other lane), or merge the branches instead." >&2
    exit 3
  fi
fi

# Downgrade guard: refuse to install an OLDER app over a newer one.
# Why (2026-09-07): a stale 1.0.66 lane build landed over the 2.0.0-rc.1 app and
# read as "months of work wiped". Branch ownership alone did not catch it — the
# version going backwards is the signal that a stale lane is installing.
# BUILD-044: full SemVer precedence (#102: 2.0.0-rc.1 is OLDER than 2.0.0, and
# rc.1 older than rc.2). A version that is missing or not SemVer is never a
# pass (N8): the build is always refused, the installed app's only unless
# --take-over says the operator accepts not knowing.
# Why the -f guards: on a missing plist PlistBuddy prints "File Doesn't Exist,
# Will Create: <path>" to stdout, and the digits in that path were compared
# as a version (a first install into a path with digits was refused).
SEMVER="$(cd "$(dirname "$0")" && pwd -P)/semver-compare.py"
plist_value() {
  [ -f "$1/Contents/Info.plist" ] || return 0
  /usr/libexec/PlistBuddy -c "Print :$2" "$1/Contents/Info.plist" 2>/dev/null || true
}
SRC_VER=$(plist_value "$APP_SRC" CFBundleShortVersionString)
if ! python3 "$SEMVER" valid "$SRC_VER"; then
  echo "REFUSED: $APP_SRC has no valid version (CFBundleShortVersionString='$SRC_VER')." >&2
  echo "Without one the downgrade guard cannot judge it; rebuild it." >&2
  exit 5
fi
if [ -e "$DEST" ] && [ "$TAKE_OVER" != "--take-over" ]; then
  DST_VER=$(plist_value "$DEST" CFBundleShortVersionString)
  if ! python3 "$SEMVER" valid "$DST_VER"; then
    echo "REFUSED: $DEST has no valid version (CFBundleShortVersionString='$DST_VER')," >&2
    echo "so this install cannot be proven not to be a downgrade." >&2
    echo "Re-run with --take-over to replace it anyway." >&2
    exit 5
  fi
  if ! python3 "$SEMVER" ge "$SRC_VER" "$DST_VER"; then
    echo "REFUSED: that build is version $SRC_VER but $DEST is $DST_VER." >&2
    echo "Installing it would DOWNGRADE the app (this is the 'my work disappeared' bug)." >&2
    echo "You are installing from: $SRC_REPO ($SRC_BRANCH)" >&2
    echo "Re-run with --take-over only if you really mean to go backwards." >&2
    exit 5
  fi
fi

# Stage: full copy beside the target (same volume, so the swap is a rename).
# The stage is always a fresh tree, so no file from an old bundle survives.
export DOBIUS_INSTALL_GATE=1
rm -rf "$STAGE"
if ! cp -R "$APP_SRC" "$STAGE"; then
  echo "ERROR: copying $APP_SRC to $STAGE failed — installed app left untouched." >&2
  exit 6
fi
# Provenance (#109, #110, X2): the commit alone does not say what was built.
# Also record whether the source tree had uncommitted changes plus a digest of
# them, the annotated release tag at HEAD (if any), the bundle's own version and
# build number, and a hash of the shipped app.asar, so each can be checked on
# its own. A value that cannot be determined is null, never a guess.
# CFBundleVersion carries the build counter (dobius/config/scripts/
# electron-builder-with-build-number.mjs). A bundle packaged without it has the
# plain version there, which is not a build number.
BUILD_NUM=$(plist_value "$STAGE" CFBundleVersion)
case "$BUILD_NUM" in ''|0*|*[!0-9]*) BUILD_NUM="" ;; esac
python3 - "$STAGE/$PROV_REL" "$SRC_BRANCH" "$SRC_COMMIT" "$SRC_REPO" "$SRC_VER" "$BUILD_NUM" "$STAGE/Contents/Resources/app.asar" <<'EOF'
import json, sys, datetime, hashlib, os, subprocess
path, branch, commit, repo, version, build_number, asar = sys.argv[1:8]

def git(*args):
    return subprocess.run(["git", "--no-optional-locks", "-C", repo, *args], capture_output=True, check=True).stdout

def sha256_file(file_path):
    digest = hashlib.sha256()
    with open(file_path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()

dirty = diff_digest = tag = None
if repo != "unknown":
    try:
        dirty = bool(git("status", "--porcelain", "--untracked-files=all").strip())
        if dirty:
            # Tracked changes (staged + unstaged) as one binary diff, then every
            # untracked, non-ignored path with a hash of its content.
            digest = hashlib.sha256(git("diff", "HEAD", "--binary", "--no-ext-diff", "--no-textconv", "--no-color"))
            untracked = git("ls-files", "--others", "--exclude-standard", "-z").split(b"\0")
            for rel in sorted(p for p in untracked if p):
                full = os.path.join(repo, os.fsdecode(rel))
                if os.path.islink(full):
                    content = b"link:" + os.fsencode(os.readlink(full))
                elif os.path.isfile(full):
                    content = sha256_file(full).encode()
                else:
                    content = b"other"
                digest.update(b"\0untracked\0" + rel + b"\0" + content)
            diff_digest = "sha256:" + digest.hexdigest()
    except (OSError, subprocess.CalledProcessError):
        dirty = diff_digest = None
    try:
        # Annotated tags only: the release-tag contract (#110) is `git tag -a v<version>`.
        tag = git("describe", "--exact-match", "HEAD").decode().strip() or None
    except (OSError, subprocess.CalledProcessError):
        tag = None

json.dump({
    "branch": branch,
    "commit": commit,
    "repo": repo,
    "dirty": dirty,
    "diffDigest": diff_digest,
    "tag": tag,
    "version": version,
    "buildNumber": int(build_number) if build_number else None,
    "artifactSha256": sha256_file(asar) if os.path.isfile(asar) else None,
    "installedAt": datetime.datetime.now().isoformat(timespec="seconds"),
    "installedBy": os.environ.get("USER", "unknown"),
}, open(path, "w"), indent=2)
EOF

# Validate the STAGED copy (what will actually run), before touching $DEST.
stage_invalid() {
  echo "ERROR: staged bundle is not a runnable Dobius+ build: $1 — installed app left untouched." >&2
  exit 7
}
EXE_NAME=$(/usr/libexec/PlistBuddy -c "Print :CFBundleExecutable" "$STAGE/Contents/Info.plist" 2>/dev/null || echo "")
[ -n "$EXE_NAME" ] || stage_invalid "Contents/Info.plist has no CFBundleExecutable"
/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$STAGE/Contents/Info.plist" >/dev/null 2>&1 \
  || stage_invalid "Contents/Info.plist has no CFBundleIdentifier"
[ -x "$STAGE/Contents/MacOS/$EXE_NAME" ] || stage_invalid "Contents/MacOS/$EXE_NAME missing or not executable"
[ -f "$STAGE/Contents/Resources/app.asar" ] || stage_invalid "Contents/Resources/app.asar missing"
HOST_ARCH="$(uname -m)"
BIN_ARCHES="$(lipo -archs "$STAGE/Contents/MacOS/$EXE_NAME" 2>/dev/null || echo unknown)"
case "$HOST_ARCH:$BIN_ARCHES" in
  arm64:*arm64*|x86_64:*x86_64*) ;;
  *) stage_invalid "binary arch ($BIN_ARCHES) does not run on this host ($HOST_ARCH)" ;;
esac
python3 -c "import json,sys;json.load(open(sys.argv[1]))" "$STAGE/$PROV_REL" 2>/dev/null \
  || stage_invalid "$PROV_REL was not written"

# Quit only now that the build is staged and valid (a bad build never closes
# the app). -a: pgrep/pkill skip their own ancestors by default, and an install
# run from a Dobius+ terminal descends from the main app (main → detached
# daemon → login → shell), so without -a the app is never seen or killed.
if [ "$MANAGE_APP" = "1" ]; then
  osascript -e 'quit app "Dobius+"' 2>/dev/null || true
  for _ in $(seq 1 10); do
    pgrep -a -f "Dobius\\+.app/Contents/MacOS/Dobius\\+$" > /dev/null || break
    sleep 1
  done
  # Kill only the main app (exact name "Dobius+") and Chromium helpers (--type=
  # arg). NEVER pattern-match the bundle path: the terminal daemon runs as
  # "Dobius+ Helper … daemon-entry.js --socket … --token …" (no --type=), and
  # killing it destroys every live terminal session — including the one running
  # this script. The daemon is forked detached (own session/process group), so
  # killing the main app does not take it or its shells down. The + must be
  # escaped (regex quantifier).
  pkill -a -x "Dobius\+" 2>/dev/null || true
  pkill -f "Dobius\+ Helper.*--type=" 2>/dev/null || true
fi

# Swap (#104): with an app already installed, exchange the two bundles in ONE
# atomic rename (renamex_np RENAME_SWAP) — there is never an instant with no
# app at $DEST. Afterwards $STAGE holds the previous bundle.
if [ -e "$DEST" ]; then
  if ! python3 - "$STAGE" "$DEST" <<'PYSWAP'
import ctypes, ctypes.util, os, sys
libc = ctypes.CDLL(ctypes.util.find_library("c"), use_errno=True)
swap = libc.renamex_np
swap.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
RENAME_SWAP = 0x2
if swap(os.fsencode(sys.argv[1]), os.fsencode(sys.argv[2]), RENAME_SWAP) != 0:
    sys.stderr.write("renamex_np: %s\n" % os.strerror(ctypes.get_errno()))
    sys.exit(1)
PYSWAP
  then
    echo "ERROR: swapping $STAGE into $DEST failed — installed app left untouched." >&2
    # The app was already quit for the swap: bring the unchanged app back.
    if [ "$MANAGE_APP" = "1" ]; then open -a "$DEST" || true; fi
    exit 8
  fi
  # One rollback copy, outside /Applications and outside dobius/dist. The
  # previous one is dropped first so the disk never holds two.
  ROLLBACK_NOTE="rollback: none (moving the previous bundle failed)"
  if mkdir -p "$BACKUP_DIR" && rm -rf "$ROLLBACK" && mv "$STAGE" "$ROLLBACK"; then
    ROLLBACK_NOTE="rollback: $ROLLBACK"
  else
    echo "WARNING: could not keep a rollback copy in $BACKUP_DIR; the previous bundle is removed." >&2
  fi
else
  mv "$STAGE" "$DEST"
  ROLLBACK_NOTE="rollback: none (first install)"
fi

# The build output carries the same bundle ID as the installed app; left in
# dobius/dist it can register with LaunchServices → two Dock icons (#105). It
# is a regenerable artifact, so remove it. A bundle outside a dist/ folder may
# be someone's handoff copy — never delete that, only warn.
case "$APP_SRC" in
  */dist/*) rm -rf "$APP_SRC" ;;
  *) echo "NOTE: $APP_SRC shares the installed app's bundle ID; move it out of Spotlight's reach when done." >&2 ;;
esac

if [ "$MANAGE_APP" = "1" ]; then
  # LaunchServices keys apps by bundle ID, not path. The swap puts a fresh inode
  # at the same path every install, and if another copy with the same bundle ID
  # exists anywhere else on disk (a stray handoff/backup copy), LaunchServices
  # can bind the Dock tile to the wrong one — the app "acts broken"/relaunches
  # the old build right after an update, which reads as a crash even though
  # nothing crashed. See ~/.claude/skills/learned-dobius-duplicate-app-icon.
  LSR="${DOBIUS_INSTALL_LSREGISTER:-/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister}"
  BUNDLE_ID=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$DEST/Contents/Info.plist" 2>/dev/null || echo "")
  if [ -x "$LSR" ]; then
    "$LSR" -f "$DEST" >/dev/null 2>&1 || true
    if [ -n "$BUNDLE_ID" ]; then
      DUPES=$("$LSR" -dump 2>/dev/null | grep -B2 "bundle id:.*$BUNDLE_ID" | grep "path:" | awk '{print $2}' | sort -u | grep -v "^$DEST$" || true)
      if [ -n "$DUPES" ]; then
        echo "WARNING: another app on disk shares this bundle ID ($BUNDLE_ID) — this is exactly" >&2
        echo "the duplicate-icon/wrong-app-launches bug. Move (don't delete) it out of Spotlight's" >&2
        echo "reach, then re-run this script:" >&2
        echo "$DUPES" >&2
      fi
    fi
  fi
  open -a "$DEST"
fi

echo "INSTALLED: $SRC_BRANCH@$SRC_COMMIT version $SRC_VER build ${BUILD_NUM:-none} -> $DEST ($ROLLBACK_NOTE)"
[ "$ROLLBACK_NOTE" = "rollback: $ROLLBACK" ] && \
  echo "To go back: $0 \"$ROLLBACK\" --take-over"
echo "$(date '+%F %T') install $SRC_BRANCH@$SRC_COMMIT version $SRC_VER build ${BUILD_NUM:-none} from $SRC_REPO ($ROLLBACK_NOTE)" >> "$HISTORY_LOG"
