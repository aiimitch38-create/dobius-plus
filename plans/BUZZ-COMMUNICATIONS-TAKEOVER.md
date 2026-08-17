# Buzz → Dobius Communications: plan of record

Status: active  
Branch: `feat/buzz-skin`  
Source snapshots: Dobius workspace plus `~/Projects (Code)/buzz` at upstream `10d5a2641`

## Product contract

Buzz becomes Dobius's native Communications surface. It is not a website,
independent agent manager, or decorative chat mock. Dobius remains the source
of truth for accounts, agents, terminals, repositories, worktrees, permissions,
skills, and execution. The forked Buzz subsystem owns durable rooms, messages,
threads, reactions, presence, search, workflows, media, and audit history.

The final invariant is bidirectional:

> Everything executing in Dobius appears in Communications, and every action
> taken in Communications controls the same Dobius runtime.

## Completion and audit loop

No subsystem is complete because its files exist or its happy-path unit test
passes. Every delivery slice repeats this loop until all checks are green:

1. Inventory upstream Buzz behavior and every Dobius authority it touches.
2. Trace the real user action across renderer, bridge, main/daemon, relay, and
   storage; identify mocks, implicit defaults, and alternate failure paths.
3. Implement the smallest end-to-end production path without demo fallbacks.
4. Run focused contracts, both repository typecheckers, lint, and the relevant
   regression suites.
5. Build and launch Dobius; execute the actual UI path against live services
   and inspect visible state, logs, persistence, and side effects.
6. Audit the result again for security boundary expansion, stale parallel
   state, restart behavior, and UX gaps; fix findings and repeat from step 4.

Evidence (test output, live probes, and named remaining gaps) is recorded for
each gate. An unverified assumption is a pending item, never a completion.

## Evidence and current baseline

- The complete Buzz desktop renderer is already vendored under
  `dobius/vendor/buzz-desktop`; only three source files differ from the clone.
- The renderer contains 28 feature domains, 1,552 files, and roughly 240,000
  lines. It uses TanStack Router/Query and calls native services through one
  principal seam, `shared/api/tauri.ts`.
- The current vendored renderer invokes 206 distinct production native commands
  after excluding tests and fixture-only calls. The Dobius bridge explicitly
  handles 34; 172 currently require implementation or caller removal. Buzz's
  `testing/e2eBridge.ts` implements 213 test fixtures and is useful as a
  behavior oracle, not production infrastructure. The two counts describe
  different surfaces and must not be treated as coverage.
- The real relay protocol is working in the embedded renderer: NIP-42 auth,
  WebSocket subscriptions, HTTP queries, signed events, membership, and stored
  history have been observed against the local relay.
- Dobius already exposes the real workstation through a typed RPC dispatcher:
  accounts, custom agents, agent runs, terminals, worktrees, repositories,
  files, git providers, orchestration, speech, notifications, skills, browser,
  and UI control.
- Dobius already owns managed Claude and Codex OAuth accounts and isolates
  their runtime credentials. Communications must reference account IDs only;
  secrets never enter the Buzz renderer.

### Verified takeover slice (2026-08-02)

- The isolated renderer bridge is live in the Electron webview and rejects
  malformed, untrusted, and non-allowlisted RPC requests (18 focused tests).
- Agents, repositories, worktrees, and terminals render from the active Dobius
  runtime; a live probe observed 3 repositories, 3 worktrees, and 1 terminal.
- Buzz persona create/update/delete now translates to Dobius `agent.*` CRUD.
  The real Create Agent dialog created a persisted Dobius custom agent, the UI
  immediately projected it, and the acceptance agent was deleted afterward.
- The embedded runtime catalog exposes Dobius—not Block harness fixtures—as
  the available execution runtime.
- A hung OAuth refresh can no longer freeze the page: workstation reads are
  independently bounded and the UI reports the degraded `accounts` source.
- Embedded production mode now fails closed on every unported native command;
  the upstream E2E bridge cannot silently supply fixture behavior.

Open findings from the same loop: OAuth account refresh currently times out;
the participant signing identity is not yet Keychain-backed; message-to-agent
dispatch, managed lifecycle controls, teams, notifications, files, workflows,
voice, and supervised relay startup remain pending and must not be described as
complete.

### Full-suite audit (2026-08-02)

- Vendored Buzz baseline: 3,878 tests executed; 3,873 passed and 5 failed.
  Four failures exposed a browser-only timer accidentally added to a headless
  onboarding helper. The fifth exposed an omitted upstream Virtua patch file.
