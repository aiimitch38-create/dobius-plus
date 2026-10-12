# Dobius+ V2 — Observability

Date: 2026-09-24. Where Dobius fails silently today, and the one event shape every stabilization build uses when it touches such a site.

"Re-read 09-24" = line read in source by Run B. "(Run A)" = cited by ARCHITECTURE-MAP or BUG-MATRIX and consistent with what Run B saw nearby; re-confirm before editing.

## 1. Silent failure sites

### Control and admission
| Site | What happens silently | Bug | Evidence |
|---|---|---|---|
| `M/agents/agents-config-store.ts:63-73` | malformed JSON (no `code`) → defaults, **no log**; EACCES → warn only; either way the crew unpauses | #2 | re-read 09-24 |
| `M/agents/agents-config-store.ts:84-89` | failed pause write → warn only; pause lives in memory until restart | #2 | re-read 09-24 |
| `M/agents/agent-channel-service.ts:156-158` | every start failure (paused, cap, auth, agent missing) is reported to the phone as "busy" | #1 | re-read 09-24 |
| `R/components/kanban/board-dispatch.ts:99` | `getChannels().catch(() => [])`: channel lookup failure looks like "no channels" | N9 area | re-read 09-24 |
| `R/components/kanban/board-dispatch.ts:174` | `void dispatchTask(...)` with no catch; claim update rejection leaks the slot | N9 | re-read 09-24 |
| `M/voice-conductor/conductor.ts:215` | `.catch(() => {})` on the turn chain hides the previous turn's failure | #58 | re-read 09-24 |
| `M/agents/asana-auto-mode-service.ts:149-156` | triage start failure → warn + counted as a failed attempt, even when caused by pause | #1, #43 | re-read 09-24 |
| `M/agents/agent-heartbeat-service.ts:207-212` | heartbeat failure → warn only | #66 | re-read 09-24 |

### Persistence
| Site | What happens silently | Bug | Evidence |
|---|---|---|---|
| `M/agents/agent-runs-store.ts:88-94` | any load error → `[]`, **no log**, then `persistRuns([])` overwrites history | #29 | re-read 09-24 |
| `M/vertex/vertex-task-store.ts:60-69` | corrupt board → `[]` with a comment, no log; next save wipes cards | #28 | re-read 09-24 |
| `M/agents/asana-dispatch-ledger.ts:64-72` | SyntaxError not logged; ledger becomes `[]` | #30 | re-read 09-24 |
| `M/agents/agents-store.ts:124-132`, `M/asana/asana-config.ts:86-92`, briefing/draft/notification stores | read failure → empty/defaults, next save overwrites | #30 | Run A |
| `M/persistence.ts:224-233` | `encrypt()` returns plaintext when safeStorage is unavailable or throws | #25 | Run A |
| `M/persistence.ts:2795-2800` | backup restore writes primary non-atomically | #31, N6 | Run A |
| `M/persistence.ts:3311-3335` | one invalid `workspaceSession` field resets all tabs | #32 | Run A |
| `M/runtime/e2ee-keypair.ts:45-56` | unreadable keypair → new keypair, phones break | #34 | Run A |
| `M/runtime/device-registry.ts:118-129` | unreadable registry → `[]`, next save erases pairings | #35 | Run A |
| `M/browser/browser-session-registry.ts:78-85` | fixed `.tmp` name; `catch { // best-effort }` | #51 | re-read 09-24 |
| `M/stats/collector.ts:264-266` | no cleanup of the tmp when write/rename fails | #49 | re-read 09-24 |
| `M/agent-hooks/server.ts:1601-1605, 1613-1619` | chmod failure swallowed; tmp unlinked only when fully written | #49 | re-read 09-24 |
| `M/daemon/history-manager.ts:85` | `meta.json` written in place | #50 | Run A |

### Agent runtime and ADAM
| Site | What happens silently | Bug | Evidence |
|---|---|---|---|
| `M/agents/agent-runner-environment.ts:45-51` | `mkdirSync` failure → `os.homedir()`, no log | #23 | re-read 09-24 |
| `M/agents/agent-run-event-journal.ts:60-65` | token read failure → `undefined`, no log | #79 | re-read 09-24 |
| `M/agents/agent-run-event-journal.ts:76-77` | no token → forwarding returns without a trace | #79 | Run A |
| `M/agents/agent-run-event-journal.ts:103-116` | replay stops at first failed post | #78, #80 | Run A |
| `M/agents/codex-agent-execution.ts:139` | no stdin error listener | #70 | Run A |
| `M/automations/service.ts:70-71` | `void this.evaluateDueRuns()`, no catch | #71 | re-read 09-24 |
| `M/runtime/rpc/methods/orchestration-gates.ts:74-78` | coordinator loop fire-and-forget, `.finally` only | #71 | Run A |

