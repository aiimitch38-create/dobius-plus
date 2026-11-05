# Hermes head continuity and Dobius bridge contract

Date: 2026-10-14  
Task/dispatch: `task_f8fba53c4a2e` / `ctx_98b297d06c05`  
Repository: `/Users/bayou/Projects (Code)/Dobius/dobius-plus`, branch `fix/channel-cost`  
Scope: read-only inspection of the installed Hermes v0.22.0 source/docs and the two specified Dobius architecture reviews. No runtime, profile, session, credential, service, or provider was inspected or changed; no tests/builds were run.

## Finding

Hermes v0.22.0 has a supported authenticated API for creating a run against an explicit Hermes `session_id`, polling it, receiving structured events, resolving approval, and requesting stop. If the caller already knows the correct session ID and uses the same Hermes profile/session database, the API can continue that transcript. Its agent turn facade uses a durable SQLite session lease shared across processes, so API and CLI turns that use the same persisted session are serialized and a contending turn reloads the transcript after acquiring the lease.

That does **not** attach Dobius or ADAM to the live interactive process, its input queue, or its in-memory UI. `POST /v1/runs` creates a new run/agent invocation; the session ID selects persisted conversation continuity. The source does not expose a “take over this active TUI process” operation or establish which session is the current Adam head. The separate gateway `SessionTurnLeaseRegistry` is process-local and explicitly excludes CLI-continuity processes; cross-process serialization comes from `agent/turn_facade_lease.py` and the session database lease. These mechanisms serialize turns on one transcript, but do not elect one global reasoning-head owner or prevent a second independent session/profile/gateway from becoming another head.

Therefore: **session continuation is supported; safe live-head attachment is not established.** Do not start another Hermes gateway/runtime to obtain API access. Reuse the one already-designated Hermes runtime only after its process, API listener, profile, and exact session identity are verified by ROOT using approved non-secret status evidence. If the current interactive UI is a CLI process rather than the API-enabled gateway, the API would submit a separate invocation against the same transcript, not attach to that process. Cross-process lease behavior is useful protection, not proof of the intended Adam identity or an application-wide single-owner rule.

## Source anchors and contracts

### API run, transcript, idempotency, and event IDs

`website/docs/user-guide/features/api-server.md` documents `POST /v1/runs`, optional `session_id`, `GET /v1/runs/{run_id}`, `GET /v1/runs/{run_id}/events`, approval and stop. It states that a run using an existing session with no caller-provided history/response chain loads the active transcript; it also documents a durable `Idempotency-Key`, payload conflict rejection, per-profile/credential namespace, and 24-hour post-update retention (lines 448–468). `gateway/platforms/api_server_runs.py::_handle_runs` validates and fingerprints the key and canonical JSON body, checks replay before concurrency admission, atomically reserves before scheduling the task, resolves the live compression tip, and loads the existing transcript (source lines 620–730). A retry with the same key/body returns the original run ID; a changed request under that key returns conflict. This is the supported exactly-once-admission/replay boundary for a run creation request during the documented retention horizon; it is not exactly-once tool execution across Dobius and ADAM.

The run SSE cursor is a monotonically increasing per-process sequence (`_RunStream.next_seq`) and may be sent as `Last-Event-ID` or `last_seq`. Replay comes from a bounded in-memory deque of 1,000 events; if the requested cursor predates retained events the stream emits `replay.truncated` with the oldest retained sequence (source `api_server_runs.py` lines 116–153 and 1064–1125). Subscriber queues cap at 256 and are detached on overflow. Orphaned event transport is swept after 300 seconds, while a connected subscriber remains; terminal run status is kept in memory for 3,600 seconds (`api_server.py` lines 4358–4359; `api_server_runs.py` lines 1284–1302). SSE cursor/event history is **not durable across a gateway restart**. It is a reconnect aid, not ADAM's event ledger.

The idempotency store persists a fingerprint, run ID, status, owner PID/start fingerprint, timestamps, and retention—not request bodies or credentials (`gateway/platforms/api_server_run_idempotency.py`, class and schema near lines 54–115). Rows survive restart when the configured DB is durable; source explicitly falls back to `:memory:` if DB open fails, in which case replay does not survive restart. Terminal records are pruned after their retention deadline; default retention is 24 hours since last update (also extendable for a room grant). Nonterminal status is recovered as `interrupted` if its recorded owner process incarnation is gone (`api_server_runs.py` around `_durable_run_status`, lines 395–420). Without an idempotency key, run admission/status is process memory and should be treated as non-recoverable across restart. Even with it, the 24-hour run key is not a permanent job/intent store.

`POST /v1/runs/{id}/stop` returns `stopping` immediately and remains tracked until the executor-backed work exits, then becomes `cancelled`; cancellation request is not cancellation completion (API docs lines 554–559). Shutdown marks active durable runs `interrupted` before stopping the agent; late results must not overwrite the terminal interrupted status (docs lines 487–489; source `_mark_shutdown_interrupted_runs`). Use `GET status` as authoritative reconciliation after reconnect, then stop only by the saved exact `run_id`. Do not infer a run ended from stream closure.