- Both defects were repaired without changing the Dobius shell: the helper now
  uses environment-neutral timers and `vendor/patches/virtua@0.49.3.patch` is
  carried with the vendored source. The complete rerun is green: 3,880 tests
  passed, zero failed, and the vendored TypeScript check passes.
- The complete Dobius suite was run under the repository-required Node 24:
  24,384 tests passed, 325 failed, and 30 were skipped across 2,400 files.
  Failures are broad across the already-dirty baseline (CLI guidance, updater,
  PTY/SSH timing, sidebar rendering, and an Electron mock import), rather than
  concentrated in Communications. Communications-focused contracts and both
  repository typechecks are green; representative root failures still require
  isolated baseline classification.

## Target process architecture

```text
Dobius renderer
├── Existing workstation UI
└── Communications host
    └── isolated first-party Buzz renderer
        └── typed CommunicationsPlatform client
             │
Electron main/daemon
├── Communications gateway (authorization + schema validation)
├── Dobius runtime RPC (system of record)
│   ├── OAuth/account services
│   ├── agent factory and run lifecycle
│   ├── PTY/terminal sessions
│   ├── repositories/worktrees/git
│   ├── files/artifacts/notifications
│   └── speech and voice conductor
└── Communications service supervisor
    ├── forked Buzz relay
    ├── PostgreSQL
    ├── Redis
    └── S3-compatible media storage
```

The renderer remains isolated to preserve Buzz's complete CSS, router, query
cache, keyboard handling, and UX. It is a shipped first-party renderer, not a
remote webpage. A dedicated, least-privilege preload exposes only the typed
Communications bridge. Arbitrary browser webviews retain the existing no-preload
hardening.

## Source ownership map

### Keep substantially intact

| Buzz domain | Ownership after takeover | Acceptance requirement |
| --- | --- | --- |
| Home/inbox | Communications | Real activity, mentions, needs-action, pagination |
| Channels | Communications | Create, join, archive, membership, unread state |
| Messages | Communications | Send, edit, delete, reply, thread, typing, drafts |
| DMs | Communications | Durable human↔agent and agent↔agent conversations |
| Search | Communications | Message, channel, participant, and artifact results |
| Reactions | Communications | Real-time reactions plus approval actions |
| Presence | Coordinator | Derived from Dobius runtime health and agent turns |
| Agent pages | Dobius-backed Communications UX | Create/edit/start/stop agents through Dobius |
| Projects | Dobius-backed Communications UX | Dobius repositories/worktrees and diffs |
| Workflows | Communications + Dobius orchestration | Triggers dispatch real gated Dobius work |
| Media | Communications | Upload/download/preview through supervised storage |
| Notifications | Dobius | Native notification, badge, focus, deep-link behavior |
| Huddles | Dobius speech + Communications transcript | Press, speak, transcribe, route, hear reply |
| Settings | Split ownership | Communications preferences plus linked Dobius settings |

### Adapt behind the platform boundary

| Buzz native responsibility | Dobius implementation |
| --- | --- |
| identity/keyring/signing | Dobius Keychain-backed Communications identity service |
| relay discovery/connectivity | Communications service supervisor and health API |
| managed-agent CRUD | Dobius custom-agent store and agent factory |
| runtime discovery/models | Dobius provider/account/runtime catalogs |
| agent launch/stop/restart | Dobius daemon, agent runs, terminals, and worktrees |
| project repository actions | Dobius repo/worktree/git RPC methods |
| filesystem dialogs/downloads | Dobius file APIs and Electron dialogs |
| notifications/badges/window attention | Dobius Electron main process |
| updater/relaunch/version | Dobius updater and app lifecycle |
| prevent sleep | Dobius main-process power-save blocker |
| clipboard/open external URLs | Existing constrained Dobius APIs |
| huddle audio | Dobius speech runtime and voice conductor |
| runtime observer frames | Structured Dobius agent lifecycle events |

### Retain temporarily, then simplify only behind stable interfaces

- `buzz-relay`, `buzz-core`, `buzz-db`, `buzz-auth`, `buzz-pubsub`,
  `buzz-search`, `buzz-media`, `buzz-workflow`, migrations, CLI, ACP adapter.
- Multi-tenant `community_id` remains initially because it is structural across
  storage and authorization. Dobius presents one local workspace even if the
  internal schema remains tenant-shaped.
- PostgreSQL, Redis, and S3 remain until measured replacement work proves
  equivalent behavior. They must be app-supervised and invisible to users.