### Messaging, voice, settings, updater
| Site | What happens silently | Bug | Evidence |
|---|---|---|---|
| `M/imessage-bridge/bridge-service.ts:217-221` | poll error → warn, watermark not advanced, commands retyped | #13 | re-read 09-24 |
| `M/imessage-bridge/bridge-service.ts:269-272` | failure reply swallowed with a comment | #12 | re-read 09-24 |
| `M/voice-conductor/imessage-bridge.ts:118-135` | any newer message counts as approval | #11 | Run A |
| `M/jarvis/jarvis-ipc.ts:204-211` | shortcut grab fails → writes `jarvisEnabled:false` silently | #122-F9 | Run A |
| `M/jarvis/agent-context.ts:77-101` | failed `--help` cached as the command set | #87 | Run A |
| `M/jarvis/elevenlabs-client.ts:75-95` | TTS temp dirs never removed | #90 | Run A |
| `M/speech/openai-transcription-client.ts:78-86` | `fetch` with no timeout | #84 | Run A |
| `R/hooks/use-audio-capture.ts:179` | feed rejections discarded | #85 | Run A |
| `R/components/automations/AutomationsPage.tsx:1750,1759,1820` | mutation rejections not surfaced | #96 | Run A |
| `M/updater.ts:1040` | disabled updates reported as "not-available" (UI: up to date) | #107 | Run A |
| `M/telemetry/client.ts:48` | `TELEMETRY_ENABLED = false` while the toggle is shown | #122 | Run A |

## 2. The one event shape

Every stabilization build that touches a site above replaces the silent path with **one** structured event (plus the behavior fix). No other logging format is introduced.

```ts
type StabilityEvent = {
  ts: string            // ISO-8601 UTC, e.g. "2026-09-24T14:03:11.402Z"
  component: string     // dotted owner, e.g. "agents.gate", "store.agent-runs", "imessage.bridge", "persistence.primary"
  operation: string     // verb phrase, e.g. "admit", "load", "save", "restore", "dispatch-command", "forward-event"
  runId: string | null  // agent run id, automation run id, coordinator run id, or null
  taskId: string | null // Asana gid, board task id, orchestration task id, or null
  severity: 'debug' | 'info' | 'warn' | 'error' | 'fatal'
  recoverable: boolean  // true = the app continued in a safe state; false = operator action needed
  cause: {
    code: string | null // errno ('EACCES'), SDK subtype, gate reason ('paused'), HTTP status
    message: string     // short, redacted; never file contents, prompts, message text or tokens
  }
}
```

Rules:
- **Never log secrets.** `cause.message` passes through the existing redactor (`M/observability/redactor.ts:169` `redactString`, `:263` `redactAttributes`). Callers also never put tokens, API keys, handles, iMessage text, prompts, task notes, or file contents into any field. Paths are fine; file bytes are not.
- `recoverable: false` events are also shown in the UI where the operator acts (e.g. Agents page for the control file, Settings for credentials).
- One event per failure occurrence; repeated identical failures (same component, operation, code) are rate-limited to one per minute with a count.

## 3. Where events go

Reuse what the engine already has instead of a new sink:
- The local NDJSON sink `logs/main.trace.ndjson` under userData, 10 MB × 10 files, private modes (`M/observability/local-file-sink.ts`, installed by `initObservability` at `M/observability/index.ts:169`), redacted at write time.
- Emit through the tracer (`M/observability/tracer.ts:164` `startSpan(name, { kind, attributes })` then `fail(cause)` or `end()`), mapping the `StabilityEvent` fields to span attributes. The exact attribute mapping is **UNDETERMINED** until the implementer reads `tracer.ts` fully; keep it in one small Dobius-layer helper (proposed `M/diagnostics/stability-event.ts`), justified by the silent sites above (#2, #13, #23, #28, #29, #79, #96, #107, #122-F9).
- Mirror `warn`+ events to `console` with the same one-line shape so dev logs stay useful.
- When local diagnostics are disabled (`DOBIUS_DIAGNOSTICS_DISABLED`, handled in `observability/index.ts`), the helper still writes to console; it never fails the operation.

## 4. Adoption order

1. BUILD-001 writes its two new log lines (`agents.gate/admit` denial, `info`, recoverable; `agents.control/load` unreadable, `error`, not recoverable) to console in the `StabilityEvent` field order. It does not add the helper, to stay small.
2. BUILD-009 adds the helper `M/diagnostics/stability-event.ts`, moves BUILD-001's two lines onto it, and emits `store.<name>/load|save` failures for every store it migrates.
3. BUILD-022/023/027 emit run finalizer anomalies (`run.lifecycle/finalize` duplicate or missing).
4. BUILD-029 emits `adam.delivery/forward` with backlog size, never payloads.
5. Remaining sites adopt the shape in the build that fixes them. No standalone "logging" build.
