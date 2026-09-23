# Investigation Report: Dobius+ agent layer — bug verification + live state

Date: 2026-09-23 · Depth: standard · Target: `dobius/src/main` (Dobius+ layer) + live app data in `~/Library/Application Support/dobius-plus/`
Inputs: Codex CLI review (`Obsidian Vault/AI Research/Dobius Codex Review 2026-09-23.md`), Claude gap analysis (`Dobius Agentic Gap Analysis 2026-09-23.md`).
Paths are relative to `dobius/src/main/` unless noted.

## Summary

All 18 bugs in the Codex review were checked against source, and **all 18 are real**. The headline, though, is live state, not code: **the background agent system is switched off.** `agents-config.json` has `agentsPaused: true`, Asana Auto Mode is `enabled: false`, and the last background agent run was **2026-09-16 (status: error)**. Dobius is currently a terminal app with an agent engine that isn't running.

## Key Findings

1. **The agents are paused and Auto Mode is off.** Severity: high (live state).
   - `agents-config.json`: `"agentsPaused": true`. This flag stops both Asana Auto Mode (`agents/asana-auto-mode-service.ts:209`) and heartbeats (`agents/agent-heartbeat-service.ts:196`).
   - `asana-config.json`: `autoMode.enabled: false`.
   - `agents-runs.json`: 50 stored runs. The most recent are 09-08 (3× channel, success), 09-11 (channel, error) and 09-16 (manual, error). Nothing ran after that.
   - No `agent-events.ndjson` journal exists anywhere, which is consistent with zero runs since the journal shipped.

2. **All 18 Codex bugs are confirmed in source.** Severity: 9 high, 9 medium. See the table below.

3. **Every agent with a heartbeat or a broad scope has full permissions.** Severity: high (config).
   - `agents.json`: Adam, Voice Conductor and Gunner all have `bypassPermissions: true`.
   - Adam and Gunner work in `/Users/bayou/Projects (Code)`, the whole projects folder.
   - Gunner is the only agent with heartbeat enabled.
   - Edith and Watson are Codex agents, so bug #1 applies: no budget or turn caps.

4. **The install provenance record is misleading.** Severity: medium (new finding).
   - The installed app's `INSTALL-PROVENANCE.json` says commit `8841a218`.
   - But the bundle contains code first committed on 09-22: `forwardToAdam`, `StudioShell` and `HomePage` are all found in `app.asar`.
   - Cause: `scripts/install-dobius-gated.sh:25` stamps `HEAD` and never records uncommitted changes.

5. **A stale comment caused a wrong claim.** Severity: low (new finding). `voice-conductor/service.ts:42` says custom-agent spawning "fails loudly", but spawning is wired at `:49,70`.

6. **Jarvis's editable root in dev is too broad.** Severity: medium (new finding, inferred and not run).
   - `jarvis/jarvis-ipc.ts:115` uses `resolve(app.getAppPath(), '..', '..')`, and the comment assumes `getAppPath()` is `out/main`.
   - In reality `getAppPath()` is the folder holding `package.json` (`dobius/`). So in dev the root becomes `~/Projects (Code)/Dobius`, the whole product family.
   - When packaged, it becomes the bundle's `Contents` folder instead (Codex #15).

## Bug verification (all 18)

