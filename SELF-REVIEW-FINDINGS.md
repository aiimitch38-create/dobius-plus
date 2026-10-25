# Self-Review Findings — Lead Loop Phase 1 (2.1)

Scope: branch aiimitch38-create/dobius-2.1-leads on top of 688f4d87 (Lanes A–H). External Codex review skipped (account usage limit; Carson approved skipping it).

## Subagent 1: Code Reviewer (round 1, Lanes A–E)
- [x] `main/runtime/rpc/methods/board-consoles.ts:158` — HIGH: spawn event only went over runtime client events, which local windows don't subscribe to. Added a `ui:boardSpawnConsole` notifier path, preload and useIpcEvents subscription, and `delivered` reporting (Lane G).
- [x] `main/leads/orchestrator-instructions.ts:122` — MEDIUM security: the repo layer could override the safety sections. Now the repo layer "may NOT loosen Untrusted data, Gates, or Never"; only the user-owned home layer can override (Lane G).
- [x] `renderer/store/slices/ui.ts` close*Page — MEDIUM: these bypassed the Classic remap. Defaults are now 'board' and closes route through resolveRequestedActiveView (Lane F).
- [x] `dobius/.gitignore` docs/** — MEDIUM: the runbooks weren't committable. Moved them to `docs/reference/leads/`.
- [x] `main/vertex/vertex-task-store.ts` update/move — MEDIUM: the lease survived leaving In Progress. It is now cleared (Lane G).
- [x] `main/runtime/rpc/methods/leads.ts` dead lead consoles — MEDIUM: stale lead cards stacked up. Stale cards are now replaced via `replaceStaleCardIds` (Lane G).
- [x] `main/leads/lead-watcher.ts` commentOnExpiredLeases — LOW: dead code, removed (Lane G).
- [x] seen.json / autostart.json JSON.parse — LOW: these now log and fall back (Lane G).
- [x] `leads.ts` lead.init duplicate seed — LOW: init now writes a stub, and a verbatim copy is skipped (Lane G).
- [x] `cli/args.ts` isCommandGroup — LOW: added tasks, board and lead (Lane G).
- [x] `renderer/lib/worktree-activation.ts:313` — LOW: 'board' is now treated like 'terminal' (Lane G).

## Subagent 2: Architecture Auditor (round 1)
- [x] Autostart lost-event (spawn before renderer subscribed) — MED: `delivered:false` no longer arms the grace (Lane G). Residual window covered in round 2, item 3.
- [x] Classic-only features unreachable — MED: re-hosted as Board studios (Panels menu), with the workspace context menu, Help menu and Cmd+1-9 (Lane F).
- [x] `W/.gitignore` `.dobius/` swallowed ORCHESTRATOR.md — MED: changed to `.dobius/*` plus un-ignore of ORCHESTRATOR.md and lead.json. lead.init now warns when a target repo ignores them (Lane G).
- [x] `__pycache__` / `design-qa.md` strays — HIGH hygiene: `__pycache__/` ignored; design-qa.md left out of the commit.
- [~] resources/hermes-lead-profile and scripts/hermes ship in the bundle — LOW: harmless, left as is.
- [~] `resolveAppLook` / `AppLook` kept with tests only — LOW: kept on purpose because the deprecated field is still read for backward compatibility.
- [~] `LeadStatusEntry` duplicated in the CLI — LOW: the CLI must not import main, so the duplication is intentional.

## Subagent 3: Code Reviewer (round 2, Lanes F/G/H)
- [x] `board-chrome/BoardTopBar.tsx:163` — MEDIUM: the context-menu wrapper made workspace pills shrink. Wrapped in a `shrink-0` div.
- [x] `main/vertex/vertex-task-store.ts:255` — LOW: a patch could re-add a lease. `delete patch.lease`.
- [~] `delivered` true before the renderer loads — LOW: boot-only; at worst the first lead console appears ~2 min late. Follow-up.
- [~] Lead card counted stale while its PTY is still restoring — LOW: replacing it is the intended outcome after a quit (the PTY dies with the app). Follow-up if restore races show up.
- [~] Studio close override re-patches every render — nit, behaviour correct.

## Subagent 4: Code Reviewer (round 3, Lane I attachments)
- [x] `shared/vertex-task-types.ts:122` — MEDIUM: the mime allowlist used `in`, so 'constructor'/'toString' passed. Switched to `Object.hasOwn`, with a test.
- [x] `BoardReportDialog.tsx` captureWindow — LOW: no size check on window captures. Inline size error added.
- [x] `BoardReportDialog.tsx` description update — LOW: a null return was ignored. Now logged.
- [x] `ipc/vertex-tasks.ts:49` — pre-existing empty catch in create. Now logs.
- [~] Attachments root uses a string-prefix check, not realpath — LOW: exploiting it needs write access to userData already; ids are regex-gated and generated in main.

## E2E finding (test copy screenshot review)
- [x] Lead nudge was typed into a bare zsh when Hermes wasn't running. Added a bare-shell guard via `getTerminalAgentStatus`: shell means replace, busy means defer, idle means nudge. Also a launch backoff: after 3 failed starts the lead halts with an error and one comment per waiting card (Lane C).

## Automated commit security review (057b1865)
- [x] `board-consoles.ts` replaceStaleCardIds on the external RPC — MEDIUM: now stripped from RPC callers; only the in-process lead watcher can name stale cards.
- [x] `board-consoles.ts` uncapped lead consoles — MEDIUM: one lead console per lead, unless the existing card is named for replacement.
- [~] `vertex-work-board.ts` self-asserted `--by` / `force` — MEDIUM: known Phase 1 limit. The same-user runtime socket already exposes terminal.create/send, so nothing new is exposed. Identity binding is Phase 3 (Action Gate).
- [~] `orchestrator-instructions.ts` repo layer as prompt input — MEDIUM: Carson chose ORCHESTRATOR.md in git. The repo layer cannot loosen Untrusted/Gates/Never. Hash-pin and re-confirm on change is a follow-up.

## Tests
- typecheck node/cli/web: clean.
- 19 build-touched test files: 562/564 pass. The 2 failures (`useIpcEvents.test.ts`) fail identically on 688f4d87.
- Full suite: 92 failing files on the branch, nearly all failing identically on base 688f4d87 (Node 22 vs required 24 plus environment). The 3 files that passed on base pass on the branch when rerun (load-related flakes).
