#!/bin/bash
# Run the communications verification gate while the installed Dobius+ app is
# allowed to keep its relay port.
#
# Why this exists: the gate's harness relay must bind 127.0.0.1:3300 (the
# vendored Buzz client hardcodes that URL), and since the 2026-08-24 install
# the REAL app's relay holds 3300 whenever the app is open. The harness
# deliberately refuses to share the port (it would write scenario fixtures
# into the user's live relay data), so the app must briefly step aside.
#
# Contract:
#   - Graceful quit (osascript) so the app's own shutdown handlers run. The
#     detached session daemon is NEVER killed — it survives the swap and the
#     relaunch warm-reattaches (same contract as install-dobius-v2.sh).
#   - The gate's REAL exit code is this script's exit code. Relaunching the
#     app must never mask a red gate.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="/Applications/Dobius+.app"
PORT=3300

port_free() {
  ! lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
}

APP_WAS_RUNNING=0
if pgrep -x "Dobius\+" >/dev/null 2>&1; then
  APP_WAS_RUNNING=1
  echo "=== quitting Dobius+ (daemon stays up) to free port $PORT ==="
  osascript -e 'tell application "Dobius+" to quit' 2>/dev/null || true
  for _ in $(seq 1 20); do
    port_free && break
    sleep 1
  done
  # Graceful quit can hang on the app's confirmations; fall back to the
  # installer's exact-name kill (matches the app binary ONLY — the detached
  # session daemon's process name is "Dobius+ Helper" and is never touched).
  if ! port_free; then
    echo "=== graceful quit did not free the port; exact-name kill ==="
    pkill -x "Dobius\+" 2>/dev/null || true
    sleep 3
  fi
  if ! port_free; then
    echo "ERROR: port $PORT still held after quit+kill:" >&2
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2 || true
    exit 3
  fi
fi

# Last guard right before the gate: name the holder if the port re-binds
# between the quit and the run (something has rebound it mid-window before).
if ! port_free; then
  echo "ERROR: port $PORT re-bound just before the gate — holder:" >&2
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2 || true
  [ "$APP_WAS_RUNNING" = "1" ] && open "$APP"
  exit 3
fi

GATE_EXIT=0
( cd "$REPO/dobius" && npx vitest run --config src/main/communications/verify/vitest.config.ts )
GATE_EXIT=$?

if [ "$APP_WAS_RUNNING" = "1" ]; then
  echo "=== relaunching Dobius+ ==="
  open "$APP"
fi

echo "=== gate exit: $GATE_EXIT ==="
exit "$GATE_EXIT"
