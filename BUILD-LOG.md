# Build Log

## 2026-07-30 — Buzz tab + Buzz app skin (feat/buzz-skin)
- Cloned github.com/block/buzz, traced its design system (theme.css + tailwind.config).
- New Buzz tab in the sidebar opens a recreation of the Buzz workspace UI (BuzzPage.tsx).
- New Buzz App Skin repaints all of Dobius+ with the Buzz gradient look (buzz-skin.css).
- typecheck 0, oxlint 0, app-skin tests 6/6. 16 pre-existing hook-test failures confirmed unrelated (fail on clean tree too).
- Verified in dev app via CDP screenshots, light + dark. Committed locally; not pushed (local-first).

## 2026-07-30 (late) — Buzz Phase 0 complete
- All 4 wiring reports delivered + saved to Docs/Buzz-Takeover/wiring-reports/ (relay core, ACP harness, agent toolkit, UI shim surface).
- Colima + Docker up; buzz fork cloned to ~/Projects (Code)/buzz (remote=upstream); just setup green (postgres/redis/minio healthy, migrations applied).
- buzz-relay compiled (6m19s) and running detached on port 3300 (3000 was pocket-cologne preview — left untouched). RELAY_URL=ws://localhost:3300; BUZZ_AUTO_MIGRATE=true; using dev signing key (local-only; set BUZZ_RELAY_PRIVATE_KEY before any network exposure).
- Buzz.app launched with BUZZ_RELAY_URL=ws://localhost:3300 — connected, authenticated, posting events (HTTP bridge 200).

## 2026-07-31 — Phase 3 smoke PASSED: first Claude agent live in Buzz
- buzz-cli/buzz-acp/buzz-admin built (3m20s). claude-agent-acp v0.64.0 installed (speaks protocol v1 → legacy framing, works; token-heavier, revisit).
- Agent "Scout" born: key in ~/.config/buzz-agents/scout.env (chmod 600), profile set, created open channel #agent-lab, cwd pinned to ~/dobius/projects/buzz-agent-workspace.
- Harness pool running (respond-to anyone). Tester identity mentioned @Scout; Scout replied in-channel with a real Claude-generated answer including its correct pinned cwd. Text-an-agent loop VERIFIED end to end (verified by reading the actual channel message, not logs).

## 2026-08-24 — Phase 0: comms hub installed and live (feat/comms-hub-openbot)
- Gate 19/19 exit 0; full build green after two env fixes: (1) Swift PCH cache held the pre-move repo path — rm -rf native/computer-use-macos/.build; (2) afterPack verifier flagged node:sqlite (missing from builtinModules on Node 22.22/26.0.0) — allowlisted in config/packaged-runtime-node-modules.cjs; proven safe (installed app already ships it).
- scripts/install-dobius-v2.sh: replaced stale hardcoded REPO (pre-move path) with derived path.
- Installed with daemon UNTOUCHED: PID 1477 before == after; relay LISTENING on 127.0.0.1:3300, /query validates (semantic error = live stack). Lesson: repo moved to .../Dobius/dobius-plus — any hardcoded old path rots (PCH, installer).

## 2026-08-24 — Phase 1: 54 unreachable comms commands wired + proven (method seam)
- Allowlist: +50 methods in src/shared/communications-bridge.ts (workstationGit/media/snapshot/workflow/channelTemplate/saveSubscription families).
- Gateway: handler extracted (createCommunicationsBridgeHandler) so the harness drives the REAL pipeline (trust check + allowlist + dispatcher) — the vendor seam bypassed all of it.
- Harness: ScenarioStep.via ('vendor'|'method'); createGatewayMethodInvoker; electron mock gained honest safeStorage (isEncryptionAvailable:false); node:os homedir mocked to tmp — CRITICAL LEAK FIXED: participant-identity store uses ~/.dobius (real home!), harness was reading the user's live encrypted identity and could have overwritten it with a plaintext test identity.
- 5 new family scenario files (53 steps, 52/55 methods; 3 honestly omitted: checkPipelineHotstart needs un-stubbed runtime, 2 media pickers are GUI). New stricter gate: every method-seam step must PASS — no escape hatch.
- scripts/run-comms-gate.sh: quits app (daemon survives), runs gate on 3300, relaunches; hardens with installer-proven exact-name kill + holder-naming aborts.
- Gate: 21/21 exit 0 (19 vendor-seam + 2 method-seam). typecheck:node exit 0.
- Lessons: capture runs AFTER shapeCheck (set ctx keys in args builders); post-merge 3-dot diffs only show what the target gained; verify/ dir is excluded from tsconfig.node.json so the GATE is its only typecheck — type errors there surface only at run time.