### Remove or disable

- Block branding, external links, hosted-community/Builderlab onboarding,
  Block infrastructure presets, and Block release/update plumbing.
- Independent Buzz OAuth/account ownership.
- Independent agent-runtime authority that can spawn agents outside Dobius.
- Tauri window shell and its updater.
- Mobile clients, relay mesh/operator hosting UI, and remote multi-tenant
  provisioning unless later requested.
- Schema-only or unimplemented UI promises until implemented: webhook delivery
  history, workflow run-event kinds, unsupported approval actions, and other
  source-confirmed mirages.
- Static demo data and mock bridge behavior in production.

## Canonical entities and reconciliation

Dobius IDs are canonical. Communications records stable bindings rather than
creating parallel product identities.

```ts
type CommunicationsBinding = {
  participantId: string
  dobiusAgentId?: string
  dobiusTerminalId?: string
  dobiusWorktreeId?: string
  channelId?: string
  accountId?: string
  hostId: string
}
```

Lifecycle mapping:

| Dobius event | Communications projection |
| --- | --- |
| repository added | project space becomes available |
| worktree/task created | task room created or restored |
| terminal created | execution session attached to its room |
| agent created | participant identity/profile created |
| agent launched | participant joins room and becomes online |
| agent starts a turn | typing/working presence and structured activity |
| agent asks a question | needs-action message in the originating thread |
| tool/test/diff milestone | structured progress event, not terminal spam |
| agent completes | result card with diff/tests/artifacts and terminal link |
| runtime stops | participant becomes offline; queued messages remain durable |
| worktree archived/removed | room archived after reconciliation safeguards |

Boot reconciliation compares both sides and repairs missing bindings,
memberships, stale presence, restarted sessions, and queued messages. It must
be idempotent and must never duplicate an agent or room after a restart.

## Command-surface migration

Every one of the 206 production commands invoked by the current Buzz renderer receives
exactly one disposition in
a checked manifest:

1. `relay`: real relay-backed behavior retained.
2. `dobius-rpc`: translated to an existing typed Dobius runtime method.
3. `communications-service`: implemented by the coordinator/supervisor.
4. `native-electron`: implemented by constrained Electron main APIs.
5. `removed`: caller and route deliberately removed with replacement UX.

Builds fail when a command is unclassified. Production fails closed if a mock
handler is invoked. The existing 213-command test bridge supplies fixtures and
expected shapes only.

High-value mappings:

| Buzz command family | Destination |
| --- | --- |
| managed agents/personas/models/providers | `agent.*`, `accounts.*`, preflight, agent factory |
| project repositories/diffs/terminals | `repo.*`, `worktree.*`, `terminal.*`, `git.*` |
| ACP runtime control | Dobius daemon session/run control |
| media/files/download | `files.*`, clipboard APIs, media service |
| notifications/tray/window | native Dobius main-process services |
| huddle PCM/PTT | speech runtime + voice conductor |
| channels/messages/search/reactions | real Communications relay APIs |

## OAuth and credential rules

- Buzz renderer receives sanitized provider/account summaries only.
- Account selection passes stable Dobius account IDs.
- Agent launch asks Dobius to prepare the selected account's isolated runtime
  home/environment using existing Claude/Codex account services.
- Access/refresh tokens never cross into the Communications renderer, relay,
  message log, agent persona, or shell command line.
- Account deletion or reauthentication automatically changes agent readiness
  and produces actionable UX rather than silent failures.

## Agent creation transaction

The existing Buzz creation UX becomes a transaction owned by Dobius:

1. Validate name, persona, provider, account, repository, permissions, skills,
   and desired run location.
2. Reserve a Dobius agent ID and persistent Communications identity.
3. Create or select a worktree.
4. Create the agent definition and isolated runtime configuration.
5. Create room/member bindings and publish the profile.
6. Launch the terminal/agent through the Dobius daemon.
7. Wait for runtime readiness; publish presence only after positive proof.
8. Commit the transaction. On failure, compensate in reverse order and show a
   retryable error with no orphaned worktree, key, member, or process.

## Message-to-work execution path

```text
message/reply/@mention
→ signed durable Communications event
→ coordinator resolves participant + room binding
→ enqueue to exact Dobius agent/run/session
→ agent receives thread context and scoped workspace
→ structured lifecycle events update the room
→ agent posts answer/result through its Communications identity
```

