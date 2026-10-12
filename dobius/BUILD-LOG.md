# Build Log

## 2026-07-08 — Wiring: Asana -> Crew -> verify -> draft-back (W1-W4)
- W1 (9d633cc): in-process `dobius` MCP tool server — agents get app-powers (asana_draft_comment/read_knowledge/list_crew/crew_status/file_briefing_item) with NO shell; draft-only proven (no network import). W2 (4f66cd2): Asana notes + the single human-gated write path (approveDraftAndPost -> POST /stories, only from the Approve click). W3 (5c9efa0): the auto-mode poller — edge-detect + claim-once ledger (no double-run), untrusted-notes sanitizer + unspoofable sandbox, triage agent (tools-only), dead-letter after 2 fails. W4 (c2e9bfb): dispatch_build live via a registry reaching only createManagedWorktree (non-destructive), full build/review/vague triage split.
- Research-driven (107-agent verified deep-research + 2 scouts): routing is deterministic (assignee-GID lanes), LLM only briefs; ack=claim-lock; draft-first; injection defense is layered AND the draft-only/hard-rail gates survive a successful injection.
- Every phase: codex wrote, code-reviewer + Claude verified, unit-tested (hard rails, sanitizer, ledger, single-write-path, traversal), installed, committed. Fixed a real shipped crash in the other session's Knowledge feature (resolve-zoom-target missing 'knowledge').
- Deferred W5: autonomous verify pipeline + self-repair + receipt assembly.
## 2026-07-07/08 — The Crew: full agentic agents platform (feat/agents-page)
- Five phases, each codex-written + Claude-reviewed + installed + live: P1 identity files/memory/session resume (a7dd1a2), P2 heartbeats/structured verdicts/briefing/ping budget (11ddd83), P3 decision queue/hard rails/notification bell (f8d59ed), P4 iMessage channel with trifecta guards (87539e4), P5 terminals-in-roster/Live pulse/project picker/skills (63cea63).
- Review pipeline caught 12+ real bugs pre-ship, incl. a path-traversal hole, silent legacy-prompt replacement, heartbeat windows silently skipped past the concurrency cap, 3 hard-rail bypasses, a zero-reply channel path, and a cross-repo navigation bypass.
- Also: auto-updater finally disconnected from upstream dobius (2ac01cd) after it swapped the installed bundle with a stale artifact.
- Design source: plans/crew-prototype.html (interactive) + plans/CREW-DESIGN.md (research synthesis: OpenClaw autopsy, mission-control UI survey, SDK ground truth).

