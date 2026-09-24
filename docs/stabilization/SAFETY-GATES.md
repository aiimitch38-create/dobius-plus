# Dobius+ V2 — Safety gates

Date: 2026-09-24. A gate is a checkpoint Carson passes before switching a capability back on. Each gate lists the bug IDs that must be **fixed, merged, installed and regression-tested** first, and the exact settings to flip afterwards. Build numbers refer to `EXECUTION-ORDER.md`.

A gate is passed only when:
1. every listed bug's build is merged to `stabilize/iris-20260923`,
2. `pnpm --dir dobius run typecheck` and `pnpm --dir dobius test` exit 0 on that branch,
3. the gate's failure-injection cases in `TEST-PLAN.md` pass,
4. the build was installed through the gated installer and `INSTALL-PROVENANCE.json` names the gate's commit,
5. Carson flips the settings himself. No agent flips them.

Setting names below were read in source on 2026-09-24 unless marked.

---

## Gate A — App safe to launch, all autonomy off

**Must be fixed first:** #1, #2, N13 (BUILD-001, 002) · N10 (BUILD-003) · #119 (BUILD-004) · #28, #29, #30, #46, #47 (BUILD-009, 010) · #31, #32, #33, N6 (BUILD-013) · #34, #35 (BUILD-016) · #53 (BUILD-014).

Why these: #1/#2/N13 make "paused" true for every autonomous producer and fail closed. N10 lets the LAN phone listener be off. The data-integrity set covers the files that are read on every launch and can currently be wiped by one read error (agents, runs, board, primary store, pairings, e2ee key).