Stop, cancel, resume, approve, reject, switch engine, open terminal, open diff,
and retry are typed control actions. Authorization is checked in Dobius before
execution; a reaction alone never bypasses an existing safety gate.

## Service lifecycle and recovery

Dobius owns start, stop, readiness, migrations, logs, and recovery for the
communications stack. Opening the tab never starts unmanaged shell scripts.

- One service supervisor with explicit states: stopped, starting, migrating,
  ready, degraded, recovering, failed.
- Health means real Postgres query + Redis command + media probe + relay signed
  query, not container process status.
- Bounded restart policy with visible diagnostics and manual retry.
- Ports are allocated/validated by Dobius; port 3000 is never assumed.
- The configured relay authority is canonical. In Buzz's tenant model,
  `localhost:3300` and `127.0.0.1:3300` select different communities; clients,
  health checks, agents, and supervisor configuration must use one identical
  authority and must fail with an actionable mismatch diagnostic.
- Production uses a real Keychain-backed relay signing key.
- Clean shutdown preserves durable messages and agent queue state.
- Cold boot restores services, reconciles runtime bindings, and drains queued
  messages without duplicating turns.
- SSH/remote hosts use the same coordinator contract with a host ID and never
  assume localhost paths.

## Delivery phases and gates

### Phase A — audited platform boundary

- Dedicated Communications guest partition and least-privilege preload.
- Typed request/response/event protocol with schema validation, request IDs,
  cancellation, timeouts, and an explicit command allowlist.
- Machine-checked 206-command production disposition manifest. Fixture-only
  commands are tracked separately and cannot inflate production coverage.
- Remove production dependence on `e2eBridge` mocks.

Done when arbitrary browser pages cannot access the bridge and a bridge
contract test proves rejection of unknown commands and malformed payloads.

### Phase B — supervised communications engine

- Package and supervise relay plus required storage.
- Keychain relay/participant keys, automatic migrations, readiness, recovery,
  diagnostics, and port discovery.
- Replace current manual Colima/dev-shell lifecycle.

Done when a clean reboot opens Communications without manual commands, and a
forced Redis/Postgres interruption recovers without an infinite loader.

### Phase C — complete communications UX

- Real channels, DMs, threads, composer, edits, reactions, uploads, search,
  inbox, unread state, typing, presence, notifications, keyboard shortcuts,
  settings, reminders, and workflows.
- Remove static fallback and every production mock.

Done when the Buzz upstream UX acceptance suite passes through the Dobius
bridge and all errors have actionable recovery states.

### Phase D — workstation projection

- Idempotent coordinator and persistent binding store.
- Mirror existing repositories, worktrees, terminals, agents, statuses, and
  lifecycle events into Communications.
- Open terminal/diff/worktree actions navigate the real Dobius UI.

Done when pre-existing and newly created runtimes appear correctly after live
changes, app restart, daemon restart, and remote-host reconnect.

### Phase E — Dobius-backed agent factory

- Preserve Buzz's complete create/edit UX.
- Replace its runtime catalog with Dobius providers/models/accounts.
- Transactional creation, start/stop/restart/delete, personas, skills,
  permissions, worktree selection, status, logs, and retry behavior.

Done when an agent created entirely from Communications uses an existing
Dobius OAuth account, receives a DM, edits its assigned worktree, runs tests,
and returns a verified result without exposing credentials.

### Phase F — control plane, workflows, and audit

- Structured progress/result cards, approvals, cancellation, engine switching,
  orchestration, schedules, reactions, and durable audit events.
- Complete any retained workflow actions currently unimplemented upstream.

Done when every visible control changes the real Dobius runtime exactly once
and is represented in the audit history.

### Phase G — voice huddles

- Mic/PTT UX, local transcription, agent routing, synthesized replies,
  interruption/cancellation, device selection, and durable transcript.
- Human live-audio can remain a separate gate, but no visible huddle control
  may be inert.

Done when clicking Huddle supports a natural spoken task conversation with a
real agent and leaves a searchable transcript.

### Phase H — takeover cleanup and shipping

- Dobius branding and copy; Apache 2.0 license/NOTICE compliance retained.
- Remove Block endpoints, Builderlab, unused Tauri shell, mobile/mesh/operator
  surfaces, mock fixtures from production bundles, and dead dependencies.
- Cross-platform packaging, upgrade/migration path, resource limits, backup,
  diagnostics, documentation, and accessibility review.

Done when clean-install, upgrade, reboot, offline/degraded, SSH/remote-host,
and packaged-app tests pass on supported platforms.

