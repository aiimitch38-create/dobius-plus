# REPAIR BUILD-023 — run sessions and history (#56 #57 N2 #42 #77)

## Root causes
- **#56** `agent-runner.ts` `startAgentRun` computed `sessionKeyBusy` from stored run history
  *before* `await prepareClaudeLaunch`, and the run was only added to the store *after* it. Two
  starts on the same (agent, sessionKey) both saw "not busy" and both resumed one session (two
  writers on one transcript). Stored history was being used as a mutex.
- **#57** `agents-store.ts` `resetAgentSession` cleared only `lastSessionId`. `getAgentSessionForKey`
  reads `sessionsByKey[key]` first, so the next run resumed the "reset" session anyway; channel
  keys were never cleared; and a run already in flight re-recorded its session on init/result.
- **N2** `agent-channel-service.ts` started iMessage `@Agent` runs with no `sessionKey`, so they ran
  on `'default'`: their init/result wrote the phone conversation into the manual default session
  (and legacy fields) that the Agents-page run resumes, and they marked `'default'` busy.
  (`workflow-executor.ts` already documented that the channel service "had" this guard; it did not.)
- **#42** `agent-runs-store.ts` trimmed with `slice(-50)` on every save, including running runs.
  A run older than the newest 50 was evicted while live, so `updateStoredAgentRun` (completion,
  cancellation) returned null, `appendAgentRunOutbox` refused its messages, and the runner's
  `getStoredAgentRun(runId)?.sessionKey` fell back to `'default'`.
- **#77** the in-memory per-run outbox had a run-count cap (32) but no byte bound per run or in
  total; each screenshot is ~1 MB of base64.

## Fix
- New `src/main/agents/agent-session-lease.ts` (pure, in-memory, no imports):
  `claimRunSession(runId, agentId, key)` is taken synchronously before any await; returns
  whether the run owns the key (only the owner may resume). `releaseRunSession(runId)` is
  idempotent and called from every finalizer: `consumeRun`'s non-delegated `finally`, the
  `startAgentRun` catch, and `finishCodexRun`. Reset epochs (per agent and per key) make
  `currentRunSessionKey(runId)` return null for a run that started before a reset.
- `agent-runner.ts`: busy check replaced by the claim; session recording goes through
  `recordRunSession`, keyed by the claim (not stored history) and skipped after a reset.
- `agents-store.ts`: `resetAgentSession(id, sessionKey?)` — no key clears legacy fields and every
  keyed session; a key clears only that key (plus legacy fields for `'default'`); both bump the
  lease epoch so in-flight runs cannot write back.
- `shared/agents.ts`: `IMESSAGE_SESSION_KEY = 'imessage'`; `agent-channel-service.ts` passes it.
  Renderer channel revival (`dobiusCommunications.ts` `reviveInterruptedChannelRuns`) treated every
  non-`'default'` key as a channel id, so it now skips `'imessage'` (otherwise an interrupted
  iMessage run would be re-run as a channel run into a nonexistent channel, with phone text).
- `agent-runs-store.ts`: `retainRuns` drops the oldest *settled* runs only; running runs are never
  evicted (so the file can briefly exceed 50 while >50 are live). Same function on load.
- Outbox budget (#77, chosen): **8 MiB per run, 32 MiB total** (bytes = UTF-8 content +
  data-URI length). Over the per-run budget the oldest items of that run are dropped; over the
  total, whole outboxes of the least recently written runs are dropped (the run just written to
  is re-inserted as newest). An item alone over 8 MiB is rejected (`false`). Drops log a count
  only (no content). A reader whose `afterId` was trimmed receives everything still queued,
  which is exactly the items after it (trim is oldest-first). Tool failure text in
  `dobius-tool-server.ts` now names the size limit.

## Tests (all seen FAIL with the fix removed, PASS with it)
- `agent-runner-session-lease.test.ts` (new): barrier two starts inside `prepareClaudeLaunch` with a
  faithful in-memory run store → exactly one resumes; different keys both resume; key freed after
  the owner finishes and after a failed start; a reset during a run suppresses its session write.
- `agents-store-session-reset.test.ts` (new, temp userData): reset clears default + legacy + all
  channel keys, persists across reload, per-key reset leaves others, in-flight runs invalidated.
- `agent-runs-store.test.ts` (extended): >50 runs with older ones live → updates + outbox still
  work; >50 live runs never evicted; per-run budget, oversize rejection, total budget.
- `agent-channel-service.test.ts` (extended): iMessage runs use `IMESSAGE_SESSION_KEY`.
- `reviveInterruptedChannelRuns.test.mjs` (new): revival re-kicks a channel run, never `'imessage'`.

Mutation checks (each made the named tests fail, then restored): old stored-history busy check;
no release in `consumeRun` finally; no release in `startAgentRun` catch; old reset body; no
epoch bump; runner recording keyed by stored run ignoring epochs; no iMessage key; no renderer
revival guard; `slice(-MAX_RUNS)`; no per-run trim; no total trim; no oversize rejection.

## Verification
- `pnpm run typecheck` exit 0.
- Targeted: `src/main/agents/`, `custom-agents.test.ts`, `safe-json-store-migrations.test.ts`,
  `dobiusCommunications.test.mjs`, `reviveInterruptedChannelRuns.test.mjs` → 27 files, 422 passed.
  (`invites.test.mjs` and `relayReconnectController.test.mjs` in the same dir fail identically
  without this change; both are in basefail.txt.)
- oxlint clean on changed files except pre-existing: `agent-runner.ts` max-lines (was over before;
  net +6 lines), and `dobiusCommunications.ts` 127 pre-existing errors (same count before and after).

## Deviations
- Touched outside the listed files: `agent-tools/dobius-tool-server.ts` (failure message only),
  `shared/agents.ts` (constant), renderer `dobiusCommunications.ts` (one-line revival guard),
  new `agent-session-lease.ts`.
- Did not fix the 127 pre-existing lint errors in the 4458-line renderer file (mass churn in a
  shared file other builders touch).
- Truncation is exposed to the agent (tool failure) and in the log; the RPC shape of
  `agent.runOutbox` is unchanged (no truncation flag to the renderer).
- Note for later: workflow runs without a channel use `workflow:<id>` keys and are still
  revival candidates in the renderer (pre-existing, out of scope).

## Decisions for Carson
- "New session" on the Agents page now resets **all** of the agent's sessions (default and every
  channel). Per-key reset exists in the store (`resetAgentSession(id, key)`) if he prefers the
  button to reset only the manual session.
- Outbox budget 8 MiB per run / 32 MiB total.

## Rollback
Revert the commit. No data format change: `agents.json` / `agents-runs.json` fields unchanged;
the lease and outbox are memory-only.

## Lessons
- Stored run history is display state; any exclusivity must be reserved synchronously in memory.
- A "busy" check that reads state written after an `await` is a check-then-act race.