**Procedural rule until Phase 8 (#100, #103, #104):** install only with `scripts/install-dobius-gated.sh`, one lane at a time, after a successful `build:unpack`. Never `build-and-install.sh` or `install-dobius-v2.sh` (they `rm -rf` the app first, `scripts/install-dobius-v2.sh:73`).

**Settings for Gate A (turn OFF / keep OFF):**
- `agents-config.json` → `agentsPaused: true` (Agents page, "Pause crew").
- Settings → `vertexAutoModeEnabled: false` (Kanban auto-dispatch; `R/App.tsx:493`, type `S/types.ts:2664`). Baseline says it is ON today.
- Settings → `voice.conductorEnabled: false` (default false, `S/constants.ts:415`). Baseline: ON.
- Settings → `voice.jarvisEnabled: false` (`S/constants.ts:416`). Baseline: ON.
- `imessage-bridge.json` → `enabled: false` (`M/imessage-bridge/bridge-config.ts:15`). Baseline: ON.
- `asana-config.json` → `autoMode.enabled: false`. Baseline: OFF.
- Each automation → disabled, or leave enabled and rely on the gate (N13 fix records "crew paused" skips).
- New switch from BUILD-003 → phone listener **off**.
- Launch **without** `DOBIUS_ENABLE_DOBIUS_UPDATES` (updates stay disabled, `M/window/attach-main-window-services.ts:163`).

## Gate B — Local manual agents (Agents page runs, terminals)

**Must be fixed first (in addition to Gate A):** #3, #4, #23, #76 (BUILD-005) · #7, #6, #73, N3 (BUILD-007) · #74, #75, N1, #8-verify, X4 (BUILD-008) · #5, #55, #67, #70 (BUILD-022) · #56, #57, N2, #42, #77 (BUILD-023) · #40, #41 (BUILD-011) · #25 (BUILD-017) · #24, #15 (BUILD-018).

Why: manual runs reach real files and credentials. The rails (#3/#4), cwd fallback (#23), wildcard tool grant (#7/#6) and Codex's missing caps (#5) all apply to a run a human starts. #24/#25 stop secrets landing in plaintext during normal settings saves.

**Settings for Gate B:**
- Keep `agentsPaused: true`. After BUILD-001, Agents-page runs (origin `agents-page`) are admitted while paused; nothing autonomous is.
- Per agent: leave `bypassPermissions` off unless needed; confirm the agent's `engine` (Claude or Codex) before its first run.
- Terminal agents: review `agentDefaultArgs` (default YOLO flags, `S/constants.ts:329`, `S/tui-agent-launch-defaults.ts:10`). Keeping them is a Decision for Carson.

## Gate C — Automations, Asana Auto Mode, Kanban auto-dispatch, heartbeats

**Must be fixed first (in addition to A and B):** #43, #44, #45, #66 (BUILD-024) · #94, N9 (BUILD-025) · #62, #63, #64, #65 (BUILD-026) · #68, #69, #71 (BUILD-027) · #54, #72, #120 (BUILD-028) · #93, #95 (BUILD-040) · #96, #97 (BUILD-042). Recommended, not blocking: #78, #79, #80, N4, N5 (BUILD-029) and X12 (BUILD-031) so ADAM sees and admits autonomous work.

Why: these producers run with nobody watching. They need exactly-once claims, restart reconciliation, and no duplicate paid launches.

**Settings for Gate C (flip one at a time, 24 h apart, watching the run list and spend):**
1. `agentsPaused: false`.
2. Per agent `heartbeat.enabled: true` (start with one agent).
3. `asana-config.json` → `autoMode.enabled: true`; confirm `autoMode.triageAgentId`, `myGid`, `reviewGid`, `allowedProjects`.
4. `vertexAutoModeEnabled: true`.
5. Re-enable automations individually.

## Gate D — Voice Conductor, Jarvis, iMessage bridge

**Must be fixed first (in addition to A, B, C):** #12, #13, #14, #16, N12 (BUILD-032) · #9, #10, #11, #121, X3, X5 (BUILD-033) · #58, #59, #60, #61 (BUILD-036) · #26, #27, X1 (BUILD-006) · #38, #39 (BUILD-019) · #82, #83, #88, X7 (BUILD-037) · #87, #89, #90, #91, #122-F9 (BUILD-038). Recommended: #84, #85, #92, #123 (BUILD-039).

Why: iMessage text reaches a shell (#12) and approvals are forgeable (#11, #14). The conductor runs Opus with `bypassPermissions` and Bash/Write (`M/voice-conductor/conductor.ts:22-30,101`). C2 and C3 stay by design; only their scope and concurrency guards are added.

**Settings for Gate D:**
- Conductor iMessage handle in Settings (replaces env `DOBIUS_IMESSAGE_HANDLE`, `M/index.ts:1925`, after BUILD-033).
- `imessage-bridge.json` → `enabled: true`, `selfHandle`, `triggerPrefix`.
- `voice.jarvisEnabled: true`.
- `voice.conductorEnabled: true` last.

## Gate E — Phone / remote

**Must be fixed first (in addition to A):** #21, #18 (BUILD-034) · #17, #19, #20, #22, X8, N11 (BUILD-035) · #34, #35 (BUILD-016, already in A). Gate B's #7 is required if the phone can reach agent-starting methods.

Why: the phone listener is plain `ws://` on `0.0.0.0:6768` (`M/runtime/runtime-rpc.ts:701-705`), the handshake is replayable, pending QR tokens never expire, and a mobile token can call `terminal.send`, `git.push`, `worktree.rm`, `settings.update`.

**Settings for Gate E:**
- BUILD-003 phone listener switch → on (loopback or LAN per Carson).
- Revoke all pairings and pair again (the protocol version changes in BUILD-035).
- Grant each phone only the capabilities it needs (terminal control is a separate grant after BUILD-034).

## Gate F — Release packaging and auto-update

**Must be fixed first:** #100, #103, #104, #105, #112 (BUILD-043) · #102, #109, #110, N8, X2 + auto version bump (BUILD-044) · #101, #114 (BUILD-045) · #106, #107, #111 (BUILD-046) · #108, #113, #116, #117 (BUILD-048).

Why: one installer with a lock, staging, rollback and truthful provenance must exist before anything installs itself. The updater's enable/disconnect switches must agree before it can check or download.

**Settings for Gate F:**
- Build signing: a Developer ID certificate + notarization (`notarize: isMacRelease`, `dobius/config/electron-builder.config.cjs:235`). Whether Carson has one is **UNDETERMINED**; without it macOS auto-update will not install signed updates onto the current ad-hoc-signed app.
- `DOBIUS_SERVICES_DISCONNECTED` (`M/dobius-disconnect.ts:4`, a code constant `true`) → replaced by the single update policy from BUILD-046.
- Launch with `DOBIUS_ENABLE_DOBIUS_UPDATES=1` only after a GitHub release exists at `statusdigitalmarketing/dobius-plus` (`electron-builder.config.cjs:366-369`).

---

## Gate summary

| Gate | Capability | Blocking bug IDs (count) |
|---|---|---|
| A | Launch, autonomy off | 1, 2, 28, 29, 30, 31, 32, 33, 34, 35, 46, 47, 53, 119 + N6, N10, N13 (14 + 3) |
| B | Manual agents | A + 3, 4, 5, 6, 7, 8v, 15, 23, 24, 25, 40, 41, 42, 55, 56, 57, 67, 70, 73, 74, 75, 76, 77 + N1, N2, N3, X4 |
| C | Autonomous producers | A + B + 43, 44, 45, 54, 62, 63, 64, 65, 66, 68, 69, 71, 72, 93, 94, 95, 96, 97, 120 + N9 |
| D | Voice + iMessage | A + B + C + 9, 10, 11, 12, 13, 14, 16, 26, 27, 38, 39, 58, 59, 60, 61, 82, 83, 87, 88, 89, 90, 91, 121, 122-F9 + N12, X1, X3, X5, X7 |
| E | Phone / remote | A + 17, 18, 19, 20, 21, 22 + N11, X8 |
| F | Release + auto-update | every ID 100–114, plus 116, 117 + N8, X2 |

Bugs not blocking any gate (fixed on their own schedule): #36, #37 (Buzz identity/blob), #48, #49, #50, #51, #52, #78–#81, #84–#86, #92, #98, #99, #115, #118, #122 (F8/F11), #123, X6, X9, X12. They are still in the plan; they just do not stop a capability from returning.
