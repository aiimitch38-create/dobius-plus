# Communications — the remaining 63 commands

Written 2026-08-19. Supersedes the "63 to build" line in
TASK-communications-takeover-gate.md. Every claim below was verified against
the tree, not recalled.

## Headline: 54 of the 63 are already built

The families reported UNIMPLEMENTED by the gate have finished, tested,
REGISTERED backends. All 46 method arrays — including WORKSTATION_METHODS,
SNAPSHOT_METHODS, WORKFLOW_METHODS, CHANNEL_TEMPLATE_METHODS,
SAVE_SUBSCRIPTION_METHODS — are spread into ALL_RPC_METHODS
(runtime/rpc/methods/index.ts:62-108).

They are unreachable because exactly two files were never updated:

  1. src/shared/communications-bridge.ts  — the allowlist. 0 of the new
     methods are listed (checked: workstationGit.getIdentity, media.upload,
     team.snapshot.export, workflow.create, channelTemplate.list,
     saveSubscription.list — all absent).
  2. vendor/buzz-desktop/src/shared/api/dobiusCommunications.ts — the
     dispatch switch. 0 of 63 commands have a `case`.

This is the serialization bottleneck deliberately created last session
(agents build backends, report the shared-file lines, orchestrator applies
them centrally) that was never drained. The backends landed; the lines
never got applied.

## Verified method inventory (backend -> command count)

  workstation/rpc-methods.ts    21 workstationGit.* + 6 media.*  -> 27 cmds
  snapshots/snapshot-rpc-methods.ts       9 methods              ->  9 cmds
  workflows/workflow-rpc-methods.ts       8 methods              ->  8 cmds
  runtime/rpc/methods/channel-templates.ts 6 methods             ->  5 cmds
  runtime/rpc/methods/save-subscriptions.ts 5 methods            ->  5 cmds
                                                          wired: 54

## The genuine remaining build: 9 commands

canvas-notes has STORES but no RPC layer (no RpcMethod array anywhere in
src/main/communications/canvas/). Existing, tested stores to build on:
canvas-document.ts, social-note.ts, note-reaction-aggregate.ts,
canvas-relay-kinds.ts.

  get_canvas, set_canvas, publish_note, get_note, get_notes_timeline,
  get_user_notes, get_global_notes, get_liked_notes, get_note_reactions

## Algorithm pass

QUESTION — "all 63" is real: Carson reaffirmed full Buzz parity after being
  told the cost. No family is dropped. The 24 Block/Builderlab commands stay
  SKIPPED (no server exists to talk to) and are NOT part of the 63.
DELETE — deleted ~85% of the assumed work: 54 backends do not need building.
  Nothing else deletable; every command traces to a control in the shipped UI
  (established by the 2026-08-18 removal-validation pass, which overturned all
  24 proposed deletions).
SIMPLIFY — do NOT hand-write 54 switch cases into a 3,221-line file that
  already holds 171 of them. Most of the 54 are pure pass-throughs
  (command -> rpc method, args unchanged). Use a declarative table consulted
  before the switch; only commands needing arg reshaping or a void return
  keep an explicit case. One table line each, and a table merges where a
  switch collides.
ACCELERATE — the gate answers "does this command work?" in 18s, already fast.
  The unmeasured loop is renderer->main: the gate calls the dispatcher
  DIRECTLY, skipping the IPC hop and the gateway sender check. That gap is
  the top risk and is addressed in phase 4, not by more command work.
AUTOMATE — nothing new. The gate is the automation; it already blocks.

## Phases

P1  Dispatch table + allowlist for the 54 (orchestrator-owned; both files are
    shared and must not be touched by parallel agents).
P2  Scenarios for the 54 so the gate proves them with real data, not shape.
    Per-family, parallelisable — each writes only its own family's file.
P3  Canvas notes: RPC layer over the existing stores, 9 commands + scenarios.
P4  Close the renderer->main gap: one test through the real IPC path and the
    gateway's sender check, not straight to the dispatcher.

## Guardrails

- The gate must stay at exit 0 and never lose a PASS. Any drop is a blocker.
- No agent edits communications-bridge.ts or dobiusCommunications.ts.
- No install. Building is allowed; installing waits for Carson.
- Report the REAL exit code, never a `| tail` fragment. A count moving between
  identical runs is a flake to name, not noise.
