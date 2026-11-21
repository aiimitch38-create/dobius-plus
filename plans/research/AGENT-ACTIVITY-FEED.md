# Agent activity feed (plan item 8.10): research and design

Status: research only. No app code changed.
Plan source: plans/WORKSTATION-BUILD-PLAN.md, "Plan: agent activity feed (8.10)".

Key terms, in plain English:
- **Journal** (an append-only log file): one line of JSON per event, never edited, only added to.
- **Cursor** (a bookmark file): records how far a reader has read, so it can pick up where it stopped.
- **Ingest** (receive and store): ADAM's way of accepting events over HTTP at `/v1/events/ingest`.
- **Projection** (a copy in another format): here, turning each event into a line of markdown in the vault.
- **Vault** (the Obsidian notes folder): `~/Obsidian Vault`.

## Summary

The old writer of the vault notes was a function in the ADAM service that copied each event into a daily markdown file. That function lives only in a candidate copy inside the plans folder. The live ADAM program is not on disk. The app's own event journal is still being written, but nothing has delivered events to ADAM since 2026-10-23, so the notes stopped that day. Recommendation: make the app's own journal the one writer. It feeds an in-app panel and a daily vault note directly, so it no longer depends on ADAM being up.

## Findings

### 1. The old vault writer

**Verified: the writer.** `…/Projects (Code)/Dobius/dobius-plus/plans/worker-monitor-20261014/adam-production-composition-candidate/service/src/events/obsidian-projection.ts` (43 lines):
- Line 8-10: vault path is `ADAM_OBSIDIAN_VAULT_PATH`, or `~/Obsidian Vault` by default.
- Line 12-14: daily file is `AI Research/Dobius Agent Activity/<YYYY-MM-DD>.md`, date from the event time.
- Line 17-27: each line is `- <time> **<eventType>** (<links>) — <payload JSON>`. This matches the existing notes exactly.
- Line 29-41: queued writes, one at a time, with a `catch` that logs a warning and carries on.

**Verified: the caller.** `events/ingest.ts:55` calls `queueObsidianProjection(event)` only when a new row was inserted (`inserted` check at `:54`). Events arrive over HTTP at `runtime/service.ts:375-381` (`POST /v1/events/ingest`).

**Verified: three copies, one content.** `adam-production-composition-candidate`, `-v2`, `-v3`, `-v4` all have the same MD5 for this file (`a3dc488d…`).

**Verified: the live ADAM program is not on disk.**
- launchd job `com.adam.service` runs `node ~/dobius/projects/ADAM/service/dist/main.js --serve`.
- `~/dobius/projects/ADAM/service/` contains only a `data/` folder. There is no `dist/` folder.
- `launchctl list` shows `com.adam.service` with a PID (28698) and last exit status 1. Both facts together are unclear. Not investigated further.
- So the writer code that ran on 2026-10-23 is not here to read. The candidate copy is the only source.

### 2. Event sources

**Verified: the app's run journal (live).**
- `main/agents/agent-run-event-journal.ts:87-108` appends one JSON line per run event (`agent.run.<kind>`).
- Path: `agentRunJournalPath()` = `<userData>/agent-events.ndjson` (`agent-run-event-delivery.ts:57-59`). On this Mac that is `~/Library/Application Support/dobius-plus/agent-events.ndjson`.
- 227 lines, from 2026-09-24 to 2026-11-21. Types: `agent.run.tool-use` (49), `agent.run.system` (48), `agent.run.tool-result` (47), `agent.run.error` (32), `agent.run.assistant-text` (29), `agent.run.result` (22).
- The file was written today (last line 2026-11-21 14:33 UTC).

**Verified: the delivery to ADAM and its bookmark.**
- `main/agents/agent-run-event-delivery.ts` drains the journal and posts each record to ADAM. `adam-event-ingest.ts:22` does `fetch(<endpoint>/v1/events/ingest)`.
- Bookmark file: `agent-events.cursor.json` = `{"version":1,"offset":68205}`. Its modified time is 2026-10-23 15:47 local.
- Byte 68205 is the start of line 120 of the journal. Lines 1-119 are dated up to 2026-10-23 20:48 UTC. Line 120 is dated 2026-11-17 07:08 UTC.
- So: 119 events were delivered, the bookmark stopped on 2026-10-23, and **108 events from 2026-11-17 to 2026-11-21 have not been delivered**.
- No `agent-events.quarantine.ndjson` exists, so ADAM did not reject any record. Quarantine is only written on a rejection.