### Session ownership and transcript writes

The run handler passes the selected `session_id` to the new agent and the loaded transcript into `run_conversation` (`api_server_runs.py` lines 701–735 and 810–831). `agent/turn_facade_lease.py::admit_durable_turn_lease` acquires a lease in the session DB before transcript reload/run/flush. The holder contains PID/process namespace/turn identity; a contending process waits, then reloads transcript only after lease admission (lines 304–370). `hermes_state_compression.py::acquire_session_turn_lease` is backed by a SQLite write transaction and lineage-root key; lease renew/release are holder-checked (roughly lines 601–722). The process-local `gateway/turn_lease.py` documents its own narrower scope and explicitly says CLI-continuity processes are outside that registry (lines 1–10, 74–80).

This means no session database migration appears necessary simply to continue a known v0.22 session via `/v1/runs`; the session ID and database are existing interfaces. But a correct ID/profile mapping and a single control owner are still required. A run against another profile, a copied session DB, a different Hermes home, or a separately-created session is not continuity with the Adam head. Session IDs must be stored explicitly; titles, `latest`, current working directory, and UI labels are not stable identity. The CLI resolver (`hermes_cli/main.py::_resolve_chat_session_args`, lines 1531–1570) maps `latest` and `--continue` using workspace/MRU logic, resolves title or ID, follows compression continuations, and may restore the recorded cwd. That convenience path is not an API identity contract and must not be used by an adapter to guess the head session.

### Structured tools and observation

Hermes' MCP client registers configured server tools into the normal tool registry and supports configured stdio and HTTP servers. The MCP guide documents server-name-prefixed tool names, tool filtering and config-driven reload; a session's tool set is generally fixed until reload/new session/context compaction (lines 568–584, 745–787). This gives the smallest supported way for Hermes reasoning to call Dobius structured capabilities: a narrowly scoped Dobius MCP server with typed operations and bounded schemas/results, configured as a Hermes MCP client. The Dobius side must enforce authorization at every operation; Hermes tool visibility is not authority. Do not expose an unrestricted shell or raw generic runtime RPC through this adapter. For remote operation, the transport needs independently verified service authentication and revocation, not merely a reachable URL.

Hermes Observer Hooks are read-only telemetry; callbacks are fail-open and do not replace planner, tool registry, approval, or execution semantics (observer docs lines 8–68, 225–227). They are useful for optional trace enrichment only. Use the authenticated runs API/SSE for run progress, and Dobius's own durable execution/event journal and ADAM's durable intent/outbox for recovery. Do not scrape a PTY, parse terminal output as a protocol, or treat an observer callback as a commit acknowledgment.

## Smallest no-duplicate-owner composition

1. **One head:** ROOT verifies and retains the already-designated Hermes Adam runtime/profile. Do not launch another gateway or head. Keep ADAM OS as the independent durable control plane and Dobius as the execution/UI layer.
2. **Session identity:** ADAM stores `hermesProfileId` (opaque configured profile selector) and the verified `hermesSessionId` for the one Adam conversation. ROOT must verify these through safe supported status/session metadata without reading transcript content or credentials. Never derive either from title/latest/cwd. If the current UI process cannot be reached through the API listener, expose that as a separate-process invocation against the same session, and do not describe it as process attachment.
3. **One turn submission:** ADAM's serialized planner/inbox creates immutable `adamIntentId` + payload digest and posts exactly one request to authenticated `POST /v1/runs`, setting `session_id=hermesSessionId` and `Idempotency-Key=adam:<intentId>:<attempt>`. Persist the returned `hermesRunId` before downstream actions. Retry only the exact same body/key; treat key conflict as a hard integrity error. This prevents duplicate run admission inside Hermes' retention window, not duplicate Dobius execution unless Dobius/ADAM intent IDs are independently deduplicated.
4. **Structured Dobius capabilities:** Hermes invokes only explicitly approved Dobius MCP tools, e.g. `get_snapshot`, `submit_approved_intent`, `get_execution`, `request_cancel`. Dobius returns stable `executionId`, `attemptId`, `intentId`, status and bounded result references. ADAM remains the authority that approves/records durable jobs; a model-selected tool call does not bypass Dobius admission or the user's existing approval policy.
5. **Progress/recovery:** ADAM persists `{adamIntentId, payloadDigest, hermesProfileId, hermesSessionId, hermesRunId, lastEventSeq, dobiusExecutionId, lastDurableEventId}`. Consume SSE by sequence and dedupe. On disconnect/restart, first GET the exact `hermesRunId`; reconnect with `Last-Event-ID` only as a best-effort buffer replay, detect `replay.truncated`, then reconcile from run status plus durable ADAM/Dobius journals. Never resubmit under a new key because SSE is absent. If the Hermes idempotency record has expired, do not blind-retry; require durable ADAM intent-to-run mapping or explicit operator reconciliation.
6. **Cancellation:** persist cancel intent in ADAM, call stop on the exact run ID, retain `stopping` until run status is terminal and separately reconcile Dobius executor cancellation. Stop acknowledgment is not execution completion.

