# Communications — install gate + build plan

_2026-08-18 · orchestrated build · branch `feat/voice-orb-dictation`_

## Owner decisions (locked 2026-08-18)

1. **Install is BLOCKED until Carson says otherwise.** Explicit instruction.
   No `build-and-install.sh`, no electron-builder, no app launch. Every agent
   brief carries this as a hard guardrail.
2. **Gate scope: core-first, tail behind a flag.** The gate covers everything
   needed for chat, agents, departments/teams, membership, notifications, and
   the git/workstation surface. `voice-huddles` (17 cmds) and `canvas-notes`
   (14 cmds) do NOT block install — but their UI controls must be HIDDEN, not
   left inert. No visible dead control ships.
3. **Proof bar: real data, right shape.** A command counts as working only when
   it runs the real dispatch path against the real in-process relay and returns
   correctly-shaped live data. Not a stub, not a fixture, not "didn't throw".
   Buzz's `src/testing/e2eBridge.ts` is a SHAPE ORACLE ONLY — never a backend.
4. **Model policy (Carson's cost directive, overrides the global
   most-capable-model house rule for this build):** mapping/triage on Haiku,
   code that ships on Sonnet, nothing on Opus. Orchestrator stays in-session.

## The real target

`node config/scripts/check-communications-command-coverage.mjs` (run from `dobius/`)
reports **258 commands: 54 implemented, 180 pending, 24 awaiting removal**.

"All 258 work" is not literal — the 24 are Block/Builderlab leftovers and must be
DELETED, not implemented. Real target:

> **0 reachable unimplemented commands** = 234 implemented + 24 removed.

Expect the removal count to grow: any command whose only caller is an unreachable
control is a removal candidate, not implementation work.

## Blocking defect found before any code was written

The transport swap alone does not work. The vendored client performs a MANDATORY
NIP-42 handshake (`vendor/buzz-desktop/src/shared/api/relayClientSession.ts:62`
AUTH_TIMEOUT_MS=25s, challenge handled at :780, reply sent at :846, completion at
:891-897). Our in-process relay only speaks REQ/CLOSE/EVENT and answers `AUTH`
with "unsupported verb" (`src/main/communications/relay/relay-server.ts:296`).

Swapping only the transport therefore yields a 25-second hang, not a fix. Hence
two disjoint jobs: relay-side AUTH, and client-side native WebSocket.

## Agent fan-out (round 1)

| Agent | Model | Scope | Writes |
|---|---|---|---|
| triage-agents | haiku | agent-lifecycle, agent-provider-config, agent-approvals (43) | read-only |
| triage-workstation | haiku | workstation-git, media-service, media-native, updater-delegate (32) | read-only |
| triage-chatcore | haiku | identity-keychain, messages-dm, channels-membership, relay-lifecycle (40) | read-only |
| triage-voice-canvas | haiku | voice-huddles, canvas-notes, channel-templates (36) | read-only |
| triage-teams | haiku | teams-snapshots, native-ux, workflows (29) | read-only |
| harness-builder | sonnet | the per-command verification harness | `src/main/communications/verify/` only |
| build-relay-auth | sonnet | NIP-42 AUTH in our relay | `src/main/communications/relay/` only |
| build-ws-native | sonnet | Tauri websocket -> browser WebSocket | `vendor/buzz-desktop/src/shared/api/` only |

Write scopes are disjoint by construction — no two agents can collide.

## Known traps (carried into every brief)

- `pnpm exec electron-vite build` does NOT rebuild the Buzz UI; it copies a
  prebuilt `vendor/buzz-desktop/dist`. Correct entry point is
  `pnpm run build:electron-vite`. This has already cost one wasted cycle.
- `rm -rf out dist` before any packaging — stale `out/` fails the afterPack verifier.
- vitest here is v4: `--reporter=basic` does not exist and fails.
- **The vendored Buzz app does NOT use vitest.** Running
  `npx vitest run vendor/buzz-desktop/...` produces SPURIOUS failures — the `@/...`
  path alias goes unresolved and whole test files fail to load. Its real runner
  (vendor/buzz-desktop/package.json) is:
      node --import ./test-loader.mjs --experimental-strip-types --test "src/**/*.test.mjs"
  run from `vendor/buzz-desktop/`. `test-loader.mjs` is what supplies the alias.
  Cost two false regression alarms in round 1.
- **Do not run `npx vitest run src/main/communications/` (the parent dir).** It sweeps in
  `verify/`, whose harness needs its OWN config for the `@` alias, so it reports a phantom
  failed test file. Scope to `src/main/communications/relay/` for a true relay signal.
- `@noble/curves` is a PHANTOM dependency (used by relay-event.ts, absent from
  package.json). Add it before it breaks a build.
- Renderer still holds private signing keys in `window.localStorage`
  (`dobiusCommunications.ts:206,1306,1327`) while a Keychain store exists and is
  used by nobody. Security finding, tracked in the chatcore triage.

## Status

Round 1 dispatched. Nothing installed. Nothing committed by agents (all forbidden
from running git).

---

# ROUND 1 RESULTS (2026-08-18)

## Verified baseline (harness, real run, independently re-run by orchestrator)

    258 commands: 52 PASS | 180 UNIMPLEMENTED | 0 SHAPE_FAIL | 2 ERROR | 24 SKIPPED
    real exit code: 1

Run it with, from `dobius/`:
    npx vitest run --config src/main/communications/verify/vitest.config.ts
NOTE: do NOT pipe through `tail` — it masks the exit code (already caught once).

**The manifest was wrong: 52 work, not 54.** Two commands marked implemented fail live:
- `open_dm` — **DM creation is completely broken.** `dobiusCommunications.ts:412`
  publishes kind-41010 and reads `channel_id` from a `response:{...}` payload at
  :425-428. `grep 41010 src/main/communications/relay/` = nothing. Our relay has no
  DM-provisioning concept. Fix assigned to build-relay-auth.
- `discover_acp_providers` — cannot be driven outside a real Electron launch.
  Honestly carved out of the gate, visible in the JSON.

## Triage of the 180 pending (5 agents, verdicts cross-checked)

| slice | rows | implement | defer | remove |
|---|---|---|---|---|
| agents (lifecycle/provider/approvals) | 43 | 1 | 18 | 24 |
| chatcore (identity/dm/membership/relay) | 40 | 33 | 5 | 2 |
| teams (teams/native-ux/workflows) | 28 | 21 | 7 | 0 |
| voice-canvas (huddles/canvas/templates) | 36 | 36 | 0 | 0 |
| workstation (git/media/updater) | 32 | 16 | 16 | 0 |
| **raw total** | **179** | **107** | **46** | **26** |

