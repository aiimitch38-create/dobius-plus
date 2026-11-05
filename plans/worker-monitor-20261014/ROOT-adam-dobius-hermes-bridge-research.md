# Research decision: hidden ADAM agent control and Dobius execution

Date: 2026-10-14. Research only; no new bridge implementation or runtime provisioning.

## Decision

Best fit from the inspected source is a thin background integration around the existing Hermes runtime, ADAM service, and Dobius CLI/RPC/event journals. Hermes Adam is the reasoning head. ADAM OS is the hidden agent operating runtime: persistent intent, context, policy, coordination and recovery surrounding that reasoning. Dobius is the visible application and executor. The LLM powers Adam's decisions; model/provider replacement, including future Vertex, must preserve identity, state and tool contracts. This is a source-based recommendation, not a claim of benchmarked or live acceptance.

Keep one designated Adam decision session/owner, with Friday as the existing research/planning helper. Do not launch a competing gateway or second head process against the current interactive profile merely to gain an API. The ownership/attachment migration must be verified separately. No profile, credential, account or current head session was read or changed by this research.

## What already exists

- Dobius src/main/jarvis/adam-client.ts provides typed /v1/converse interaction; ADAM service/src/runtime/service.ts implements conversation and orchestration routes. This is a partial source integration, not proof all routes are currently live or that the new cloud-job bridge is enabled.
- ADAM service/src/adapters/dobius.ts invokes structured Dobius CLI calls, and service/src/orchestration/supervisor.ts persists jobs/contracts, drives steps, observes outcomes and verifies completion. Preserve this implementation instead of adding a competing scheduler. Its existing bundle guard is macOS-specific; remote/Linux execution requires a reviewed adapter change.
- Dobius src/main/agents/agent-run-events.ts appends an event journal before broadcasting; agent-run-event-delivery.ts retains a delivery cursor, retries offline delivery and relies on ADAM event-ID deduplication. ADAM service/src/events/ingest.ts stores unique incoming events and queues Obsidian projection. Reuse this durable delivery path. Current run events originate from the Claude SDK path; complete native Codex/Hermes and system/worker coverage cannot be assumed.
- Dobius runtime.clientEvents.subscribe, terminal streaming, file watch, device registry and runtime RPC supply observable state/actions. Live subscriptions alone are not durable replay or service-role authorization.
- Hermes installed v0.22.0 source and official API Server docs support authenticated run/session APIs, progress events, continuity and cancellation. Its MCP guide supports external tool adapters without modifying core. Observer hooks supply correlated lifecycle telemetry; callbacks are fail-open and must not be the authority for reliable job mutation or successful completion.
- ADAM service/src/models/router.ts currently routes through OmniRoute. Treat this as an existing model-routing facility, not a second independent planning head. No active provider/configuration was inspected or changed.

## Options compared

| Option | Fit to current system | Main tradeoff | Decision |
| --- | --- | --- | --- |
| Hermes directly drives everything through terminal/UI prompts | Reuses today's tools with little setup | Conversation/PTY state cannot replace durable job ownership, reconnect recovery and application-wide observability | Keep for interactive operations and fallback, not the sole control backbone |
| Existing Hermes + ADAM + Dobius with a thin typed background bridge | Reuses supported agent interfaces, current jobs, existing journals and app tools | Still needs service enrollment/authorization, complete event coverage, profile ownership and end-to-end composition | Recommended |
| Replace the core or add a new large agent/event infrastructure | Can supply richer distributed facilities | Duplicates current state/scheduling and adds migration/operational load without evidence it is necessary for the laptop/VPS topology | Not justified by current source findings |

## How continuous flow should work