## Test matrix

Required layers:

- Unit: command mapping, schemas, identity binding, reconciliation, transaction
  compensation, account sanitization, event projection.
- Contract: Buzz request/response fixtures against the Dobius bridge and relay.
- Integration: real relay/storage plus Dobius daemon, agents, PTYs, files, git,
  notifications, speech, and OAuth runtime preparation.
- E2E: upstream Buzz UX flows executed inside the packaged Dobius app.
- Failure injection: database/Redis/media/relay/daemon/agent crashes, expired
  OAuth, missing CLI, port collision, network loss, duplicate events, restart.
- Security: unknown bridge commands, malformed payloads, renderer compromise,
  path traversal, secret scanning, channel authorization, permission gates.
- Performance: cold start, 100 rooms, long histories, concurrent agents,
  attachment upload, search latency, terminal-output backpressure.

## Final release acceptance

The takeover is complete only when all of the following work in a packaged
Dobius build without developer commands:

1. Add/select an existing OAuth account without exposing its secret.
2. Create an agent from Communications, select persona/model/skills/repo, and
   obtain a real Dobius worktree and terminal.
3. DM or mention the agent; observe queued, working, waiting, completed, failed,
   cancelled, and offline states accurately.
4. Open the exact terminal, worktree, diff, test result, and artifact from the
   conversation.
5. Restart Dobius/the daemon/the communication services without losing or
   duplicating messages, rooms, agents, bindings, or turns.
6. Use channels, DMs, threads, search, reactions, uploads, notifications,
   workflows, settings, and voice without inert controls or mock data.
7. Run local and remote/SSH workspaces through the same model.
8. Pass typecheck, lint, unit/contract/integration/E2E, packaged smoke, failure
   recovery, security, accessibility, and performance gates.

## Immediate implementation order

1. Freeze and classify the 206-command production manifest.
2. Add the trusted Communications guest bridge without weakening browser
   webview hardening.
3. Route the first read-only vertical slice: accounts, agents, worktrees, and
   terminals from Dobius into the existing Buzz agent/project surfaces.
4. Route one command slice: create agent → worktree/terminal → status.
5. Route message → real running agent → result back to the room.
6. Replace the manual backend lifecycle with the supervisor before broadening
   the remaining UX surface.

## Execution program — no partial-finish interpretation

The phases above define architecture. The following work packages define the
order in which the product becomes usable. A package is not complete while any
visible control in its scope is inert, returns a fabricated success value, or
falls into `command is not implemented`.

### Package 0 — coverage ledger and build gate

Deliverables:

- Generate the production command inventory from the TypeScript AST in CI.
- Maintain a checked manifest containing command, owning feature, destination,
  implementation symbol, tests, UX route, and status.
- Require exactly one disposition: `relay`, `dobius-rpc`,
  `communications-service`, `native-electron`, or `removed`.
- Fail CI for a new/unclassified command, a retained command without a handler,
  a removed command with a reachable caller, or a production import of the E2E
  fixture bridge.
- Replace the generic runtime error with a development-only diagnostic that
  includes the owning feature and manifest entry. Packaged builds must have no
  reachable unimplemented command.

Exit gate: 206/206 commands classified and mechanically checked; current 34
implemented commands retain contract coverage; all 172 gaps have owners.

### Package 1 — identity and supervised engine foundation

Deliverables:

- Move participant and agent signing keys from webview local storage into the
  Dobius Keychain service; expose signing operations, never private keys.
- Add persistent bindings for participant, Dobius agent, account, repository,
  worktree, terminal, room, and host IDs.
- Add a Dobius service supervisor for relay, PostgreSQL, Redis, media storage,
  migrations, ports, logs, health, bounded recovery, and shutdown.
- Replace the public development relay key and normalize one relay authority.
- Add cold-start reconciliation and queue recovery.

Exit gate: after a reboot, opening Communications reaches a ready workspace
without Colima commands or shell scripts; service failure becomes an actionable
degraded screen and recovers without message or turn duplication.

### Package 2 — complete chat product

Deliverables:

- Channels: create/update/delete/archive/join/leave, members, roles, topic,
  purpose, templates, visibility, starter channels, and channel details/window.
- Conversation: DMs, send/edit/delete, replies, complete thread pagination,
  reactions, typing, drafts, unread/read markers, inbox, presence, and history.
- Discovery: global search, channel/member/message search, contacts, forum
  posts, link previews, and jump-to-result behavior.
