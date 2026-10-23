# Independent review: ADAM–Hermes–Dobius bridge research

Date: 2026-10-14  
Reviewer: BUILD1  
Task/dispatch: `task_e878760f70d5` / `ctx_573a19bf24c3`  
Verdict: **PASS_RESEARCH_RECOMMENDATION**

## Reviewed packet

Canonical repository `/Users/bayou/Projects (Code)/Dobius/dobius-plus`, branch `fix/channel-cost`.

| Artifact/source | SHA-256 |
|---|---|
| `plans/worker-monitor-20261014/ROOT-adam-dobius-hermes-bridge-research.md` | `531fb97079cfba1dd4aa67fb43f68132756d5f6b0477fcedbfa25d24317d100e` |
| `plans/worker-monitor-20261014/ROOT-adam-dobius-hermes-bridge-research.json` | `2aca6e13b8231b4883c3bd697707d2a0429614bb3da52b27b3f61c3050958a5d` |
| `plans/worker-monitor-20261014/BUILD2-adam-caller-authorization-source-contract.md` | `42ba0a3a0498ec09e1abe731fce15ac71ac5e6460c7026897178c36f9e7a28e8` |
| `plans/cloud-workstation-reports-20261012/research.json#adam-main-sealer-caller-authorization-independent-review-20261014` | Entry records the same contract hash and author disclosure; current JSON file was read, not edited |
| `plans/worker-monitor-20261014/ROOT-adam-control-dobius-execution-boundary.md` | `29d7f88824cde7e658bcb050cebb75de30d08939dd3392286b72232d71e2781b` |
| `plans/cloud-workstation-reports-20261012/root-local-delivery.json` | `1aef6f8e52471d32844e92b212886ed71221d24c03a3d8d7bb3586f4a15f4b2e` |
| `dobius/src/main/adam-connection.ts` | `47af9d1a1bd3c46056688b18703942de3c189f2b80718eb069d44896a8c1b0af` |
| `dobius/src/main/jarvis/adam-client.ts` | Not hash-pinned in this review; inspected for outbound `/v1/converse` behavior |
| `dobius/src/main/agents/agent-run-events.ts` | `a4b78e8dda7101eed640c16f0fdd93e8baf403c509def2784c502a5412c4420d` |
| `dobius/src/main/agents/agent-run-event-journal.ts` | `5c52b1ad136ea4375b8d9021c8c51457bf3e3abb26d39a59b8b931e3e89ccc40` |
| `dobius/src/main/agents/agent-run-event-delivery.ts` | `f074fd97bbc9c69f1aa12ee48c17c1310747773594a6e685fc174b4fdb19fbb7` |
| `dobius/src/main/agents/adam-event-ingest.ts` | `79a252bcbcad0e2da0d8dd152386e0cf3cc8516be4d995bf11d7876d259d81ff` |
| `dobius/src/main/runtime/rpc/methods/client-events.ts` | `6e7f47d968629a874e620700df1524b91679a55ee24cafb49cbbde0a81396274` |
| `dobius/src/main/runtime/rpc/unix-socket-transport.ts` | `f7d9a1fcb4a45822dae63763071d4c6dc95a063aaddfa07f2b50741479eb3da1` |
| `dobius/src/main/runtime/rpc/core.ts` | `09573d96d4b989aa2702ce3c47d742b7e9b08eb643484e2665cf8c960f3ea51d` |
| `dobius/src/main/runtime/rpc/methods/adam-cloud-child.ts` | `c240dc87f192adf5ac4bfb114c86c3d5de82e5db65cf11c33b12c3d33866edbc` |
| `dobius/src/main/runtime/runtime-rpc.ts` | `c524709d25b8a7676b42882314f4683a313ecc6b7167d7ffd40e33cb050c3173` |
| `dobius/src/main/automations/cloud-jobs/cloud-job-adam-intent-unsealer.ts` | `b9e07897fedf00e0983215dc5e9d9aaaedc8167f41cc04f7dfca6c55dff50a11` |
| `/Users/bayou/dobius/projects/ADAM/service/src/main.ts` | `58159e34ecb3948a2ce809429b92a7da8a484d5683f27eae2bd556ce8bcad066` |
| `/Users/bayou/dobius/projects/ADAM/service/src/runtime/service.ts` | `251b62dd624918e43c27cdaa37ca02a7e3d21c72162fe92ff681196826504862` |
| `/Users/bayou/dobius/projects/ADAM/service/src/adapters/dobius.ts` | `6b5167cad2534c50a68490d07aaef272850a4f1087340b9af74f2c97a87a079b` |
| `/Users/bayou/dobius/projects/ADAM/service/src/orchestration/supervisor.ts` | `7fdf98cc1be184f3fd2701f0281524f1397866e491a4c8cb6fed6be61a2ff0cf` |
| `/Users/bayou/dobius/projects/ADAM/service/src/events/ingest.ts` | `46f01b58ae4ee0cbd9a4d8c3e40890ae11c270498d2c0f72fd4cc671c1df3207` |
| `/Users/bayou/dobius/projects/ADAM/service/src/dobius-cloud/intent-contract.ts` | `60d148b77864bb83025e1d8cfeb6f0b3883d3d995759df306fbce165880a7ecd` |
| `/Users/bayou/dobius/projects/ADAM/service/src/dobius-cloud/intent-publication.ts` | `9cb9e986979a61a9ad7eba5fb9c9a46cbe63a849e5ad39e8264270fea1d12ba8` |
| `/Users/bayou/dobius/projects/ADAM/service/src/dobius-cloud/receipt-store.ts` | `04d066e92024af51ed4e19cc58954f61bfc5c975d29fdcb0dc079c48b0dbc9c3` |
| Hermes v0.22.0 `api-server.md` | `0fd3754a5bb066b4d4f3dc64d2c9f9f0989630fa5928330bf43e8803eed1abe4` |
| Hermes v0.22.0 `use-mcp-with-hermes.md` | `afc46dfb6503079e41e0e6436a543428fe633422c5073fe4d0eb57fe101e4fbe` |
| Hermes v0.22.0 `observer-hooks.md` | `53a416e4e299f1465b7ed982be09935f3b658b946fb37b4afe60ba748e34d72b` |
| Hermes v0.22.0 `gateway-internals.md` | `e550d1efd4373b61c354a1d716ca849646c4e8c067c5df6d158ce5e3d8ad065a` |