Applying the owner's core-first decision (voice-huddles + canvas + templates deferred):

    REMOVE            50   (24 manifest Block/Builderlab + 26 triage)
    DEFER behind flag 82   (46 triage defer + 36 voice/canvas/templates)
    IMPLEMENT for gate 71

**The gate is ~71 commands, not 234.**

## HEADLINE: "departments of agents" is 3 commands away

The persona bridge the triage agent flagged as missing ALREADY EXISTS. Verified
PASS in the harness: `list_personas`, `create_persona`, `update_persona`,
`delete_persona`, `list_managed_agents`, `create_managed_agent`, `list_teams`,
`get_channels`, `get_channel_members`, `send_channel_message`, `get_feed`.

A team IS the department concept — `RawTeam` in
`vendor/buzz-desktop/src/shared/api/tauriTeams.ts:8-21`:
`{id, name, description, instructions, persona_ids[], is_builtin, source_dir,
is_symlink, symlink_target, version, created_at, updated_at}`.

Only missing: **`create_team`, `update_team`, `delete_team`** (all UNIMPLEMENTED)
plus the `open_dm` fix already in flight. Snapshot import/export is share-a-team-as-
a-file — NOT needed for the core goal.

NOTE: `source_dir`/`is_symlink`/`symlink_target` indicate upstream stored teams on
DISK, not in the relay (the triage summary claimed relay — unverified, and the field
shape contradicts it). Our implementation should pick its own store; do not assume
the upstream one.

## Security findings (verified from source, not taken on trust)

- `get_nsec` (`tauriIdentity.ts:29`) returns a raw private key TO the renderer.
- `import_identity` (`tauriIdentity.ts:37`) accepts a raw private key FROM it.
Both structurally require the renderer to handle secrets. **REMOVE, never implement.**
Consistent with the renderer already holding keys in localStorage
(`dobiusCommunications.ts:206,1306,1327`) while the Keychain store goes unused.

## Corrections applied to agent output (do not re-trust these rows)

- triage-chatcore claimed Keychain handlers `communications:encryptToSelf` /
  `decryptFromSelf` exist and just need allowlisting. **They do not exist.**
  Only 4 handlers are registered (`src/main/ipc/communications-identity.ts:17-34`):
  getIdentity, signEvent, getAgentIdentity, signEventAsAgent. So
  `nip44_encrypt_to_self` / `nip44_decrypt_from_self` need NEW backend, effort M.
- triage-agents' "remove 24" is a large, product-visible claim from a cheap model
  and is NOT yet validated. **Nothing gets deleted until a verification pass
  confirms each removal.**

## Deferred-feature hiding (concrete, from triage-voice-canvas)

All 36 voice/canvas/template commands sit behind REACHABLE controls, so all 36 would
ship as dead buttons. Hiding needs 3 UI conditionals: **AppShell**,
**ChannelManagementSheet**, **SettingsPanels**. No dead-code cleanup required.

## Round 1 agent conduct

- Write fences held: `git status` shows each agent touched only its own scope.
- harness-builder self-corrected a wrong oracle mid-run and refused to fake the one
  command it could not test.
- One fabricated API (above) — caught by orchestrator verification, not by the agent.

## Still in flight

- build-relay-auth: NIP-42 AUTH (relay-auth.ts created), then DM provisioning.
- build-ws-native: Tauri->native WebSocket. NOT done — `plugin:websocket` still
  present in relayWebSocketClose.ts and its test.

## Known gap in the gate itself