- Canvas and saved searches/subscriptions.
- Live event subscriptions update query caches without manual reloads.

Exit gate: two human identities and two Dobius agents can use every retained
chat control, see identical durable history after restart, and receive accurate
unread/presence state.

### Package 3 — native Dobius agent factory

Deliverables:

- Preserve the full create/edit-agent UX but source engines, models, accounts,
  skills, permissions, repositories, and worktrees from Dobius.
- Transactional create/start/stop/restart/delete with compensation on failure.
- Existing Claude and Codex OAuth account IDs select isolated runtime homes;
  tokens never cross the preload boundary.
- Map messages and mentions to durable runs with cancellation, retries,
  questions, approvals, timeouts, logs, and structured progress.
- Teams, personas, snapshots, imports/exports, memory, configuration, and
  accurate live/offline/error status.

Exit gate: create Claude and Codex agents entirely from Communications, assign
different existing accounts and worktrees, DM both simultaneously, approve a
gated action, inspect their terminals/diffs, restart the app, and continue the
same conversations and runs.

### Package 4 — workstation and artifact bridge

Deliverables:

- Project/repository/worktree/terminal projections and bidirectional navigation.
- Clone, branch, diff, pull-request status/review, and pipeline status actions.
- Upload, download, clipboard, previews, local media proxy, artifact cards,
  progress, size limits, cleanup, and authorization.
- Native notifications, dock/tray activity, focus/deep links, haptics where
  supported, idle state, and power assertions.
- Remote/SSH host IDs and runtime routing use the same contracts as local work.

Exit gate: a conversation launches work in a selected existing repository,
opens the exact real terminal and diff, exchanges attachments, and notifies the
user with correct click-through on local and remote workspaces.

### Package 5 — workflows, audit, notes, and recovery

Deliverables:

- Workflow CRUD, channel bindings, schedules/triggers, execution, cancellation,
  approvals, run history, and structured results backed by Dobius orchestration.
- Notes, canvas, templates, agent/team snapshots, encrypted backup, restore,
  local archive, and searchable audit history.
- Implement retained upstream workflow actions that upstream itself leaves as
  placeholders, or remove their controls until real behavior exists.

Exit gate: every visible workflow action changes real state exactly once,
survives restart, appears in audit history, and can be retried safely.

### Package 6 — agent voice huddles

Deliverables:

- Huddle lifecycle, participant state, input/output device selection, PTT and
  continuous modes, transcription controls, interruption, cancellation, and
  reconnection.
- Dobius STT posts transcript turns through the normal durable message path.
- Dobius TTS speaks agent responses while complete text remains in the thread.
- Voice state and accessibility feedback match the existing huddle UX.

Exit gate: click Huddle, speak a task to any selected Dobius agent, hear the
answer, interrupt/follow up, and find the complete searchable transcript after
restarting the app.

### Package 7 — ownership cleanup

Deliverables:

- Rename every user-visible product surface to Dobius Communications.
- Remove Builderlab/Block hosting, relay mesh, Buzz updater, Tauri shell,
  unsupported mobile pairing, external catalogs, endpoints, and dead settings.
- Preserve Apache-2.0 attribution in LICENSE/NOTICE and source provenance.
- Keep compatibility-sensitive protocol kinds and persisted storage keys behind
  migration aliases; internal legacy names are not displayed to users.
- Remove static demo/fallback UI once the supervised engine recovery screen is
  complete.

Exit gate: searching the packaged UI and accessibility tree finds no Buzz or
Block product branding and no dead route, link, menu, button, or setting.

### Package 8 — release qualification loop

For every package, repeat: inventory → trace → implement → focused tests → full
typecheck/lint → packaged E2E → failure injection → audit → fix → repeat.

Final required runs:

- 206/206 command coverage and zero reachable unimplemented commands.
- Vendored unit/contract suite and Dobius unit/integration suite.
- Packaged-app E2E for onboarding, agent creation, chat, work execution,
  attachments, workflows, settings, voice, restart, and recovery.
- Failure injection for relay, database, Redis, media, daemon, OAuth expiry,
  missing runtime, port collision, network loss, and duplicate delivery.
- Security review of preload allowlists, schemas, secrets, filesystem paths,
  channel authorization, signing, and approval gates.
- Accessibility, keyboard navigation, performance, resource usage, and upgrade
  migration checks.

Final exit gate: the installed `/Applications/Dobius+.app` passes every release
scenario using real persisted state and services. Source-only success, fixture
success, a dev window, or an uninstalled package never counts as completion.