1. Observe: structured, bounded app snapshots and event deltas report jobs, worker state, terminals, projects, file/artifact metadata and storage health to ADAM. The bridge maintains freshness/cursors independently of model inference.
2. Reason: meaningful changes enter one serialized Adam inbox. Hermes reads the current snapshot and relevant history, uses its configured LLM, and produces an action or plan. Routine heartbeats do not need to invoke an LLM. Raw logs/files are retrieved on demand, not all copied into every prompt.
3. Act: typed tools submit an approved job or invoke an authorized application action through existing Dobius RPC/CLI, with actor, project/resource, stable intent, expected runtime/state and cancellation identity. MCP is a possible tool adapter, not the durable job/event database. Avoid PTY prompt scraping as the primary machine protocol.
4. Record: ADAM stores the control intent; Dobius records execution and committed results. Keep explicit linkage across ADAM job ID, execution job ID, run/attempt and event ID. Commit plus durable outbox, acknowledgment, deduplication and replay govern delivery; do not promise distributed exactly-once execution.
5. Reconcile: disconnect/restart resumes from a durable cursor or verified snapshot. Ambiguous submit checks the original exact job/child before any retry. Cancellation is not completion until executor acknowledgment. The same reconciled lifecycle feeds Kanban and the phone/desktop view.

One source means one coherent control/job/catalog view, not a single shared writable SQLite file across computers. Canonical control intent belongs to ADAM; execution facts belong to the executor and are reconciled into that view. Large artifacts remain at their storage location with references/digests; credentials never become general event payloads. Local device crypto primitives do not resolve central/remote ADAM key custody.

## Authentication and full application access

The existing general runtime token, paired-device scope and constant planner principal do not yet prove an ADAM service role. Before enabling control, establish explicit operator-enrolled service identity, revocable credentials, project/method permissions and authorization-generation checks. Existing device registry/E2EE mechanisms are candidates for reuse, not automatic proof that current mobile/runtime scopes authorize an ADAM controller. Compare an extension of existing enrollment with a dedicated authenticated service transport; do not mandate XPC, a new PKI or service launch hierarchy without showing why existing mechanisms cannot satisfy the threat/ownership model.

Full hands means the application actions Carson authorizes: read app state, operate relevant tabs/terminals/projects, dispatch/stop workers, manage jobs and inspect results. It does not mean an LLM-supplied principal bypasses admission or that every service automatically shares credentials. State changes remain bound to the appropriate tab/job/resource, preserving other open tabs and user activity.

## Placement

The architecture can first be composed locally as hidden independently managed processes, using current accounts without migrating them. The desired always-on control placement is the VPS, with Dobius executors on VPS and laptop; laptop-only capabilities such as local macOS builds remain there. A VPS move depends on actual memory, account/runtime readiness and authenticated remote transport checks. No placement change, resource purchase or credential migration is authorized/performed by this report. AWS remains deferred and historical Storage remains paused.

## Evidence required before calling it live

Demonstrate one real authorized request -> Adam decision -> durable ADAM intent -> Dobius execution -> verified result -> same Kanban job. Then disconnect during execution, restart the bridge and prove missed events catch up without a second job; revoke the controller and prove the next action is rejected; stop a running job and report the acknowledged state; attach the UI to the same Adam session without concurrent duplicate authority. Verify event coverage on both executors and preserve independent user tabs. These are implementation acceptance requirements, not tests run by this source research.

## Primary sources

- https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server — supported agent run/session/control and progress interfaces; installed source also inspected.
- https://hermes-agent.nousresearch.com/docs/guides/use-mcp-with-hermes — Hermes integration via tool adapters without replacing agent core.
- https://hermes-agent.nousresearch.com/docs/developer-guide/observer-hooks — telemetry correlation and fail-open observer boundary.
- https://hermes-agent.nousresearch.com/docs/developer-guide/gateway-internals — long-lived runtime, session routing and active-session guards.
- https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html — transaction/outbox/retry/idempotent-consumer pattern only; no AWS setup is recommended or performed here.

Independent review of the earlier reviewer-authored caller contract is still required. This decision does not accept that document's platform-specific proposals by default. New bridge source implementation waits until this recommendation has been presented to Carson; existing approved work and source reviews continue.