## 2026-07-06 — Agents page (feat/agents-page, bd5957a)
- Custom agentic agents via @anthropic-ai/claude-agent-sdk 0.3.201: full-page Agents view + titlebar Bot button; create/edit agents (prompt, model, tools, cwd, bypass opt-in); headless runs with live IPC streaming; run history (50, persisted); vault tab relabeled "Sessions".
- Written by codex, reviewed by Claude (code-reviewer subagent): fixed abnormal-EOF-marked-success, concurrency-cap TOCTOU, cancel/result status race, duplicated view union.
- Lesson: electron-vite leaves the SDK EXTERNAL (`require` at runtime) — repack must copy `@anthropic-ai/claude-agent-sdk` + `claude-agent-sdk-darwin-arm64` (dereferenced) into the tree and asarUnpack both (SDK spawns its vendored `claude` binary; can't run from inside asar).
- Lesson: `pkill -f "Dobius+.app"` never matches — `+` is a regex quantifier. Use `Dobius[+][.]app`.
- Verified: typecheck+build 0; installed; headless SDK smoke run success (1 turn, $0.29) on the managed account.

## 2026-07-06 — Dobius migration stages 0–6 (feat/dobius-migration, ac78bc1)
- Full dobius→dobius rename + service disconnect across 7 staged commits; appId now com.statusdigitalmarketing.dobius-plus (installed, re-signed, data intact). macOS permission re-grants pending user.

## Terminal tear-off (drag a terminal into its own window)
- Commit 6128907 on feat/agents-page (preceded by 540d4e2: per-project instruction files + CLI-skill install rewiring).
- PTY output/exit now broadcast to all registered app render windows (renderer-window-registry); each renderer already demuxes by pty id, so behavior is byte-identical with zero tear-off windows.
- window:tearOffTerminal IPC (validated: tab id + live-pty check) opens a BrowserWindow reusing the main window's webPreferences, loads a terminal-only renderer mode via URL hash (#terminal-tab=...&pty=...). TornOffTerminalRoot seeds a minimal store and mounts the existing TerminalPane so xterm/replay/input use the normal lifecycle.
- Triggers: drag a terminal tab outside the window (dnd-kit onDragEnd, pointer outside viewport) OR right-click the tab -> Open in new window.
- Close of the torn-off window kills ONLY that pty. Re-docking deferred.
- Verify: typecheck 0, build:electron-vite 0, 9 unit tests pass, focused manual review of pty.ts broadcast + window kill + drag hook + mode switch. Installed + relaunched. Live drag test pending screen-recording grant.

## 2026-07-09 — Automation destinations (TASK-8.1)
- Branch `feat/automation-destinations` (off feat/agents-page), commits 0cf35d6, 104dd96, fe92ece.
- Destinations registry (telegram/imessage/system/asana/email) + per-automation notify picker (destination, always/failures-only, ping/brief/full depth) + NOTIFY: block convention in stock templates.
- Verify: typecheck node+cli+web 0 errors, oxlint clean on touched files, 47 automation/destination tests pass (8 new), electron-vite build exit 0.
- Lessons: service.ts sat exactly at the 300-line cap — split into run-notification-delivery.ts + run-final-status.ts; localize-renderer-strings.mjs sweeps the whole repo, revert unrelated wraps before committing; `cmd | tail -1` masks exit codes in && chains.
- Pre-existing branch failures NOT absorbed: agent-runner.ts max-lines, localization-coverage on untouched files.

## 2026-09-24 — BUILD-001 fail-closed "Pause crew" execution gate (stabilize/001-global-execution-gate)
- Fixes #1 (autonomous paths ignored pause) and #2 (unreadable pause file unpaused + got overwritten). Plan: plans/REPAIR-BUILD-001-execution-gate.md.
- Verified: typecheck exit 0; targeted suites 98/98; full-suite failures (85 files) pre-exist on parent b5c66cf5 except one flaky hermes test (3/3 green alone). Code-reviewer subagent: no findings.
- Lesson: run `oxfmt` only on files you edited and re-check the diff — it reformats untouched lines and globs (`*.test.ts`) pull in unrelated files.

## 2026-09-25 — Stabilization program: 49 of 50 builds merged on stabilize/integration (not installed)
- Scope: 123-bug audit (docs/stabilization/EXECUTION-ORDER.md) → 50 builds plus follow-ups 003B, 009B, 009C, 009C2, 014B, CX12 (Codex review fixes), SBX (Claude Agent SDK sandbox). Each build: own worktree/branch from integration, plan at plans/REPAIR-BUILD-*.md, targeted tests with fail-without/pass-with mutation checks, independent reviewer subagent (security builds 2-5 rounds), then --no-ff merge with typecheck + targeted tests.
- Integration tip after BUILD-049: 0d613dd6. Diff vs program base b5c66cf5: ~1200 files.
- Verify: typecheck 0; `pnpm run lint` 0 (shrink-only baseline, BUILD-049); verify-localization-catalog 0; full vitest suite on 049 branch: 2923 files pass, the only failure not in the pre-program baseline is run-verification.test.ts (needs port 3300 held by the live app); 2 baseline files now pass. Dry `pnpm run build:unpack` exit 0: bundle manifest pass, 2.0.0 (build 1), sealed BUILD-PROVENANCE clean, codesign --strict pass. NOT installed (Carson's instruction: install only on his explicit go).
- Blocked: BUILD-031 (ADAM has no check-only handshake route). Deferred with reasons: N7, X10, X11.
- Codex: waves 1-2 reviewed (8 findings → CX12/022/032/019); wave-3 review cut off by usage limit (2 leads fixed in BUILD-027); final whole-program review scheduled after the 2026-09-26 limit reset.
- Decisions for Carson: stabilize-run/DECISIONS-FOR-CARSON.md (73 items, 11 need action).
- Lessons: a text rail over shell commands is an arms race — enforce at the OS (SDK sandbox) and server (branch protection) instead; security builds need default-deny classification tests, not lists of bad fields; APFS case/Unicode folding (ſ→s) defeats name-based path checks; worktrees nested in the main checkout see every CLAUDE.local.md up the tree; run the localization check on every merge.