The root research receipt identifies the corrected caller contract as independently reviewable, and its own receipt explicitly records that RESEARCH authored that correction. This review therefore independently checked its authority and transport claims against source rather than treating the prior reviewer receipt as approval.

## Findings

The recommendation to retain Hermes as the reasoning head, ADAM as durable control/orchestration, and Dobius as application executor, connected by a narrow typed background integration, fits the inspected system better than either terminal-chat-only control or replacing the core with a new scheduler/event platform.

This recommendation correctly acknowledges existing partial integrations rather than claiming there is no integration. Dobius has an outbound `/v1/converse` client and an outbound ADAM event-ingest path. Agent-run events are appended to a local journal before broadcast; the delivery worker persists a cursor, retries with bounded backoff, and resends a bounded batch for ADAM event-ID deduplication. `runtime.clientEvents.subscribe` is a live stream and cleans up on disconnect, not a durable replay protocol. ADAM independently constructs its service and a durable orchestration supervisor/job store; its Dobius adapter performs structured CLI operations. ADAM's HTTP service has conversation, event-ingest, consume, and receipt routes. `issueGrantWithIntent` is implemented as seal-then-transaction publication, but inspected source search found the implementation definitions rather than a production planner caller. These pieces are reusable foundations, not evidence that the authenticated continuous cloud-job path is wired or live.

The event-coverage limitation is accurate and material: Dobius `agent-run-events.ts` reduces `@anthropic-ai/claude-agent-sdk` messages and journals those run events. That does not establish equivalent native Hermes, Codex, worker-supervisor, or system events. Use each runtime's supported event source/adaptor and preserve source event IDs; do not treat observer telemetry or a live client subscription as the durable authority for completion. Hermes v0.22.0's Observer Hooks documentation calls these read-only telemetry, says hooks are fail-open, and says they must not replace planner/execution semantics. The MCP guide describes MCP as an adapter where Hermes remains the agent and recommends a narrowly filtered surface. Both support a thin Hermes tool adapter, not a replacement agent core or a second job database.

The corrected caller contract's key security distinction is sound. Dobius generic local RPC proves runtime-token possession and marks a private Unix socket; it does not authenticate an ADAM service process. The `adam.submitCloudChild` method additionally passes the literal `adam-parent-planner`, which is a label, not identity. The current unsealer compares caller-supplied expected intent identity and decrypts internally, but does not authenticate its caller. Paired mobile/runtime identity and current generic local bearer therefore cannot authorize service unseal by themselves. Require a main-owned, revocable ADAM service principal bound to the exact instance and authorization generation before any seal/unseal/submit/recovery operation. Do not expose ciphertext grant plaintext, unseal, or unrestricted RPC to a same-user caller.

Hermes v0.22.0's pinned local API documentation supports durable run submission with a caller idempotency key, run status/events, session IDs and stop control. It says a stop request remains `stopping` until executor-backed work exits, so a bridge must preserve that distinction. Its API also has session turn leases. Use those supported interfaces rather than scraping terminal text. Keep the existing designated Adam head/session as the sole decision owner: an external API-created run must not become a second head or create concurrent authority. Before implementation, prove whether the selected API can safely attach to the exact existing session; an exposed `session_id` or a different session with the same label is not sufficient evidence of shared ownership. If safe attachment cannot be proven, route the job to one explicitly owned service session and keep the interactive head as a distinct presentation/approval surface without parallel decision ownership.