### ID map

| ID | Owner | Purpose |
|---|---|---|
| `adamConversationId` | ADAM | Stable logical head conversation; maps to one explicit Hermes profile + `hermesSessionId`. |
| `adamIntentId` / `payloadDigest` | ADAM | Durable decision/action identity and immutable request identity; deterministic idempotency key input. |
| `hermesSessionId` | Hermes session store, referenced by ADAM | Transcript identity; persists across turns and compression lineage. |
| `hermesRunId` | Hermes Runs API, referenced by ADAM | One accepted reasoning turn; used for exact GET/events/stop. |
| `hermesEventSeq` | Hermes stream | Ephemeral per-run SSE replay cursor, not a durable cross-restart event ID. |
| `dobiusExecutionId` / `attemptId` | Dobius executor | Execution/attempt identity returned by structured MCP result. |
| `dobiusEventId` | Dobius journal | Durable execution event identity and replay/deduplication cursor. |

## What remains unproven

- Whether the existing Adam is currently a CLI/TUI, API-server-backed session, or another Hermes surface; its exact process/profile/session ID and whether an API listener is already attached to the intended runtime. No active head/session or runtime was inspected.
- Whether API and interactive turns share the intended session DB/profile in the currently installed runtime, and that the installed v0.22.0 files match the inspected release source.
- Whether a single ADAM planner/inbox lock currently serializes all reasoning requests, and whether any other process/profile can create a competing Adam head.
- Whether the actual API credential is narrowly held by ADAM and the listener transport is restricted/authenticated appropriately; source docs say the API key grants the full Hermes toolset, including terminal access.
- Dobius MCP server implementation, exact authorization and approval contract, tool filtering, local/remote peer authentication, revocation, and production event/result linkage are not part of this review.
- End-to-end tests still needed: one already-known session receives an API run and transcript continuity; overlapping CLI/API turns serialize and reload the committed transcript; gateway restart during run yields interrupted and exact idempotent replay; conflict/replay after key rotation/auth profile change is handled; SSE lost events/truncation recovers from durable journals; cancel waits for executor exit; MCP authorization/revocation rejects stale identities; no second Hermes runtime is started; one ADAM intent maps to exactly one Hermes run admission and one deduplicated Dobius execution intent.

## Evidence and limits

This is a source-contract review only. It does not prove that the current Adam session is attached to the API, that ADAM currently calls the API, that a Dobius MCP server is installed or enabled, or that a real tool invocation or event recovery has occurred. No profiles, session messages, credential stores, active services, provider accounts, or keychain data were read or changed; no tests/builds/services were run.

## Reviewed files and SHA-256

| File | SHA-256 |
|---|---|
| `plans/worker-monitor-20261014/ROOT-adam-dobius-hermes-bridge-research.md` | `531fb97079cfba1dd4aa67fb43f68132756d5f6b0477fcedbfa25d24317d100e` |
| `plans/worker-monitor-20261014/BUILD1-adam-bridge-research-independent-review.md` | `2c2a9db2a849a911224a90643ff208f30ef519b344d34a6c5a14828dfbca7db4` |
| Hermes `website/docs/user-guide/features/api-server.md` | `0fd3754a5bb066b4d4f3dc64d2c9f9f0989630fa5928330bf43e8803eed1abe4` |
| Hermes `website/docs/developer-guide/gateway-internals.md` | `e550d1efd4373b61c354a1d716ca849646c4e8c067c5df6d158ce5e3d8ad065a` |
| Hermes `website/docs/user-guide/features/mcp.md` | `c93621cf592314b5e84c5134ab2016d5f5e28a0f0dd98cc7319a8d9abdf6dde1` |
| Hermes `website/docs/developer-guide/observer-hooks.md` | `53a416e4e299f1465b7ed982be09935f3b658b946fb37b4afe60ba748e34d72b` |
| Hermes `gateway/platforms/api_server_runs.py` | `8a7fcfd56183c32a14b41c7c43ce36b21b37bf49f2ed035dafe48899c0e8cbe7` |
| Hermes `gateway/platforms/api_server_run_idempotency.py` | `56f7762addc5e610569fd613729f1f0b3d5e99e4b76f56d9cfa509dfeb51636c` |
| Hermes `gateway/platforms/api_server.py` | `6a7e6fb0a0d5ea25ddc47d36a64e2c0bc50ded331d49e1c4521d801ca7189043` |
| Hermes `agent/turn_facade_lease.py` | `2e898cc9a529107ec3ce3d30be56eb5e0ad1a0d7fb3869c4208d38341cb2a9fa` |
| Hermes `hermes_state_compression.py` | `99e2379018188b2d1823bfa66ef7c5235fd807bf86a86fa4a03ba36d753bd71d` |
| Hermes `gateway/turn_lease.py` | `5600965be037e2d440d547c2967e2d3ae74d0e30fc77d50e7f37250c8acae661` |
| Hermes `hermes_cli/main.py` | `88a7fc166d3bfaac082d44bbfc36c93b53c50f7508ca96e32206dc3f1edfaa82` |