| # | Sev | Where | Verified evidence |
|---|---|---|---|
| 1 | high | `agents/codex-agent-execution.ts:76` | Codex launched with `--sandbox danger-full-access` or `workspace-write`. No budget, turn or tool options appear in the file. |
| 2 | high | `agents/agent-tools/dobius-tool-handlers.ts:178` | `dispatchBuild` takes repo, brief and branch only. It has no lane, budget or concurrency check. Every Claude run gets `mcp__dobius__*` (`agent-runner.ts:348`). |
| 3 | high | `agents/agent-runner-environment.ts:45` | `catch { return os.homedir() }`: an empty catch with a silent fallback. |
| 4 | high | `imessage-bridge/bridge-service.ts:252` | Strips newlines, then `sendTerminal(handle, {text, enter: true})`. There's no check of what's running in the terminal. |
| 5 | high | `voice-conductor/imessage-bridge.ts:47,127` | The reply SQL takes any row after the baseline in that chat, with no `is_from_me` or reply-to binding. The first non-echo text is returned as the answer. |
| 6 | high | `agents/agent-runner.ts:283,324` | `sessionKeyBusy` is computed before `await prepareClaudeLaunch`, and the run is added to the store after it. |
| 7 | high | `voice-conductor/conductor.ts:133,213` | `kick` resolves when `startAgentRun` returns (accepted, not finished). The chain moves on, and `currentRunId` is overwritten. |
| 8 | high | `runtime/rpc/methods/orchestration-gates.ts:49,89`; `runtime/orchestration/db.ts:845` | The row stays `running` in the file DB (`userData/orchestration.db`). There's no startup reconciliation. `runStop` returns `stopped: true` without updating the row. The only escape is `resetAll`/`resetTasks`, which wipe everything. |
| 9 | high | `build-and-install.sh:41` → `scripts/install-dobius-v2.sh:73` | `rm -rf "$INSTALLED"` runs, then `ditto`. The gated installer is bypassed. |
| 10 | med | `agents/agent-runner.ts:482` | `finishCodexRun` calls `onRunEnded` only when `status !== 'success'` and never calls `onResult`. A successful Codex triage leaves its gid in `inFlightTriageGids` (`asana-auto-mode-service.ts:143`). |
| 11 | med | `agents/asana-dispatch-ledger.ts:99,126` | `claimed` persists, and `hasBeenClaimed` treats it as handled. Nothing resets `claimed` on startup. |
| 12 | med | `agents/agent-runs-store.ts:7,116` | `MAX_RUNS = 50`, and `slice(-50)` includes running runs, so updates for evicted IDs return null. |
| 13 | med | `agents/agent-run-event-journal.ts:103` | Disk append and the 5-second ADAM POST share one `writeTail` chain. Replay covers the last 1,000 records and stops at the first forward error. (ADAM does de-duplicate replays: `duplicate: !prepared.created`.) |
| 14 | med | `jarvis/self-edit.ts:185` | `apply` never compares the current file to `oldContent`. A backup is kept, so the damage can be undone. |
| 15 | med | `jarvis/jarvis-ipc.ts:115` | See finding 6. |
| 16 | med | `vertex/vertex-task-store.ts:65` | A parse failure sets `cached = []`. The next `create` persists the empty list plus one card over the original file. |
| 17 | med | `automations/service.ts:70`; `orchestration-gates.ts:74` | `void this.evaluateDueRuns()` has `try/finally` and no `catch`. The coordinator has `.finally` only. There's no `unhandledRejection` handler in `index.ts`. |
| 18 | med | `scripts/install-dobius-gated.sh:28-64,93` | The ownership and version checks run before the lock (`mkdir "$LOCK"`). Then `rm -rf "$DEST"; mv "$STAGE" "$DEST"` leaves a short window with no app. |

## Architecture Map (as it actually runs today)

- Terminals, the daemon, hooks, iMessage → terminal, and CLI dispatch are **running**.
- The Agent runner, Asana Auto Mode and heartbeats **exist but are idle**: paused, disabled, and no runs since 09-16.
- ADAM runs separately (service started 2026-09-23 01:19). Dobius forwards run events to it, but there are no runs to forward.

## Risk Areas

- **Turning the agents back on as-is activates bugs #1, #2, #6, #10 and #11 immediately.**
  - Codex agents would run with no caps.
  - Triage could start builds from review-lane tasks.
  - Successful Codex triages would jam Auto Mode after 2 tasks.
- **iMessage → terminal (#4) is live now.** It doesn't depend on the pause.
- **The normal install path (#9) is the documented one-command build.** One failed copy means no app.

## Recommendations (by impact)

1. **Fix before un-pausing:** #1 (give Codex runs the caps), #2 (lane check and budget in `dispatchBuild`), #10 (call completion on Codex success), #11 (reset `claimed` on startup), #6 (reserve the session before the await).
2. **Fix now, since it's live regardless of the pause:** #4 (only type into a terminal whose foreground process is an agent, or require a prefix plus a confirmation), and #9 (make `build-and-install.sh` call `install-dobius-gated.sh`).
3. **Data safety:** #16 (on a read failure, keep the file and refuse writes; don't cache empty), and #8 (reconcile orphaned `running` rows on DB open).
4. **Then un-pause in steps:** first Gunner's heartbeat only, then Auto Mode with a Claude triage agent, watching `agents-runs.json` and the journal.
5. **Housekeeping:**
   - Fix the stale comment at `voice-conductor/service.ts:42`.
   - Stamp a `dirty: true` flag in the install provenance.
   - Drop `bypassPermissions` from agents that don't need it.

## Open Questions

1. Why were the agents paused, and Auto Mode turned off? A deliberate stop after the 09-11 and 09-16 errors, or a leftover?
2. Should Edith and Watson stay on Codex once #1 is fixed, or move to Claude until Codex has the same caps?
3. Is iMessage → terminal something Carson actively uses? If not, turning it off is the cheapest fix for #4.