For linked Kanban/job state, ADAM should retain control intent/parent state, while Dobius remains authoritative for executor job/attempt/result. A stable tuple must connect ADAM job/intent, immutable payload digest, Hermes run/session/turn where applicable, Dobius execution job/attempt, and event IDs. Commit/outbox + durable acknowledgment + dedupe/replay are appropriate; do not promise distributed exactly-once. A canceled or stopped request is not a completed cancellation until the executor reports terminal exit. Ambiguous submit recovery must look up the exact bound child before retrying. These requirements align with current ADAM durable jobs and Dobius bound-admission/replay sources.

### Actionable qualification before bridge code

The caller contract's local identity examples are justified as alternatives, not mandatory architecture: XPC with peer audit/code-signing checks on macOS, Linux peer credentials plus a dedicated service identity, and Windows named-pipe verification bound to an enrolled service SID each address the missing *service process* identity. The contract also correctly tells implementers to compare an extension of existing enrollment and not to mandate new XPC, PKI, or service hierarchy without evidence. Keep that qualification explicit in implementation plans and fail closed on unsupported platforms.

The remote section currently says to require mTLS. This is a defensible default for a remote deployment, because the existing Dobius-to-ADAM bearer direction and URL/tailnet allowlisting do not authenticate ADAM back to Dobius. Before treating mTLS as the only possible transport, allow an already-enrolled remote mechanism only if a verifier can bind a cryptographically authenticated peer to the enrolled ADAM service instance, audience, current authorization generation, and revocation state. A tailnet URL or device membership alone is not enough; no such proof was inspected. If that equivalence is not implemented and tested, retain mTLS and keep the bridge unavailable. No production infrastructure change is warranted by this review.

## Smallest implementable next slice

1. Define a main-owned service-principal registry/provider and authenticated transport identity result, scoped to one enrolled ADAM service/instance and explicit method/project permissions. Prefer extending an existing enrollment primitive only if it can establish remote/local service identity, revocation, and a monotonic generation; otherwise implement a dedicated OS-authenticated local provider. Keep generic runtime RPC and the hardcoded planner label out of the authority path.
2. Add one narrowly typed operation at a time behind this principal: first authenticate and bind a fixture ADAM instance; then seal/issue through ADAM's existing durable intent transaction; then submit/recover the exact child using current Dobius admission. Keep capability bytes within the authenticated and sealed path, not argv/log/plaintext events.
3. Test request replay/conflict, one-owner session behavior, wrong/stale/revoked principal, generation change during awaits, full intent/identity binding, duplicate submit recovery, canceled-but-still-running state, durable event restart/cursor replay, and event coverage separately for Hermes, Claude/Codex, worker and system producers. Only claim each runtime's coverage after its producer is actually wired.

## Limits and remaining live proof

No provider/profile/credential configuration, private account data, service process, keychain, production database, endpoint, or head session was read or changed. No Hermes gateway started, no bridge code or tests were written, and no execution/live acceptance was performed. `root-local-delivery.json#desktop_build20_delivery` records `live_dispatch_ready=false` and `adam_bridge_enabled=false`; this remains source research only.

Before enablement, still prove the supported service identity on each deployment platform; exact Hermes session ownership/attachment; real planner and recovery caller; event coverage and replay across restart for all participating executors; submit/cancel/revoke races with exact ADAM and Dobius receipts; and one end-to-end authorized request through the same Kanban job. Source receipts, injected test identities, current docs, and API availability do not prove installed runtime wiring or live readiness.

## References

- Hermes v0.22.0 API Server docs (pinned local source hash above) and [current official API Server documentation](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server).
- Hermes v0.22.0 [MCP guide](https://hermes-agent.nousresearch.com/docs/guides/use-mcp-with-hermes), [Observer Hooks](https://hermes-agent.nousresearch.com/docs/developer-guide/observer-hooks), and [Gateway Internals](https://hermes-agent.nousresearch.com/docs/developer-guide/gateway-internals).
- [Apple XPC code-signing requirements](https://developer.apple.com/documentation/foundation/nsxpcconnection/setcodesigningrequirement(_:)) and [Linux UNIX socket peer credentials](https://www.man7.org/linux/man-pages/man7/unix.7.html). Platform documentation supports available mechanisms; it does not prove Dobius has configured them.
- Microsoft [named-pipe client impersonation](https://learn.microsoft.com/en-us/windows/win32/ipc/impersonating-a-named-pipe-client) and [service SID](https://learn.microsoft.com/en-us/windows/win32/services/service-sid) references were considered as platform mechanism examples, not as evidence of current Windows transport wiring.
