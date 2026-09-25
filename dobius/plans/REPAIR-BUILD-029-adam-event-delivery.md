# REPAIR BUILD-029 — ADAM event delivery (#78, #79, #80, N4, N5)

## Root cause
All in `src/main/agents/agent-run-event-journal.ts` (pre-fix line numbers) plus one wiring site in `index.ts`.
- **#78** `appendAgentRunJournalEvent` (:101-113) put the disk append and `forwardToAdam` (5 s POST) on
  one promise chain `writeTail`, so a slow/offline ADAM delayed every later append. `replayRecent...`
  (:115-143) ran on the same chain and forwarded sequentially: the first failed POST ended the replay.
  Unparseable lines were silently dropped (:130-134).
- **#79** `adamServiceToken` (:47-66) swallowed every read error into `undefined`; `forwardToAdam`
  (:88) then returned as if delivered. No log, no state, nothing queued.
- **#80** No retry and no acknowledgement: a failed POST was logged and forgotten until the next
  launch, where replay re-posted only the last 1,000 lines (older backlog never delivered).
- **N4** `dataDirectory()` (:27-32) returned `DOBIUS_DATA_DIR ?? ~/.dobius` before `app.isReady()`
  and `userData` after, so an early append and the post-ready replay could use different files.
- **N5** `index.ts` fired the replay as the first line of `whenReady` (before `store = new Store()`),
  re-posting up to 1,000 events on every launch because nothing recorded what was already delivered.

## Fix
- `agent-run-event-journal.ts` keeps record building and the append chain only. The chain does
  `mkdir` + `appendFile` and then *signals* the drainer (`requestAgentRunEventDelivery()`); it never
  awaits the network.
- New `agent-run-event-delivery.ts` — outbox drainer:
  - Cursor file `agent-events.cursor.json` (`{version:1, offset}` = byte offset of the first
    undelivered line) via BUILD-009 `SafeJsonFile` (atomic save; unreadable cursor → state
    `cursor-unreadable`, delivery waits instead of restarting from byte 0).
  - Reads only complete lines from the offset (in-progress trailing line left for the next pass;
    records larger than 1 MB are still read whole). Byte offsets, not string lengths (UTF-8 safe).
  - Poison: an unparseable line, or ADAM answering 400/413/422, is appended to
    `agent-events.quarantine.ndjson` (line kept verbatim, never deleted) and skipped; later events
    continue. If the quarantine write fails, the cursor does not advance.
  - Transient (network error, timeout, 5xx, 408/429, other codes) and 401/403: stop, keep the
    cursor, bounded exponential backoff 1 s → 60 s within the session; new appends during backoff
    wait for the retry. Success resets the backoff.
  - Missing/empty/unreadable token: state `no-token` with the errno only, events stay pending,
    retried on the same backoff (a token that appears later is picked up without restart).
  - Health: `getAdamEventDeliveryHealth()` → `{state, detail, deliveredCount, quarantinedCount,
    nextRetryAt}`; each change into a paused state is logged once:
    `[agents] ADAM event delivery paused (<state>: <errno/HTTP code>)`. Never the token, never
    payload text.
  - Cursor saved every 50 lines and at every stop; a crash re-sends at most one batch and ADAM
    de-duplicates by `eventId` (IRIS #13: `duplicate: !prepared.created`) → "once logically".
  - Journal shorter than the cursor (replaced outside the app) → deliver from byte 0, with a warning.
  - Paths all use `getUserDataRoot()` (BUILD-014), identical before/after ready (N4).
- New `adam-event-ingest.ts`: the unchanged token resolution (same env names and default path —
  unifying with Jarvis is BUILD-030 #81) and the POST, returning `delivered | poison | retry(state)`.
  Split out because `agent-run-event-delivery.ts` otherwise exceeds oxlint `max-lines` (300).
  The POST body is now the journal line verbatim (previously the parsed record re-serialized; same
  JSON).
- `index.ts`: removed the replay from the top of `whenReady`; `startAgentRunEventDelivery()` is
  called (same dynamic-import pattern) right after `logStartupMilestone('store-loaded')`. It starts
  a background drain from the saved cursor. Before it runs, appends are journaled but not sent.

## Tests — `src/main/agents/agent-run-event-journal.test.ts` (7)
1. ADAM hangs forever → two more appends still reach disk; only one POST in flight (#78).
2. Journal with valid, `{not json`, record rejected with 422, `{no eventId}`, valid → both valid
   delivered in order, 3 quarantine entries (raw line kept), cursor = file size, no payload text in
   logs (#78).
3. No token (missing token file) → no POST, state `no-token`, detail `token file ENOENT`,
   `nextRetryAt` set, warning logged, no cursor written; token file appears → next retry delivers
   both; token never in logs (#79).
4. 1,500-record backlog, network error on record 700 → state `offline`, 701 attempts; after the 1 s
   retry, every eventId acknowledged exactly once in order, `deliveredCount` 1,500; module reload
   ("restart") → zero re-posts; a new append → exactly one POST (#80, N5).
5. Appends before `startAgentRunEventDelivery()` are journaled, not sent (N5).
6. `DOBIUS_DATA_DIR` set, append before and after `isReady()` flips → one file under userData,
   nothing under `DOBIUS_DATA_DIR` (N4).
7. Source-order check on `index.ts`: `startAgentRunEventDelivery()` after `store = new Store()`,
   `replayRecentAgentRunJournalEvents` gone (N5; same pattern as
   `startup/desktop-startup-ordering.test.ts`).

### Mutation checks (each broke the named tests, then restored)
- M0 original journal file → 6 of 7 fail (the static index test passes with the fixed index.ts).
- M1 append chain awaits the drain → test 1 fails.
- M2 poison treated as retry (replay stops) → tests 2, 4 fail.
- M3 no-token returns "caught up" silently → test 3 fails.
- M4 retry never scheduled → tests 3, 4 fail.
- M5 cursor never persisted → tests 2, 4 fail.
- M6 journal path back to `DOBIUS_DATA_DIR ?? root` → test 6 fails.
- M7 index.ts reverted → test 7 fails.
- M8 drain allowed before start → test 5 fails.

## Verification
- `pnpm run typecheck` exit 0.
- `vitest src/main/agents src/main/storage src/main/startup/desktop-startup-ordering.test.ts` →
  21 files / 242 tests green. `communications/providers/agent-provider.test.ts` (imports
  agent-run-events) fails 1 test with "No `app` export on the electron mock" from
  `agent-runs-store.ts` — listed in the baseline failures (`basefail.txt`), not caused by this build.
- oxlint (default + react-doctor) on all changed files: clean.
- Full suite: DEFERRED (coordinator).

## Deviations from EXECUTION-ORDER.md
- Two new files (`agent-run-event-delivery.ts`, `adam-event-ingest.ts`) to stay under `max-lines`.
- `replayRecentAgentRunJournalEvents` is removed (renamed in spirit to
  `startAgentRunEventDelivery`); its only caller was index.ts.
- Health is exposed as a main-process getter + one warning per state change. No renderer/IPC
  surface was added (would touch preload/IPC files owned by other builds, and would be a new
  feature); a UI can read `getAdamEventDeliveryHealth()` later.
- Journals written pre-fix to `~/.dobius/agent-events.ndjson` (pre-ready path) are not migrated.
  ARCHITECTURE-MAP 2.2 records that no journal exists in either location on this machine.

## Rollback
Revert the commit. The cursor and quarantine files are additive; the old code ignores them. The
journal format is unchanged.

## Lessons
- Keep durable append and network delivery on separate paths; the network side reads what is on
  disk and records progress in its own cursor.
