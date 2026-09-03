# TASK-COMMS-P8 — the eight Grok Bot additions

Written 2026-08-29. Companion to `TASK-COMMS-BUILD-PLAN.md` (Phases 5–7 = the critical path).
Evidence: `IRIS-REPORT-20260829.md`, investigation 3.

Nothing here is copied. Grok Bot has no license and was reconstructed from Anysphere/Cursor's
compiled binary — these are designs we reimplement.

**Two of the eight cost nothing** because they are decisions about a phase we have not built.
Take those now. The rest are real features, ranked and sequenced after Phase 7.

---

## Part A — amendments to Phase 6 (free, do these when Phase 6 starts)

### A1. Adopt their audit action taxonomy

Amend `TASK-COMMS-BUILD-PLAN.md` Phase 6 step 2. Instead of generic columns, the audit row is a
tagged union over four action kinds — all four of which Dobius+ actually performs:

| Kind | Fields |
| --- | --- |
| `shellCommand` | command, shellKind, target, `allowed`, `blockedReason`, `classificationReasons` |
| `computerUseSession` | toolCallId, actionCount, per-action counts, durationMs, screenshotCount |
| `browserNavigation` | url, pageTitle |
| `mcpToolCall` | serverIdentifier, toolName, toolCallId, transport, status, durationMs |

Plus their durability pattern: append a local `audit.jsonl` per agent **and** keep a pending
outbox with rate-limit backoff, so a forwarding failure never loses a row.

- Table via `SyncDatabase` (`src/main/sqlite/sync-database.ts`, 69 lines) mirroring
  `src/main/runtime/orchestration/db.ts` (900 lines) — both confirmed present.
- **Verify first:** no `mcp` directory exists under `src/main`. Find where MCP servers are
  handled before assuming that fourth kind applies; drop it if we do not host MCP servers.
- `computerUseSession` lines up with the `feat/computer-use-v2` branch — coordinate so the
  audit hook lands where the session already ends.

**Cost: zero.** This is what we write instead of what the plan currently says.

### A2. Ship policy as off → shadow → enforce, never straight to enforce

Amend Phase 6 step 1. `parseLocalAutoReviewMode` accepts exactly three modes. **Shadow evaluates
every rule and writes the audit row, but never blocks.**

Our current plan goes straight to fail-closed enforcement, where an incomplete ruleset locks you
out of your own agents on day one. Instead: ship `shadow`, run it a week, read the audit log for
what it *would* have refused, fix the rules, then flip to `enforce`. The mode is one setting
read by the policy evaluator — a few lines, not a subsystem.

**Cost: near zero.** Prevents a self-inflicted outage.

### A3. Permission scope fencing (125 lines, alongside Phase 6)

Reimplement `createLocalToolPermissionScopeGate`: a permission granted under one account
session cannot be replayed after logout and re-login — the re-entered account must publish a
strictly newer revision. Pure in-memory state machine, trivially unit-testable, no IO.

Directly relevant to the multi-account switching work on `account-worok`.

**Verify:** tests proving a stale revision is refused after re-entry, and that same-revision
rows still accumulate.

---

## Part B — standalone features, after Phase 7

Ranked by value-to-risk. Each is its own task with its own plan file.

### B1. Content search — do this first

**Why first:** pure addition, touches nothing that exists, no risk to the hub.

We have **no** full-text search over agent conversations. `knowledge-indexer.ts` (150 lines)
builds a *file tree* — different job, not reusable, though worth mirroring for store shape.

Build: a `node:sqlite` FTS5 index over transcripts, written by a background worker so indexing
never blocks the UI (their `search-index-worker` / `-writer` split is the right shape), plus a
search surface in the restored Communications UI, which already ships `features/search`.

Size estimate: ~400–600 lines + UI wiring. **Test:** index a known transcript, query it, assert
the hit; assert indexing does not block the main thread.

### B2. Memory synthesis

**This is greenfield, not an upgrade** — `src/main/ipc/memory.ts` is 8 lines.

A background pass that turns conversation evidence into durable memories, emitting
`create` / `update` / `remove` against a snapshot, with a **second verification prompt** before
committing. Memories typed `profile` (durable facts about you) or `log` (events). Debounce 15s,
deadline 90s, daily refresh sweep, staleness detection so a slow synthesis cannot clobber newer
state.

Runs through the Phase 5 `AgentProvider` seam, so it uses whichever provider is configured.

Size: ~600 lines. **Test:** feed fixed evidence, assert the change set; assert a stale snapshot
is rejected rather than applied.

**Open question for you:** this costs one LLM call per sweep per agent. Acceptable on your plan?

### B3. Teach recording

Record yourself doing a task; the agent builds a reusable workflow from the recording. Queue
entries HMAC-signed so a recording cannot be spoofed.

**Blocked on a question:** their version records against a private monitor inside their VM. We
have no VM. Does `feat/computer-use-v2` give an isolated capture surface, or would this record
your live desktop — including whatever else is on screen? **Answer that before building.** If it
captures the live desktop, it needs an explicit consent gate and a visible recording indicator.

Size: ~250 lines + capture integration. Sequence after B1 and B2.

### B4. 1Password for secrets

Pull secrets from 1Password instead of storing them in the app. Small, self-contained, and
immediately useful — the ElevenLabs key currently blocking your voice work is exactly this
problem.

Size: small. Do it whenever secrets next annoy you.

### B5. Cross-user sharing — last

Shared rooms across people, with departure obligations and room tombstones so a departure
cannot silently orphan a room.

Their implementation assumes their relay. **Ours is Nostr, which is better suited to this** —
identity and signing are already per-participant. Worth designing fresh rather than porting.

Build only when Sam actually needs to be in a channel with you. Until then it is speculative.

---

## Explicitly not taking

`vnc` (remote desktop into their VM — we run locally), `wallpaper`, `forever-box`,
`box-lifecycle`, `cloud-agents`, `host-upgrade`, `browser-ua`, `source-map`, `state-backstop`,
`codebase-telemetry`, `experiments` (we already have 63 files).

## Order

**Now, inside Phase 6:** A1, A2, A3.
**After Phase 7:** B1 → B2 → B3 → B4 → B5.

A1 and A2 are the ones that matter most, because they improve work that has not been written
yet — and A2 in particular fixes a real flaw in the current Phase 6 plan.