**Inferred: why delivery stopped.** Two likely causes, not checked:
(a) ADAM's HTTP endpoint is not answering (the live program is missing from disk, see above), so every post fails and the bookmark never moves. The journal then grows unseen.
(b) The drainer stopped running.
The 2026-10-23 bookmark time matches the last vault note (`2026-10-23.md`, mtime 15:47). One cause explains both. To settle it: check whether anything listens on ADAM's port. This was not probed in this pass.

**Verified: other sources exist but were not read in depth:**
- Orchestration messages: `<userData>/orchestration.db` (3.5 MB, WAL updated 2026-11-21 13:14). Used by `dobius orchestration`.
- Automation runs: `dobius-plus/dobius/src/main/automations/` (folder exists).
- Terminal agent status hooks: `dobius-plus/dobius/src/main/agent-hooks/` (folder exists).

**Verified: the stopped-writer claim in the plan.** The plan says the writer is "not in dobius/src or ~/.claude/hooks". Correct: it lives only in the ADAM candidate copy under plans/.

### 3. Verification of the plan's own claim

`plans/TASK-DOBIUS-MASTER-BUILD-PLAN.md:26` says "Obsidian event projection is live — `Dobius Agent Activity/*.md` are real ADAM-ingested logs." That line is out of date. The notes stopped on 2026-10-23, so the projection is not live now.

## Recommended design: one writer

One writer: the app's own journal, read by a single small projector inside the app.

1. The journal stays the source of truth. `agent-run-event-journal.ts` already writes it first, so nothing else changes at the write side.
2. A new **vault projector** in the app reads the journal with its **own** bookmark file (not the ADAM one). It appends the same markdown line format to `AI Research/Dobius Agent Activity/<date>.md`. Same format, so the old notes and new notes look the same.
3. The **in-app panel** reads the same journal (tail of the last N lines, or an IPC call). It does not need its own store.
4. ADAM delivery stays as it is. If ADAM is down, the vault and panel keep working. ADAM can be retired from this job later, with Carson's OK.
5. Backfill: the projector starts from its own bookmark at 0, so the 108 undelivered events and any earlier ones can be written to the vault once. Carson decides (see questions).

Why this and not "revive ADAM's writer": ADAM's program is not on disk, nothing shown here ties the candidate copy to a running build, and the design depends on ADAM being up. The app's journal is local, always written, and already has the fields the panel needs.

## Task list

| # | Task | Files | Size |
|---|---|---|---|
| A1 | Vault projector: read journal, own bookmark, append daily markdown in the existing line format | new `main/agents/agent-activity-vault.ts` (model on `main/agents/agent-run-event-delivery.ts` cursor logic and `obsidian-projection.ts` render); vault path from settings | M |
| A2 | Tests: fixture journal to expected markdown lines; bookmark survives restart; no duplicate lines | new `main/agents/agent-activity-vault.test.ts` | S |
| A3 | In-app panel: read the last N journal lines (IPC) and show them newest first | new IPC in `main/ipc/` (follow existing pattern), new renderer component (location: Knowledge page or board side app, open question) | M |
| A4 | Start the projector with the app (same place the journal delivery starts: `startAgentRunEventDelivery`) | `main/agents/agent-run-event-delivery.ts:110` area or app start file | S |
| A5 | Backfill once (projector from bookmark 0), reviewed by Carson first | run, no code | S |
| A6 | Retire `obsidian-projection.ts` from the ADAM candidate (do not edit ADAM here) | `plans/worker-monitor-20261014/.../obsidian-projection.ts` | S, needs OK |
| A7 | Check ADAM endpoint health and fix or retire the ADAM delivery bookmark | ADAM service (not in this repo) | M, needs OK |

Total: roughly one M for the projector, one M for the panel, plus S tasks. The projector can ship before the panel.

## Open questions for Carson

1. Should the 108 undelivered events (2026-11-17 to 2026-11-21) be written to the vault as a one-time backfill? Should older events be backfilled too (back to 2026-09-24)?
2. Should ADAM still get these events? If yes, A7 is needed. If no, ADAM delivery can be turned off.
3. Where should the in-app panel live: Knowledge page, the board side app, or both?
4. Vault path: keep `~/Obsidian Vault` as default, or use a setting?
5. Retire the ADAM candidate writer (A6)? It is only in plans/, so this is cleanup, not a live change.
