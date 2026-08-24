# Communications Master Plan — own client, no vendor, any-provider harness

Written 2026-08-24. Supersedes TASK-communications-remaining-63.md (its phases
are absorbed here, relocated) and TASK-BUZZ-3 (vendor path abandoned by
decision: we finish OUR client and delete the vendored one).

Every claim below was verified against the tree this session, not recalled.
Sources: git log (comms commits 029dc5a..c4eddd3, Aug 17–19), command-manifest
(258 total: 54 implemented / 180 pending / 24 removed-pending),
src/shared/communications-bridge.ts (allowlist), vendor dispatch switch,
components/buzz/native/* (our client), relay-lifecycle.ts, custom-harness-store.ts.

## Goal

Dobius+ Communications fully working: our own Buzz-style client (vendored Buzz
desktop DELETED), local relay on 3300, and an OpenBot-style harness so ANY
agent provider can join as a first-class participant — with a gateway, policy,
and audit trail on everything agents do.

## Verified starting state

- Installed /Applications/Dobius+.app is from Aug 5. ALL comms code is Aug
  17–19. The installed app has no relay → "Can't reach the relay" + "Home
  feed unavailable" are a stale install, not broken code. (Two independent
  proofs: asar date, and nothing listening on 3300 while the app runs.)
- Relay server EXISTS (relay-server.ts: HTTP + WS, NIP-42 auth, relay-lifecycle
  starts it non-blocking). Not installed, that is all.
- 54 of the remaining 63 commands have REGISTERED, tested backends. They are
  unreachable because the allowlist (src/shared/communications-bridge.ts) and
  the dispatch switch (vendor/buzz-desktop/src/shared/api/dobiusCommunications.ts)
  were never updated. 9 canvas-notes commands have stores but no RPC layer.
- OUR OWN client already exists and is substantial:
  src/renderer/src/components/buzz/native/ — BuzzNativePage, BuzzInboxSidebar,
  BuzzConversationThread, relay-client.ts, channels/messages/profile/typing/
  agent-dispatch. The vendored UI mounts as a sandboxed <webview> guest
  (BuzzWorkspaceHost.tsx) — a separate renderer we do not need long-term.
- Providers TODAY: agent-runner executes exactly two things — the bundled
  Claude Agent SDK and the Codex CLI. custom-harness-store.ts persists
  user-defined ACP-speaking CLI harnesses (Buzz's Harness Catalog concept) but
  NOTHING executes them. That gap is the OpenBot half's core deliverable.
- OpenBot (CopilotKit/OpenBot, MIT) patterns to port: bring-your-own-agent
  endpoint, ONE gateway every action must pass (resolve → policy → audit →
  act), fail-closed policy with named refusals, append-only audit, secrets
  never in transcripts.

## Phase 0 — Prove what exists works (fixes the screen today)

1. Feature branch `feat/comms-hub-openbot` off the current branch.
2. Clean build: `rm -rf out dist` FIRST (NOTES gotcha: stale out/ breaks
   packaging), then the full build; typecheck per learned-dobius-typecheck-configs.
3. Run the communications verify gate; report REAL exit code, no `| tail`.
4. Build + install via build-and-install.sh (it must rm -rf the old .app;
   pkill patterns must escape the plus: `Dobius\+`). Schedule the restart
   with Carson — do not kill the running app unannounced.
5. LIVE VERIFY (learned-proxy-verification): relay listening on 127.0.0.1:3300
   (curl + lsof), home feed loads, connection card green, DM an agent round-trips.

Exit: the screenshot's two errors gone. Everything else builds on a live relay.

## Phase 1 — Wire the 54 built commands (relocated P1+P2 of remaining-63)

The dispatch table now lives in OUR code, not the vendor file (vendor is
scheduled for deletion — do not invest there).

1. NEW declarative table `src/shared/communications-command-table.ts`:
   command -> rpc method, one line per pass-through; explicit cases only where
   args reshape or return is void. Consulted BEFORE any switch.
2. Extend the allowlist in src/shared/communications-bridge.ts with the same
   54 (workstationGit/media 27, snapshots 9, workflows 8, channelTemplates 5,
   saveSubscriptions 5).
3. Orchestrator-owned: NO parallel agent edits communications-bridge.ts or
   the command table (serialization bottleneck from last session — drain it
   centrally).
4. Scenarios per family so the gate proves real data, not shape (parallel-safe,
   one family file per agent).

Exit: gate exit 0, zero PASS lost, all 54 proven over the live relay.

## Phase 2 — Canvas notes: the 9 genuinely-missing commands

RPC layer over the existing tested stores (canvas-document, social-note,
note-reaction-aggregate, canvas-relay-kinds): get_canvas, set_canvas,
publish_note, get_note, get_notes_timeline, get_user_notes, get_global_notes,
get_liked_notes, get_note_reactions. Table + allowlist + scenarios same as
Phase 1. Exit: gate proves all 9 with real data.

## Phase 3 — Close the renderer->main gap (top risk)

One test through the REAL IPC hop and the gateway's sender check — not
straight to the dispatcher (today's gate skips both). Add a relay health
surface: the "Can't reach the relay" card must say WHY (not started / port
taken / auth failed) — relay-lifecycle already swallows bind errors by design,
so surface the stored reason instead of a generic message.

Exit: integration test green through IPC; failure card names its cause.

## Phase 4 — Own-client cutover, DELETE the vendor

1. Parity checklist against the native client (BuzzNativePage + native/*):
   identity onboarding, channels, DMs, threads, mentions, reactions, unread,
   typing, presence, search, media upload/render, agent create/edit + DM,
   huddles (join/mute at minimum), stack-down fallback.
2. Cut the Communications view over to the native client only. Remove
   BuzzWorkspaceHost webview path, the guest partition registration, guest
   gateway sender, and the vendor UI loader/serve path.
3. `git rm -r dobius/vendor/buzz-desktop` (400 MB, 5,356 files) + remove its
   build entries and any vendored-license markers; keep an upstream pointer
   (block/buzz, Apache 2.0) in docs for attribution.
4. Gate: verify suite green with vendor gone; `grep -r buzz-desktop` zero
   references; typecheck + lint clean; build + install + Phase 0 live checks.

Exit: repo has exactly ONE client. No guest renderer to police later — this
is why the OpenBot half comes after this phase.

## Phase 5 — OpenBot half A: any-provider harness

1. `AgentProvider` seam (src/main/communications/providers/): one interface —
   launch, send, stream events, cancel, status — with two real impls first
   (ClaudeAgentSdkProvider, CodexCliProvider) wrapping what agent-runner
   already does. Behavior-preserving move, existing tests stay green.
2. Promote custom-harness-store records from CRUD-only to EXECUTABLE: a saved
   harness (label + command + args + env, ACP-speaking CLI) becomes a
   CustomHarnessProvider. This is the "any provider" promise, OpenBot's
   bring-your-own-agent equivalent. Validate command/args (no null bytes —
   repo rule), store env write-only.
3. Identity: every provider instance binds a Nostr keypair participant via
   agent-participant-identity-store (exists) so it appears in channels/DMs as
   a member with its own audit trail — Buzz's model.
4. Harness catalog UI already exists; wire its rows to real launches + status.

Exit: DM a Claude agent, a Codex agent, AND a custom-harness agent from the
same channel; all three reply under their own identities.

## Phase 6 — OpenBot half B: gateway, policy, audit

1. GATEWAY — one choke point for agent ACTIONS requested through comms:
   resolve target -> evaluate policy -> write audit row -> execute -> record
   outcome. No code path acts without a row existing first (OpenBot rule).
   The agent-decision-approval-bridge (exists) becomes the human-approval
   arm of this.
2. POLICY — fail-closed, declarative first: rules over {agent, tool family,
   channel, action}; deny evaluated before allow; missing policy permits
   nothing; a broken rule REFUSES and names itself. Ship JSON rules; richer
   expressions later, only if needed.
3. AUDIT — append-only table via the SyncDatabase pattern (node:sqlite, mirror
   runtime/orchestration/db.ts): who/what/target/decision/rule/outcome/event
   id (link to the signed relay event). Refusals carry the rule name. New
   Audit view in Communications. Secrets redacted: record that a secret was
   used, never its value.
4. Policy + audit live UNDER the provider seam, so all three provider types
   from Phase 5 are governed with zero extra code.

Exit: an agent action attempted -> policy decision visible -> audit row
present -> refusal (if any) names its rule. Proven by gate scenarios.

## Phase 7 — Multi-agent end-to-end scenarios

Over the live relay, through real IPC: (a) human DMs each provider type;
(b) two agents coordinate in one channel via mentions; (c) risky action hits
policy -> approval bridge -> human approves/denies -> outcome recorded;
(d) audit view shows the full trail. Extend the existing gate; exit 0, no
PASS lost. Then Done Bar: push, PR, review-audit, build+install, live
ship-check with Carson.

## Guardrails (carried forward)

- Gate stays exit 0; any lost PASS is a blocker. Report REAL exit codes.
- No agent edits communications-bridge.ts / command table (orchestrator-only).
- Install steps scheduled with Carson; never kill the running app unannounced.
- 24 Block/Builderlab commands stay SKIPPED (no server exists). Not in scope.
- Micro-task cycle per phase: PLAN -> IMPLEMENT -> VERIFY -> REVIEW -> COMMIT
  -> GATE -> LOG (BUILD-LOG.md + LESSONS-LEARNED.md on failure x2).

## Risks

- Vendor deletion before parity = feature regression. Gate: checklist in
  Phase 4 step 1 must be checked, not assumed.
- The 3,221-line dispatch switch has 171 existing cases; the table must merge
  with, not duplicate, them during transition.
- Policy too strict -> agents refuse legit work; refusals always name the rule
  so tuning is obvious.
- Relay bind failures are silent by design; Phase 3 makes them visible.
- 400 MB vendor deletion is unrecoverable from git if uncommitted — commit it
  as its own commit BEFORE deletion so revert is trivial.

## Order rationale

Fix-what-exists first (Phase 0 proves the two-thirds-done work with one
install). Wire + finish commands next (Phases 1–3) so the client has full
functionality to absorb. THEN cut to one client and delete the vendor
(Phase 4) — the OpenBot gateway/policy/audit (Phases 5–6) is far easier and
safer with exactly one client and one dispatch path, no guest-renderer bypass
to police.
