# Phase 0 — Freeze and baseline (plan)

Date: 2026-09-24. This file describes the steps. Nothing here was executed by Run B.

Goal: record exactly what is installed, what the code does today, and a private copy of Carson's data, so every later build can be compared against it and any data loss can be undone.

## 1. Facts already known (from the orchestrator and Run A)

| Fact | Value | Source |
|---|---|---|
| Installed app | Dobius+ **2.0.0**, built from commit `8841a218` on `fix/channel-cost` (an rc.1 commit plus uncommitted changes), installed 2026-09-19 07:59 | `/Applications/Dobius+.app/Contents/Resources/INSTALL-PROVENANCE.json` (ARCHITECTURE-MAP §2.2); dirty contents UNVERIFIED (BUG-MATRIX #109) |
| Repo HEAD | `7196dd82` "chore(release): bump version to 2.0.0" on `fix/channel-cost` | ARCHITECTURE-MAP header |
| Node | machine Node **22**; repo wants **24** (`dobius/package.json` `engines.node: "24"`) | orchestrator; BUG-LIST #114 (Run A could not locate the binary) |
| Typecheck | passes | orchestrator |
| Lint | fails, **3,625 errors** (mostly `components/communications`) | orchestrator; BUG-LIST #115 (no saved report) |
| Agents | **paused** (`agents-config.json` `agentsPaused: true`) | orchestrator |
| Asana Auto Mode | **off** | orchestrator |
| Kanban auto-dispatch (`vertexAutoModeEnabled`) | **ON** | orchestrator |
| Voice Conductor (`voice.conductorEnabled`) | **ON** | orchestrator |
| Jarvis (`voice.jarvisEnabled`) | **ON** | orchestrator |
| iMessage bridge (`imessage-bridge.json` `enabled`) | **ON** | orchestrator |
| Phone WebSocket | always on, `0.0.0.0:6768`, no off switch (`M/index.ts:2097`) | re-read 09-24 |

Important consequence: "paused" does **not** stop Kanban, Voice Conductor or iMessage today (#1). Until BUILD-001 is installed, the only real off switch for those three is their own setting. Recommendation in Phase 0: Carson turns those three off by hand (Gate A list in `SAFETY-GATES.md`) before any stabilization build is installed.

## 2. Freeze

1. No installs to `/Applications/Dobius+.app` except through `scripts/install-dobius-gated.sh`, one lane at a time.
2. No new feature branches merged into `fix/channel-cost`.
3. Stabilization work branches from `stabilize/iris-20260923` only (see `BRANCH-PLAN.md`).
4. Record every lane currently installed or building: `cat ~/.dobius-install-history.log | tail -20`.

## 3. Commands to capture the rest

Run from a shell, not from inside the app. Paths assume the canonical repo `/Users/bayou/Projects (Code)/Dobius/dobius-plus`. Do **not** run `build-and-install.sh` or any `scripts/install-*` script. Create the snapshot folder first (section 4, first two lines) so `$SNAP` exists for the logs below.

### 3.1 Source state
```bash
REPO="/Users/bayou/Projects (Code)/Dobius/dobius-plus"
git -C "$REPO" rev-parse HEAD
git -C "$REPO" status --porcelain | wc -l
git -C "$REPO" status --porcelain > "$SNAP/git-status.txt"
git -C "$REPO" diff --stat > "$SNAP/git-diff-stat.txt"
git -C "$REPO" tag --list 'v2*'           # expected: none (#110)
git -C "$REPO" log --oneline 8841a218..7196dd82 | wc -l
```

### 3.2 Toolchain
```bash
node --version; which node
pnpm --version
cat "$REPO/dobius/package.json" | grep -n '"node"'
```

### 3.3 Installed app
```bash
cat "/Applications/Dobius+.app/Contents/Resources/INSTALL-PROVENANCE.json"
/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "/Applications/Dobius+.app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Print CFBundleVersion' "/Applications/Dobius+.app/Contents/Info.plist"
codesign -dv "/Applications/Dobius+.app" 2>&1 | grep -E 'Signature|TeamIdentifier'
ls "/Applications/Dobius+.app/Contents/Resources/app.asar.unpacked/out/cli/index.js"   # ADAM needs this (#101)
pgrep -f "/Applications/Dobius+.app/Contents/MacOS"    # never pgrep -x "Dobius+" (regex +, NOTES 2026-08-02)
```

### 3.4 Tests (in a clean worktree, not the shared checkout)
```bash
git -C "$REPO" worktree add "$REPO/.claude/worktrees/baseline-7196dd82" 7196dd82
cd "$REPO/.claude/worktrees/baseline-7196dd82/dobius"
pnpm install --frozen-lockfile                   # only here, in the baseline worktree
pnpm run typecheck        2>&1 | tee "$SNAP/typecheck.log"; echo "exit $?"
pnpm test                 2>&1 | tee "$SNAP/vitest.log";    echo "exit $?"
pnpm run lint             2>&1 | tee "$SNAP/lint.log";      echo "exit $?"
npx oxlint --format json > "$SNAP/oxlint.json" || true   # machine-readable count per file (#115)
```
Record: vitest pass/fail/skip counts and the **names** of failing tests. Later builds must not add failures to this list.

Playwright e2e (`pnpm run test:e2e`) launches Electron. Run it only when Carson is at the machine, with an isolated `DOBIUS_E2E_USER_DATA_DIR`, and never against his real userData.

### 3.5 Build without install
```bash
cd "$REPO/.claude/worktrees/baseline-7196dd82/dobius"
rm -rf out dist                                  # stale out/ breaks packaging (NOTES 2026-07-12)
pnpm run build:unpack 2>&1 | tee "$SNAP/build-unpack.log"; echo "exit $?"
ls dist/mac-arm64/Dobius+.app/Contents/Resources/app.asar.unpacked/out/cli/index.js
```
Check the real `pnpm` exit code, not a wrapper's. Do not copy the result anywhere. Delete `dist/mac-arm64` after recording so LaunchServices does not register a duplicate bundle (#105).

### 3.6 Runtime settings (non-secret keys only)
`dobius-data.json` contains the ElevenLabs key (#24). Never `cat` it. Read only named keys:
```bash
UD="$HOME/Library/Application Support/dobius-plus"
jq '{vertexAutoModeEnabled: .settings.vertexAutoModeEnabled,
     conductorEnabled: .settings.voice.conductorEnabled,
     jarvisEnabled: .settings.voice.jarvisEnabled,
     dictationMode: .settings.voice.dictationMode}' "$UD/dobius-data.json"
jq '{agentsPaused, maxPingsPerDay}' "$UD/agents-config.json"
jq '{enabled, triggerPrefix}' "$UD/imessage-bridge.json"        # never print selfHandle
jq '.autoMode | {enabled, intervalMinutes, triageAgentId, buildAgent}' "$UD/asana-config.json"
jq 'length' "$UD/agents-runs.json"; jq 'length' "$UD/agents.json"
jq '[.[] | select(.status=="running")] | length' "$UD/agents-runs.json"
jq 'length' "$UD/dobius-devices.json"                             # count only, never tokens
stat -f '%Sp %z %Sm %N' "$UD"/*.json | tee "$SNAP/userdata-stat.txt"   # modes: #15 expects 0644 today
du -sh "$UD/terminal-history" "$UD/relay.db" "$HOME/.dobius"      # #48, X11
ls "$UD"/*.tmp "$UD"/*.sock 2>/dev/null                            # #49, N11 residues
```
If any key name does not exist, write `UNDETERMINED` in the snapshot notes rather than guessing.

### 3.7 ADAM
```bash
ls /Users/bayou/dobius/projects/ADAM/service/data/ | grep -v token   # never read the token file
curl -s --max-time 2 http://127.0.0.1:8791/health || echo "ADAM offline"   # UNDETERMINED: health route name
```

## 4. Data snapshot (private, never in the repo)

Location: `~/Backups/dobius-stabilization-<YYYYMMDD-HHMM>/`. **Never inside the repo or any worktree**: the snapshot contains secrets (device tokens, e2ee keypair, CLI token, ElevenLabs key in `dobius-data.json` and its backups, Asana token, communications identities).

Steps (with the app **quit**, so files are quiescent):
```bash
SNAP="$HOME/Backups/dobius-stabilization-$(date +%Y%m%d-%H%M)"
mkdir -p "$SNAP" && chmod 700 "$SNAP"
ditto "$HOME/Library/Application Support/dobius-plus" "$SNAP/userData"
ditto "$HOME/.dobius" "$SNAP/dot-dobius"
cp "/Applications/Dobius+.app/Contents/Resources/INSTALL-PROVENANCE.json" "$SNAP/"
( cd "$SNAP" && find . -type f -print0 | xargs -0 shasum -a 256 > SHA256SUMS )
chmod -R go-rwx "$SNAP"
```
- `ditto` keeps modes and extended attributes.
- The checksum file lets any later restore be verified byte for byte. Verify it once right after writing: `( cd "$SNAP" && shasum -a 256 -c SHA256SUMS | grep -v OK$ )` must print nothing.
- Keep the snapshot until Phase 10 passes. Deleting it is Carson's call.
- The snapshot directory itself is sensitive: do not sync it to Obsidian, Syncthing or any cloud folder.

## 5. Exit criteria for Phase 0

- Section 1 facts re-confirmed or corrected in `$SNAP/BASELINE-NOTES.md`.
- Typecheck, vitest, lint and build:unpack logs saved with real exit codes.
- Failing-test list and lint count per file recorded (this closes the "could not locate" status of #114 and #115).
- Snapshot written and its checksums verified.
- Carson has switched Kanban auto-dispatch, Voice Conductor, Jarvis and the iMessage bridge **off**, or explicitly chose to leave them on (Decision).
