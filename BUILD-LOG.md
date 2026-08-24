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