## 2026-08-29 — TASK-ADAM-1.1: shell tool classification and gate (feat/adam-voice-control)
- New `dobius/src/main/jarvis/shell-tool.ts` — pure classification, no execution. `classifyShellCommand(argv, options)` returns `read-only` | `writing` | `denied`.
- Execution model is `execFile` + argv (the `runCli` shape at `agent-context.ts:78`), never a shell. So `>`, `|`, `;`, `&&`, `$(…)` arrive as literal arguments and the whole class of redirection parsing was DELETED rather than defended against. Two tests prove the inertness by side effect: the file `echo hello > /tmp/…` would create does not exist after a real `execFile`, and `; touch` / `&& touch` chain nothing.
- 19-binary read-only allowlist. `osascript` deliberately NOT read-only — "get only" is not decidable from an argv and `osascript -e 'do shell script … with administrator privileges'` is a root escalation, so it is unconditionally `writing`.
- Beyond spec: a binary containing `/` never inherits an allowlist entry by basename, or `/tmp/evil/ls` would pass as `ls`. Denied binaries are still denied by path (`/usr/bin/sudo`).
- Argument scan forces `writing` on allowlisted binaries: find `-delete/-exec/-execdir/-ok/-okdir/-fprint*/-fls`, any `xargs`, any output-file flag. find's `-o` stays read-only — there it is the documented OR operator.
- REVIEW found and fixed a real invariant-B hole: plugin-directory containment was purely lexical, so a symlink pointing at the plugin folder (`cp x.mjs /tmp/notes/x.mjs`) read as harmless in the approval window and still dropped unsigned main-process code into the folder. Now realpaths the token's PARENT (the token is usually a file that does not exist yet) plus `pluginDir`, reusing `resolveEditablePath`'s injectable-`realpath` shape from `self-edit.ts:88`. Test uses a real `symlinkSync` and was verified to FAIL against the old logic before it passed against the fix.
- Carried forward to TASK-ADAM-1.3: argv elements must be coerced with `String(...)` at the IPC boundary — the classifier deliberately does not guard non-string tokens.
- Verified: 62 shell-tool tests; scoped gate 283 passing (221 baseline + 62), exactly one failing file (`attach-main-window-services.test.ts`, pre-existing). Both tsgo configs exit 0. oxlint clean.

## 2026-08-29 — TASK-ADAM-1.2: shell execution and window approval (feat/adam-voice-control)
- New `dobius/src/main/jarvis/shell-command-store.ts` — kept separate from `shell-tool.ts` so classification stays pure and both stay under the 300-line `max-lines` cap. Read-only runs immediately (`execFile`, 30s, 4KB cap, copying `runCli`'s error handling); writing is queued as a `PendingShellCommand`; denied is never queued.
- **Invariant A is enforced structurally, three ways, not just by omitting a tool.** (1) The agent is never told the pending id — `describeForAgent()` returns prose with no id, and the id travels only on the payload to the review window, so a client tool would have nothing to pass. This is the exact opposite of `SelfEditStore`, which hands the agent the id and is why `apply_code_change` is possible there. (2) `runApproved` deletes the entry BEFORE running, so an id cannot be replayed. (3) `jarvis:runApprovedShell` compares `event.sender.id` against the review window's `webContents.id` and refuses anything else — the agent's client tools run in the main window, a different webContents.
- Review window: `self-edit-window.ts` gained `SHELL_COMMAND_PROPOSAL_CHANNEL` + `showShellCommandProposal`, sharing one window and retitling per payload. New `ShellCommandReview.tsx` renders the argv one token per line — a long path after `rm -rf` is easy to skim past on a wrapped line.
- IPC split by WHO IT SERVES rather than by channel: 1.2 owns the human's half (`runApprovedShell`, `discardShellCommand`, `onShellCommandProposal` + preload), 1.3 owns the agent's half (`proposeShell`, client tool, ElevenLabs registration) and runs the WIRING CHECK over both.
- REVIEW found three real defects, all fixed: (1) a test named "caps output" that injected a fake runner and asserted only `kind === 'ran'` — it would have stayed green with the cap deleted; removed rather than repaired. (2) The plugin directory was hand-joined in `jarvis-ipc.ts` while 4.1 needs the same folder in two more places — collapsed to one `adamPluginDir()` definition, the drift failure `agent-context.ts:12-18` warns about. (3) The review window reported "Nothing was run" after a command had already run, because the post-run discard is a no-op.
- **Found and fixed a broken gate**: `AUTONOMOUS-BUILD.md` and `scripts/verify-adam-task.sh` gated on bare `npx vitest run`, which loads NO config — there is no `vitest.config.ts` at `dobius/` root, the project passes `--config config/vitest.config.ts` everywhere. Symptom was intermittent extra failing files in `src/main/window`; real error was `Test timed out in 5000ms` (Vitest default) where the project sets 30_000 for exactly these heavy dynamic imports. Two structural hypotheses were wrong before capturing the error text. Bare: 1 bad run in 6. With config: 4/4 clean. Passing count identical, so no baseline moved. Both files corrected; lesson logged.
- Verified: scoped gate 295 passing (283 + 12), one failing file (`attach-main-window-services.test.ts`, pre-existing). Both tsgo configs exit 0. oxlint clean on all nine touched files.