The harness calls RpcDispatcher directly; it does NOT traverse the real
renderer->preload->ipcMain->communications-gateway path (which includes the
gateway's sender-trust check). It proves the logic, not the wiring. Closing this
needs a dev-mode Electron launch — NOT an install. Awaiting owner's decision.

## Install status

NOT INSTALLED. Nothing committed by any agent. Owner instruction standing.

---

# ROUND 2 STATUS (2026-08-18, orchestrator-verified)

Every claim below was re-run by the orchestrator, not taken from an agent report.

## DONE — NIP-42 AUTH in our relay

- New `src/main/communications/relay/relay-auth.ts` (challenge gen + NIP-42 validation).
- `relay-server.ts` sends `["AUTH", challenge]` on connect, accepts inbound AUTH,
  tracks per-socket state, cleans up on close. REQ/EVENT deliberately UNGATED so the
  second, non-authenticating client (`src/renderer/.../buzz/native/relay-client.ts`)
  keeps working.
- Challenge = `randomBytes(32).toString('hex')`, fresh per connection.
- **Verified: `npx vitest run src/main/communications/relay/` -> 4 files, 188 tests, exit 0.**
- **Verified: zero typecheck errors in relay/** (grep of the full tsc output).
- Known dead-ish state by design: `authenticatedPubkey` is recorded but read nowhere,
  because gating was out of scope. It is the hook for later auth-gated behaviour.
- Not done: the relay tag is checked for PRESENCE, not exact URL match. Acceptable for a
  single local relay (challenges are per-connection); note it if we ever go multi-relay.

## DONE — Tauri WebSocket removed

- `relayClientSession.ts`, `relayWebSocketClose.ts`, `readOnlyRelayClient.ts` now use the
  browser `WebSocket` via `openWebSocket`/`sendOnWebSocket`/`closeWebSocket` over a
  module-level id->socket map, preserving every existing call-site signature.
- **Verified: zero live `invoke("plugin:websocket...")` and zero `@tauri-apps` imports.**
  Remaining textual hits are explanatory comments only.
- **Verified: the vendored app's OWN typecheck passes — `npx tsc --noEmit` from
  `vendor/buzz-desktop` exits 0.**
- OUTSTANDING: 1 real failing test, `sendOnWebSocket writes a frame the server receives`
  (relayWebSocketClose.test.mjs:46). Expected the frame string, got `'91'` — the char code
  for `[`, i.e. something reads the first BYTE of a Buffer instead of decoding it.
  Handed back with that diagnosis and an explicit instruction NOT to weaken the assertion.

## IN PROGRESS — DM provisioning (`open_dm`)

`relay-dm.ts` now exists. Target: relay recognises kind-41010, derives a deterministic
channel id from the sorted participant set, ensures a kind-39000 metadata event, and
returns `response:{"channel_id":"..."}` in the POST /events message field. Judge is the
harness: `open_dm` must move ERROR -> PASS.

## HARNESS — real typecheck debt, assigned back

The gate artifact itself did not typecheck. Two genuine errors:
- `run-verification.test.ts:32` TS6307 — imports vendor `tauri.ts`, which is outside the
  parent tsconfig project.
- `runtime-bridge-harness.ts:70` TS2322 — real type bug.
Assigned back with a hard constraint: verify/ must remain typechecked by SOMETHING, not
merely excluded. An unchecked install gate is the failure mode this project keeps hitting.

## Attribution correction (do not repeat)

build-relay-auth attributed the verify/ suite failure to the concurrent vendor edits. That
is WRONG. It is a config/alias issue: verify/ needs its own vitest config for the `@` alias.
Nothing about the vendor changes caused it.

## Install status

STILL NOT INSTALLED. Nothing committed. Owner instruction standing.

## DELETION VALIDATION — all 24 proposed deletions OVERTURNED

An adversarial pass (instructed to REFUTE each deletion, default KEEP) returned:
**0 DELETE_CONFIRMED, 4 KEEP, 19 KEEP_BUT_STUB.**

Every one traces to a real, mounted, reachable UI: Settings > Harness Catalog / Agent
Defaults / Local Archive, the real Create/Edit Agent dialog family (AgentDialog,
AgentDefinitionDialog, AgentInstanceEditDialog, AgentConfigPanel, WhereToRunSection),
onboarding SetupStep/DefaultConfigStep, the Huddle bar, the agent profile panel, and the
Workflows screen behind a genuine `/workflows` route. None of it is dead code.

The triage's premise — "ACP/architectural mismatch = safe to remove" — conflated
CAPABILITY REDUNDANCY with UI REACHABILITY. Deleting a backend command without also
deleting its calling UI leaves controls that silently error or hang. That is worse than
today's state.

### The near-miss (orchestrator-verified, every line opened)

`decrypt_observer_event` and `build_observer_control_event` are NOT a side feature:
- real calls at `vendor/buzz-desktop/src/shared/api/tauriObserver.ts:7,16`
- `useAgentObserverIngestion` is imported and CALLED unconditionally at
  `vendor/buzz-desktop/src/app/AppShell.tsx:43,185` — app-wide mount
- `features/agents/lib/useAutoRestartPolicy.ts:15,66,73` reads
  `getAgentObserverSnapshot(...)` and gates on `observer.connectionState === "open"`

Deleting them breaks how Communications knows an agent is alive and whether to restart it.
That is squarely the chat/agent path the whole project exists to deliver. These 4 move to
IMPLEMENT, not remove.

### Revised gate arithmetic

    REMOVE             26   (24 manifest Block/Builderlab + 2 security: get_nsec, import_identity)
    DEFER / STUB      101   (82 previously deferred + 19 KEEP_BUT_STUB)
    IMPLEMENT          75   (71 + the 4 observer commands)

Was: remove 50 / implement 71. The deletion list shrank by half and the build list grew
by 4. **Nothing is deleted on a cheap model's verdict.** The adversarial pass cost one
agent run and prevented a regression in the headline feature.

### Standing rule this establishes

A `remove` verdict from a triage pass is a HYPOTHESIS, never an instruction. Deletion
requires positive evidence from an opened file that the calling UI is unreachable, or that
a named Dobius method genuinely replaces it. "Architecturally redundant" is not evidence.

---

# MILESTONE — the gate is GREEN and DMs work (2026-08-18, orchestrator-verified)

Independently re-run by the orchestrator, not taken from agent reports:

    npx vitest run --config src/main/communications/verify/vitest.config.ts   -> exit 0
    report generatedAt 2026-08-18T09:00:06Z
    counts: PASS 53 | UNIMPLEMENTED 180 | SHAPE_FAIL 0 | ERROR 1 | SKIPPED 24
    open_dm: PASS          <- was ERROR "Missing DM channel id"

    npx vitest run src/main/communications/relay/   -> 4 files, 191 tests, exit 0
    npx oxlint src/main/communications/relay/       -> exit 0, zero output
    relay/ typecheck errors                          -> 0

Test-count arithmetic confirms the relay-wire.ts refactor was behaviour-preserving:
182 baseline -> 188 (+6 AUTH) -> 191 (+3 DM), none lost.

## How open_dm was fixed

New `relay-dm.ts` (97 lines) + `relay-wire.ts` (21 lines, `sendFrame` extracted so
relay-auth.ts can reply without importing the server; also kept relay-server.ts under the
oxlint max-lines cap).

- Relay now recognises kind 41010, derives a channel id as
  `sha256(sorted+deduped+lowercased(author + all "p" tags))`, hex.
- Because the author is folded INTO the set before sorting, initiator identity and tag
  order are both erased — {A opens with B,C}, {B opens with C,A}, {C opens with A,B} all
  produce the same id. Covered by a test that re-opens from a different participant with
  reversed tag order and asserts one and only one kind-39000 row exists.
- Ensures the kind-39000 metadata event (client reads participants from its "p" tags at
  `dobiusCommunications.ts:449`).
- Returns `response:{"channel_id":"<64 hex>"}` in the POST /events `message` field, exactly
  matching the `startsWith("response:")` + `JSON.parse(slice(...))` parse at :425-428.

## DURABILITY LANDMINE — read before touching relay-dm.ts

kind-39000 metadata is authored by a fixed system pubkey derived from the literal string
`sha256("dobius-relay-dm-channel-authority")`. Kind 39000 is ADDRESSABLE by
(pubkey, kind, d-tag). **If that constant is ever edited, every previously provisioned DM
channel is orphaned** — the old metadata becomes invisible to a re-provision keyed on the
new pubkey, and a stale duplicate lingers under the old one. It must stay byte-for-byte
stable forever. Not a bug; a permanent constraint.

## Deliberate non-behaviours (flagged by the implementer, accepted)

- The raw kind-41010 event is consumed, not stored. Repo-wide grep found no client that
  queries kind 41010, so nothing depends on retrieving it.
- No server-side participant cap. The client already caps at author + 8
  (`dobiusCommunications.ts:415`). A future/malformed client could provision a larger room.
- Solo-DM rejection is evaluated on the DEDUPED set including the author, so a client that
  redundantly lists its own pubkey as a "p" tag is still correctly rejected.

## Remaining ERROR

`discover_acp_providers` — the documented harness limitation (needs a real Electron
startup to configure account services). It is carved out of the gate explicitly and stays
visible in the JSON. Not a regression, not caused by the relay work.

## Removal validation footnote

verify-removals mapped 23 of the 43 pending commands in those three features to the
triage's quoted removal categories and explicitly REFUSED to pad the list to 24. Correct
behaviour — the "24" was the triage's own count, and it was not reproducible.

---

# CONSOLIDATED STATE — 2026-08-18 04:08, all four checks run by the orchestrator

    repo typecheck (config/tsconfig.node.json)   PASS (exit 0)
    relay unit tests (191)                       PASS (exit 0)
    relay lint (oxlint)                          PASS (exit 0)
    command harness / install gate               PASS (exit 0)

    gate baseline: PASS 53 | UNIMPLEMENTED 180 | SHAPE_FAIL 0 | ERROR 1 | SKIPPED 24
    (the 1 ERROR is discover_acp_providers, the documented Electron-only limitation)

Vendored client, verified separately from vendor/buzz-desktop:
    node --import ./test-loader.mjs --experimental-strip-types --test "src/shared/api/*.test.mjs"
                                                 exit 0, 253 tests, 0 fail, no file-level failures
    npx tsc --noEmit                             exit 0, zero output
    zero `plugin:websocket` as code, zero `@tauri-apps` imports in the 3 transport files

## The leaked-handle catch (worth remembering)

build-ws-native reported "253/253 passing" — TRUE at the individual-test level, and still
hiding a failure. The test FILE timed out at 20s and the command exited 1: every assertion
passed, but a `ws` server was left listening so the process never went idle. A summary of
pass counts cannot show this; only the exit code can.

Fixed by terminating live connections then closing the server
(`for (const c of server.clients) c.terminate()` then `server.close()`) — the same pattern
the relay's own closeServer() uses. Re-verified: exit 0, 253 tests, no `not ok` lines.

**Process lesson:** my brief asked agents for "real pass/fail counts" and NOT for the exit
code. They reported exactly what was asked. Every subagent brief that runs a suite must
demand the observed EXIT CODE, captured without a pipe.

## OUTSTANDING — the one gap that matters

Client-side NIP-42 and relay-side NIP-42 were built by two different agents and have NEVER
been run against each other. Relay side has 6 tests driving it with a hand-built event;
client side explicitly skipped the auth leg (that agent flagged it honestly). If the two
disagree on any detail — tag name, kind, challenge echo, OK matching — live chat fails
silently while every suite stays green.

Assigned to harness-builder (the only scope wired for both sides: verify/ already starts
the real relay AND resolves the `@` alias into vendor). Instructed that if the handshake
fails, the FINDING is the deliverable — it must not reach across and patch the other side
to make its own test pass.

## Install status

STILL NOT INSTALLED. Nothing committed. Owner instruction standing.

---

# CORRECTION — "PASS" can mean "correctly returns nothing" (2026-08-18)

## What I got wrong

Earlier in this plan I recorded that "departments of agents is 3 commands away" because
`list_teams` verified PASS in the harness. **That was wrong.** `list_teams` is a hardcoded
stub at `vendor/buzz-desktop/src/shared/api/dobiusCommunications.ts:1694`:

    case "list_teams":
      // Dobius has no persistent team entity yet. Return the authoritative
      // empty state so upstream E2E fixtures can never leak into production.
      return { handled: true, result: [] };

There is NO team storage in Dobius at all. It scores PASS because an empty array IS the
correct SHAPE. The harness is being honest; shape-checking simply cannot distinguish
"correctly returns nothing" from "returns the right thing".

## Audit of all 53 PASSes

Six return a hardcoded literal with no backend call:

| command | verdict |
|---|---|
| `apply_workspace` | legitimate — validates the relay URL, no-op by design |
| `is_shared_identity` | legitimate — Dobius identity genuinely is not shared |
| `set_prevent_sleep_active` | legitimate — parent window owns power assertions, documented |
| `validate_repos_dir` | legitimate — Dobius owns repo roots, documented |
| `list_managed_agent_runtimes` | **HOLLOW** — returns [] where real data should exist |
| `list_teams` | **HOLLOW** — returns [] where real data should exist |

So 47 of 53 are genuinely backed, 4 are correct deliberate no-ops, and **2 are hollow**.
The gate is mostly honest — but "53 PASS" is not the same as "53 features work".

## Standing rule this establishes

The proof bar ("real data, right shape") CANNOT catch a well-formed empty response. Any
command whose handler returns a literal with no `await`/backend call must be treated as
UNBUILT regardless of its verdict. The audit query that finds them:
grep the switch for `result: (\[\]|\{\}|false|null|undefined)` with no `await` in the case body.
Re-run that audit before ever reporting a PASS count as a completeness measure.

## Revised scope for departments

Not 3 commands. Needs: a persistent team store (mirroring
`src/main/agents/agents-store.ts`), typed RPC methods (mirroring
`src/main/runtime/rpc/methods/custom-agents.ts`), allowlist entries in
`src/shared/communications-bridge.ts`, and FOUR command cases (list replacing the stub,
plus create/update/delete). Still small — a team is just {name, description, instructions,
personaIds[]} — but it is construction, not wiring.

What genuinely IS already done and verified: personas are real. `list_personas`,
`create_persona`, `update_persona`, `delete_persona`, `list_managed_agents`,
`create_managed_agent` all pass against real backend, so `persona_ids` are simply Dobius
custom-agent IDs. That half needs no work.

Assigned to build-teams.

---

# SCOPE REVERSAL — build EVERYTHING (owner directive, 2026-08-18)

The owner reversed the core-first decision, explicitly and knowingly: "I want everything
that Buzz gives us, their full harness... I don't want to miss out on anything because we
could use something in the future."

**Supersedes the earlier core-first/defer decision. There is no deferred tail.**
voice-huddles (17), canvas-notes (14), channel-templates (5), workflows (8),
workstation-git (21) and everything else are IN SCOPE. Nothing gets hidden behind a flag.

Also clarified: a team/department must be composable from the accounts already connected
in Dobius (Claude/Codex OAuth accounts), not just bare agent ids. build-teams builds the
store first; account binding is a follow-on to that same agent.

## The only two genuine constraints, and how they are honoured

1. **24 Block/Builderlab commands** point at another company's hosted infrastructure. Where
   the capability is meaningful it gets re-pointed at OUR relay. Where the command is
   literally "join Block's hosted community", it is reported as impossible WITH the reason —
   never silently dropped, never faked.
2. **`get_nsec` / `import_identity`** structurally require the renderer to hold a private
   key. The CAPABILITY (export/import an identity) ships; the IMPLEMENTATION moves into the
   main process behind the existing Keychain IPC. Owner gets the feature, not the hole.
   This is the one place a literal reading is refused, and it is a security boundary, not
   a scope cut.

## Collision control for a ~180-command build

`vendor/buzz-desktop/src/shared/api/dobiusCommunications.ts` is ONE ~1740-line switch that
nearly every command must touch, and `src/shared/communications-bridge.ts` is one shared
allowlist. Parallel agents editing either would collide badly.

**Rule: feature agents own ONLY their own new backend files. They do NOT edit the shared
switch or the allowlist — they REPORT the exact cases and allowlist entries needed, and
those are applied centrally in a single serialized wiring pass.**

Exception in flight: build-teams already holds dobiusCommunications.ts for the team cases.
No other agent may touch it until that lands.

## Wave A dispatched

| agent | families | commands | owns |
|---|---|---|---|
| build-chatcore | channels-membership, messages-dm, relay-lifecycle | 22 | src/main/communications/chat/ |
| build-identity | identity-keychain | 18 | src/main/communications/identity/ |
| build-native-ux | native-ux, media-native, updater-delegate | 14 | src/main/communications/native/ |
| build-huddles | voice-huddles | 17 | src/main/communications/huddles/ |

Wave B (queued): agent-lifecycle 43, workstation-git 21, canvas-notes 14, teams-snapshots 9,
workflows 8, media-service 6, channel-templates 5.

---

# TEAMS/DEPARTMENTS — real backend landed (orchestrator-verified)

`list_teams` no longer returns a hardcoded `[]`. Verified by me:
    team-store tests   exit 0
    repo typecheck     exit 0
    install gate       exit 0
    list_teams verdict PASS (now backed by a real store)

`src/main/communications/team-store.ts` persists to `<userData>/teams.json` using the same
atomic write as agents-store.ts (temp file + renameSync). Wire shape matches `RawTeam`
exactly; Buzz-only fields (is_builtin, source_dir, is_symlink, symlink_target, version) are
honest false/null defaults, not fabricated values. A dedicated test asserts agents-store is
never even IMPORTED during a team delete — i.e. deleting a department cannot delete agents.

Follow-on assigned: ACCOUNT BINDING. The owner's requirement is a department composed from
"whatever accounts I have connected via Dobius". The store currently holds only personaIds.
Extending it to bind Dobius ACCOUNT IDS — with a hard rule that no token or secret may enter
the team store, wire shape, or renderer, plus a test asserting that.

# STRUCTURAL FIX — per-family verification fixtures

Teams exposed a bottleneck that would have jammed the whole build. The harness calls any
command it has no fixture for with `{}`; a REAL implementation correctly rejects that, so
create_team/update_team/delete_team landed as ERROR despite working. Every one of the ~180
incoming commands would do the same, and all fixtures lived in ONE file owned by ONE agent —
both a bottleneck and a collision point.

Fix: each feature agent now writes `<their-dir>/<family>.scenarios.ts` exporting
`SCENARIO_STEPS: ScenarioStep[]`, and the harness composes them. Content is owned by the
feature agent; only the compose lines are shared.

Instructions given to every agent, because a weak fixture is worse than none:
- `shapeCheck` must assert the REAL shape the Buzz UI expects, not "is an object" — a hollow
  `[]` passed unnoticed for months precisely because nothing checked contents.
- Omit a fixture you cannot write honestly (needs a live Electron window, a microphone, a
  real model account) and REPORT it. An absent fixture is honest; a fake passing one is a lie
  the gate repeats forever.
- build-identity additionally writes a key-leak assertion helper applied to every one of its
  steps, so any future "simplification" that reintroduces renderer-held private keys fails
  the gate.

Also flagged to harness-builder: its documented assumption that calling unimplemented
commands with `{}` is safe "because the switch dispatches on name alone" is NO LONGER TRUE
once commands are implemented. The ERROR verdict must distinguish "not implemented" from
"implemented but rejected our empty fixture", or the gate's numbers become misleading exactly
as the project scales.

---

# HANDSHAKE PROVEN END TO END (orchestrator-verified)

The biggest untested risk in the project is closed. `verify/auth-handshake-integration.test.ts`
drives the REAL client against the REAL relay:

    RelayClient.preconnect() (public, unmodified) -> ensureConnected() -> connect()
    -> real openWebSocket()/sendOnWebSocket() over Node's native WebSocket
    -> real ws-backed relay (RelayStore + startRelayServer)
    -> real ["AUTH", challenge] from relay-server.ts attachConnection
    -> real handleAuthChallenge() -> real createAuthEvent()
    -> real dobiusCommunications case "create_auth_event"
    -> genuinely schnorr-signed kind-22242 event (nostr-tools finalizeEvent)
    -> real ["AUTH", event] -> real relay-auth.ts applyAuthFrame (signature, kind,
       challenge match, relay tag, staleness)
    -> real ["OK", id, true, ""] -> real handleOk() -> state "connected"

Verified by me: `npx vitest run --config src/main/communications/verify/vitest.config.ts`
-> 3 files, 15 tests, exit 0.

**MISMATCHES FOUND: ZERO.** The two independently-built halves agree. Only one thing is
simulated, in the negative test only, and it is stated plainly: the inbound challenge string
is swapped in transit to prove the wrong-challenge rejection is fast rather than a 25s hang.

## The honest gap this test surfaced — and it matters

Reported under "would NOT catch", and it is a genuine design weakness, not just a test limit:

**Both sides FAIL CLOSED SILENTLY.** The client's and relay's frame guards are strict
`typeof` checks that DROP an unrecognized frame rather than raising. So any future protocol
drift — a renamed tag, a boolean sent as a string, a challenge wrapped in an object —
produces no error at all. It degrades into the client's 25-second AUTH timeout.

That is precisely the symptom this entire investigation started with: a silent hang that
reads as a dead network. The handshake is correct TODAY and now regression-tested, but the
failure MODE is still the worst possible one.

Also untested: the 25s timeout branch itself (deliberately — proving it costs a 25s test
run), and bad-signature/stale-event rejection at the integration level (covered by the
relay's own 6 unit tests).

RECOMMENDATION (not yet actioned, needs owner's call on scope): make an unrecognized frame
on either side log loudly / surface an error instead of being dropped. Small change, and it
converts every future protocol drift from a mystery hang into an immediate, named failure.

---

# PRE-INSTALL SAFETY — terminal daemon must survive (owner directive, 2026-08-18)

Owner: keep the daemons of all live terminals up across any install.

## Audited — the install chain is already daemon-safe

`build-and-install.sh` does no killing itself; it delegates to `scripts/install-dobius-v2.sh`,
which does exactly the right thing (lines 59-66):

    osascript -e 'tell application "Dobius+" to quit'   # graceful; daemon persists sessions
    sleep 4
    pkill -x "Dobius\+"                                  # exact name, PLUS ESCAPED
    pkill -f "Dobius\+ Helper.*--type="                  # Chromium helpers ONLY

Why this is safe, verified against the live process: the detached daemon's command line is
    Dobius+ Helper .../out/main/daemon-entry.js --socket ... --token ...
It has NO `--type=` argument, so the helper pkill cannot match it, and `-x` matches the app
name exactly rather than the bundle path. The script even carries a comment warning never to
pattern-match the bundle path for precisely this reason.

Both historical traps are already fixed here:
- the unescaped `Dobius+` regex (the `+` is a quantifier — `pkill -x "Dobius+"` NEVER matches)
- `pkill -f "/Applications/Dobius+.app"`, which used to murder the daemon and silently end
  every terminal session

## MANDATORY pre-install check (run BEFORE any future install)

    ps -Ao pid,command | grep daemon-entry.js | grep -v grep      # note the PID
    # ... run the install ...
    ps -Ao pid,command | grep daemon-entry.js | grep -v grep      # daemon must still be alive

If the daemon PID is gone after an install, sessions were destroyed — treat as a release
blocker, not a nuisance. Also confirm `endedAt` stays null in the session meta files; a
daemon shut down via SIGTERM must pass `{ markSessionsEnded: false }` or next launch will
NOT cold-restore scrollback.

Daemon alive at time of audit: PID 1226. Nothing has been installed.

# HALLUCINATION CONTROL (owner directive, 2026-08-18)

Standing rule, already in force: NO agent claim is accepted without the orchestrator
re-running it. Caught so far by that discipline:

| # | Agent claim | Reality |
|---|---|---|
| 1 | Keychain handlers `encryptToSelf`/`decryptFromSelf` exist, one-line allowlist fix | They do not exist anywhere. Only 4 handlers registered. Needed real backend. |
| 2 | 24 commands safe to delete (ACP redundant) | ALL overturned. 2 were load-bearing for agent liveness — deleting would have broken chat. |
| 3 | `list_teams` implemented (PASS in gate) | Hardcoded `[]` stub. No team storage existed at all. |
| 4 | verify/ suite failure caused by concurrent vendor edits | False. Config/alias issue, unrelated to any code change. |
| 5 | "253/253 tests passing" | True AND hiding a failure: the file leaked a handle, timed out, exit code 1. |
| 6 | "6 huddle commands map onto speech.ts/voice-conductor.ts" (my brief, from triage) | Rejected by the agent after reading the source: speech.ts is STT-only, voice-conductor is a text dispatcher. Correct rejection. |

Brief-level controls now standard: demand the REAL OBSERVED exit code captured without a
pipe; forbid describing intended behaviour as observed; require quoting actual output;
require an explicit "impossible + why" verdict instead of a stub; instruct that an absent
fixture is honest and a fake passing one is a lie the gate repeats forever.

---

# WAVE A/B STATUS + two structural catches (2026-08-18)

## Built and orchestrator-verified so far — 58 commands

| slice | result |
|---|---|
| core chat / channels / membership / DMs | 22/22, tsc 0 |
| voice huddles | 17/17, 39 tests, tsc 0 |
| native OS (notifications, tray, dialogs) | 15 implemented, 3 honestly reported impossible headless |
| teams / departments | 4, real store, gate PASS |

In flight (122): agent-lifecycle 43, workstation+media 27, canvas+templates 19,
identity 18, workflows+snapshots 17. Every one of the 180 now has an owner.

## Catch 1 — stale tsbuildinfo reports a DELETED file as missing

The repo typecheck failed with TS6053 naming
`huddles/zz-scratch-dryrun.test.ts` — a scratch file an agent created and deleted. The file
did not exist and NOTHING in source referenced it; the error came from a stale
`config/tsconfig.node.tsbuildinfo`. Deleting the tsbuildinfo cleared it.

**Rule: an error naming a file that does not exist means a stale tsbuildinfo, not a real
failure. `rm config/*.tsbuildinfo` and re-run BEFORE investigating.** Exactly the class of
false alarm that has already cost this session two wrong status reports.

## Catch 2 — the scenario contract was on the wrong side of a project boundary

harness-builder's earlier fix (excluding verify/ from the node tsconfig so verify/ could
reach into vendor) had an unforeseen consequence: family scenario modules live OUTSIDE
verify/ and import the ScenarioStep contract FROM verify/, crossing the same boundary in
reverse. huddles.scenarios.ts hit TS6307 immediately, and all six remaining families would
have hit it identically.

Fix assigned: move `ShapeOutcome` / `ScenarioContext` / `ScenarioStep` / `randomHexPubkey`
into a shared `src/main/communications/scenario-contract.ts` that both the harness and every
family directory can import without crossing an excluded path; verify/ re-exports for
compatibility. Also wiring in huddles, whose scenarios landed after the composer was written.

**Lesson: a fix that moves a boundary should be checked against everything that will later
cross it, not just the error in hand.**

## Security findings from automated review — both accepted, both assigned

1. `huddles/huddle-speech-synthesis.ts` — ARGV FLAG SMUGGLING. Agent reply text (untrusted,
   from the relay) passed as the first argv element to `say`/`espeak`. Text starting with `-`
   parses as an OPTION. Fix: `--` terminator + reject/neutralise leading `-`, plus a test.
2. `identity/secure-key-entry-window.ts` — MISSING IPC SENDER VERIFICATION. The ephemeral
   key-entry window's ipcMain handlers accepted a submit from ANY renderer, including the
   Communications webview this window exists to keep keys away from. Fix: gate on
   `event.sender.id === win.webContents.id` on every handler, plus payload shape validation
   and a test that a foreign sender is ignored.

Both classes are now written into every wave-B brief so they are not rebuilt, plus
untrusted-deserialization and path-traversal guidance for the snapshot importer and a test
forbidding any token from appearing in an exported snapshot.

**Note on my own coverage: these were found by automated security review, NOT by me.** I had
been verifying that agent claims were TRUE (tests really pass, exit codes real). That is a
different lens from whether the code is SAFE. Both are needed.

---

# SCENARIO CONTRACT DIVERGENCE (caught 2026-08-18, converging)

Four family scenario files landed before the shared contract existed, and they solved the
TS6307 boundary problem in TWO different ways:

| file | pattern |
|---|---|
| `teams.scenarios.ts` | LOCAL COPY of the types |
| `native/native.scenarios.ts` | LOCAL COPY of the types |
| `chat/chat.scenarios.ts` | imports from `verify/command-scenario` (TS6307) |
| `huddles/huddles.scenarios.ts` | imports from `verify/command-scenario` (TS6307) |

build-native-ux deliberately copied the types locally and SAID SO, citing teams.scenarios.ts
as precedent and noting the verify/ import was broken. Pragmatic and it typechecks — but
local copies of a shared contract drift silently, which is exactly the failure this project
keeps hitting.

`src/main/communications/scenario-contract.ts` has now landed. All four must converge on it:
  from `src/main/communications/*.scenarios.ts`      -> './scenario-contract'
  from `src/main/communications/<family>/*.ts`       -> '../scenario-contract'

Wave-B agents (workstation, canvas, workflows) have not written theirs yet and can use the
correct path first time.

**Rejected fix, and why it matters:** build-huddles proposed adding `**/*.scenarios.ts` to
config/tsconfig.node.json's exclude. Current exclude is exactly
`['../src/main/communications/verify/**/*']`, so that would drop EVERY family's fixtures out
of type checking — the very files that decide whether 180 commands count as working. Making
an error vanish by deleting the check is the pattern that caused the boundary problem in the
first place. Contract move instead: error gone AND everything stays checked.

# Progress snapshot

    chat         7 src / 6 test files      identity   13 src / 10 test files
    native      13 src / 11 test files     huddles     6 src /  3 test files
    agents       6 src /  6 test files
    workstation / canvas / workflows — wave B, just started

Verified by me: native 59 tests exit 0; agents 32 tests exit 0; huddles 39 tests exit 0;
chat 22/22 tsc 0; teams 11 tests exit 0.

# Native OS coverage limit (material for the eventual install decision)

build-native-ux: only 5 of 14 native commands get a headless fixture. The other 9 call
Electron APIs the harness cannot stub (Notification, Tray, nativeImage, clipboard, dialog,
BrowserWindow.getAllWindows). They are implemented, but the GATE CANNOT PROVE THEM — they are
verifiable only by launching the real app. Combined with the harness's standing LIMIT (it
calls RpcDispatcher directly rather than traversing the real IPC + gateway path), this is the
honest boundary of what "the gate is green" can mean.

---

# MILESTONE — ~100 commands built, integration in flight (2026-08-18)

## Built and orchestrator-verified

| slice | commands | tests |
|---|---|---|
| agent-lifecycle | 43/43 | 32 pass, exit 0 |
| core chat / channels / membership / DMs | 22/22 | 36 pass, exit 0 |
| identity + keys | 18/18 | clean in identity/ |
| voice huddles | 17/17 | 43 pass, exit 0 |
| native OS | 14/14 | 59 pass, exit 0 |
| teams / departments | 4/4 | 24 pass, exit 0 |

Gate: **PASS 56** (was 52 at session start) / UNIMPLEMENTED 177 / ERROR 1 / SKIPPED 24, exit 0.
The 4 team commands are PASS with real fixtures. The 1 ERROR remains the documented
Electron-only `discover_acp_providers`.

## Account binding (the owner's actual department requirement)

Team records now carry `accountIds`; the wire object gained `account_ids` as a NEW key rather
than overloading `persona_ids`. Enforcement is real, not aspirational: `normalizeAccountIds()`
runs every candidate through a token-shape rejector, and a test fabricates a JWT, an `sk-` key,
a Bearer string and a long blob alongside one real id and asserts ONLY the real id survives.

GAP being closed: `RawTeam`/`AgentTeam` in the vendored app have no `account_ids` slot, so the
value is dropped before the UI sees it and the Create/Edit Team dialog has no account picker.
Backend-complete, user-invisible. Assigned to build-ws-native with a hard fail-safe: if the
real account list is not reachable, STOP and report — never render a fabricated picker.

## Integration pass (critical path)

~100 `case` blocks sit in agent reports, unwired. Nothing built today is reachable until they
land in `dobiusCommunications.ts` + the allowlist. Assigned to a dedicated `integrator` with
EXCLUSIVE ownership of the only three shared files, and two hard rules:
- TRANSCRIBE, DO NOT INVENT — an ambiguous report is reported blocked, not reimplemented.
- STOP if PASS drops or `regressed` grows. A partial honest integration is recoverable.

## Fixtures are finding real bugs before they run

build-chatcore, while writing its fixtures, found two genuine defects in its own just-written
code: membership commands failing on a fresh relay with no snapshot (fixed with a
bootstrap-owner path), and five commands returning `result: null` where this codebase's
convention is `result: undefined`. Neither would have surfaced in casual use.

harness-builder confirmed all 10 headlessly-testable huddle commands correctly report
UNIMPLEMENTED — coverage is running AHEAD of the wiring, not behind it, so a fixture cannot be
quietly shaped to fit a bug that already exists.

## Security follow-through

`huddle-speech-synthesis.ts` argv smuggling: fixed with TWO layers (`--` terminator plus
`neutralizeLeadingDash()`), and EMPIRICALLY VERIFIED — the agent ran the real exploit
(`say -o /tmp/verify-safe.aiff -- "-o /tmp/should-not-exist.aiff hello world"`) and confirmed
the exploit file was never created. 4 regression tests added.

`secure-key-entry-window.ts` IPC sender verification: landed, and stronger than specified —
`event.sender.id === win.webContents.id` on every handler PLUS per-webContents namespaced
channel names, so a foreign renderer has no channel to target in the first place.

## Cross-agent catches only visible from the orchestrator's seat

1. **Opposing crypto designs.** build-identity moving keys INTO the Keychain; build-agent-lifecycle
   concluding observer crypto must stay in the RENDERER "because that's where the keys live",
   on the false premise that main could not do NIP-44. Verified @noble/curves+ciphers+hashes
   ARE present and a sibling had already written main-process NIP-44. Reversed; one
   implementation, not two.
2. **Four private copies of one contract.** Three agents each locally copied ScenarioStep under
   three different names; structural typing hid it and it would drift the moment the contract
   gained a field. Converged onto `scenario-contract.ts`.
3. **An off-by-one import.** build-workstation used `../../../git/runner` from
   `src/main/communications/workstation/`, which resolves to `src/git/` — verified nonexistent;
   correct is `../../git/runner` -> `src/main/git/runner.ts` (present). Diagnosed and sent
   rather than left to a debug cycle.

---

# EVENT-KIND REGISTRY (audited 2026-08-18 — nothing enforces this centrally)

build-canvas flagged a real cross-agent hazard: parallel families each pick Nostr event kind
numbers, and NOTHING in this codebase enforces uniqueness. A silent collision would mean two
features writing into each other's data with no error anywhere.

Orchestrator audit across every new family directory — NO COLLISIONS:

    0, 1, 2, 3, 7, 9            pre-existing NIP-01 / chat
    9030-9036                   relay admin events
    10002, 13534, 13535         relay/membership snapshots
    22242                       NIP-42 AUTH (relay-auth.ts)
    24200                       agent observer frames  <-- see note
    30078, 30622                settings / DM visibility
    39000, 39002                channel metadata / membership
    41010                       DM provisioning request (relay-dm.ts)
    45001, 45003                messages / thread replies
    1111        NEW  canvas     global notes. Deliberately NOT kind 1: kind 1 is already
                                overloaded for in-channel chat (always h-tagged) and
                                RelayFilter has NO tag negation, so a global-notes query on
                                kind 1 would silently return every channel message.
    30011       NEW  canvas     channel canvas, addressable by channel id (d tag)

**24200 appears in two families and that is CORRECT, not a collision:** `agents/` DEFINES it
as the observer-frame kind; `canvas/` only REFERENCES it as a value in save-subscription
fixtures ("archive events of this kind"). Definition vs reference — compatible.

**Standing rule:** before any family claims a NEW kind, grep every literal `kind` across
`src/main/communications/**` and `vendor/buzz-desktop/src/shared/api/dobiusCommunications.ts`
and add it to this table. Canvas did exactly that unprompted and listed its full audit — that
is the bar.

# build-canvas — 19/19, 58 tests, exit 0 (orchestrator-verified)

Storage decided per "is this meant to be seen by others":
- canvas + notes -> RELAY (shared, signed, durable)
- channel templates + save subscriptions -> LOCAL JSON (private preference), single-array file
  with atomic tmp-then-rename, deliberately NOT one file per record — which also removes the
  path-traversal surface a per-record filename would create (dedicated test).

Stub audit: the `return []` hits in canvas/ are guard clauses inside validation/parsing
helpers, not stub handlers. Genuine implementations.

---

# STATE SNAPSHOT — 2026-08-18, integration landed (orchestrator-verified)

    dispatch cases wired    57  ->  171
    bridge allowlist        19  ->   80
    family backends                  11 directories
    scenario fixture files            7

    GATE: PASS 98 | UNIMPLEMENTED 63 | SHAPE_FAIL 0 | ERROR 73 | SKIPPED 24, exit 0
    regressed: ['discover_acp_providers'] (unchanged, the known Electron-only one)
    PASS at session start: 52  ->  now 98

No regressions at any point across ~114 wired cases.

## Two SAFETY items found by agents, both real, both actioned

### 1. The suite could write to the owner's REAL ~/.dobius/
`participant-identity-store.ts:53`, `agent-participant-identity-store.ts:27,56` and
`event-archive-store.ts` use `join(homedir(), '.dobius')`, bypassing Electron userData.
`~/.dobius/` exists on this machine with real files (agent-hooks/, agents/, asana-token.enc).
The harness isolates `app.getPath('userData')` but NOT `os.homedir()`.

So any scenario reaching `ensureParticipantIdentity()` would read or CREATE the owner's real
Communications signing identity. build-identity flagged it at the top of its scenarios file;
build-agent-lifecycle deliberately accepted a failing fixture rather than risk it. Their
caution was the ONLY thing preventing it — not a safety model.

Fix assigned: mock `os.homedir()` in the harness like userData already is, PLUS a guard that
fails loudly if any run resolves a real-home path. Explicitly instructed NOT to relocate the
stores — `~/.dobius/` is this app's established convention (agent-hooks, agents, asana-token
all live there), so the stores are following it; moving them would orphan the owner's identity.

### 2. `randomHexPubkey()` is not a valid key — INTERMITTENT crypto failures
`scenario-contract.ts:120` returns `randomBytes(32)`. A secp256k1 x-only pubkey must be an
on-curve x-coordinate; ~half of random values are not. Fine as an opaque identifier, fatal
when fed to real NIP-44 ECDH — producing "bad point: is not on curve" on roughly half of runs.
A flaky crypto test is the most expensive false signal there is: blamed on the crypto, then
timing, then "retried", while the real cause hides. Fix: add `randomValidPubkey()`/
`randomKeypair()` derived via `schnorr.getPublicKey(sk)`, and rename/doc the existing helper.

## The blocker that mattered most: registered for tests, broken in the app

integrator found the new RPC methods are absent from `src/main/runtime/rpc/methods/index.ts`
(only TEAM_METHODS registered). Every case it wired for agent-lifecycle, huddles, native-ux and
identity dispatches to a name the REAL runtime does not know — the user clicks the button and
gets `method_not_found`, while the gate reads green. Not a testing gap; the feature broken in
production. Assigned back with a required THREE-WAY AUDIT: bridge allowlist (80) vs RPC
registry vs actual exported implementations. A name in one list but not the others is either a
dead button or an unreachable feature.

## ERROR breakdown (73) — mostly instrument, not product

     45  method_not_found — harness dispatcher + real registry gaps (both assigned)
     19  rejected the empty `{}` fixture — needs a scenario (composer split assigned)
      5  commands CORRECTLY refusing ("Dobius does not install external agent runtimes",
         "...no separate relay-mesh runtime", "...agents are local to this device")
         -> expected-error verdict assigned so honest refusals stop counting as failures
      3  harness runtime stub gaps (selectClaudeAccount / refreshAccountsForMobile /
         listMobileSpeechModels) — SPOT-CHECKED BY ME: all three are real methods in
         dobius-runtime.ts; `makeUnconfiguredRuntimeStub()` implements only getRuntimeId()
         by design. Harness wiring, not invented code.
      1  navigator.mediaDevices undefined headless (huddle audio devices) — expected

## Agent conduct worth recording

- build-identity found and fixed a REAL PRE-EXISTING bug while chasing flakiness:
  `os.userInfo()` throws ENOENT in this sandbox, inside `generateIdentity()`. Added a
  fallback + 2 regression tests. Also strengthened the IPC fix beyond spec —
  `ipcMain.once` -> `ipcMain.on` + manual removal, so a forged message cannot consume the
  one-shot listener the real submit needs.
- build-agent-lifecycle, asked directly whether three runtime methods were invented, answered
  with file:line evidence that they are real. Spot-checked: accurate.
- Both agents refused to proceed into the homedir hazard and reported instead.
