# TASK B2 — Run-adoption gate: route every managed run through ADAM

**Status:** SPEC READY. Not started. No build/install/push without Carson's go.
**Slice of:** `plans/DOBIUS-AGENTIC-BUILD-PLAN.md` Tier B (foundation). This is the vault's
#1 blocker ("Dobius agents can act without asking ADAM first").
**Base:** branch off `stabilize/codex-final-fixes` (the installed reality), own worktree.
**Grounding:** verified against ADAM + Dobius source 2026-09-30 (see file:line anchors below).

## Why (one line)
`dispatch_build` already asks ADAM's `/v1/context-handshake` before running; `startAgentRun`
does NOT — so Asana triage, heartbeats, channel runs, Voice Conductor and Kanban dispatch all
write without ADAM's authorization. This slice extends the existing, shipped gate to those paths.

## What already exists (do NOT rebuild)
- ADAM probe `POST /v1/context-handshake` is LIVE: bearer + `{worktreePath, intent, readinessLevel?}`
  → `200 {projectId, digest, toolPolicyTier}` or `403 {code, reason}`, zero side effects
  (`ADAM/service/src/projects/handshake.ts:111-177`, `runtime/service.ts:512-535`).
- Dobius gate `checkBuildDispatchAdmission(repoPath)` (pause → ADAM handshake → pause) exists and
  is tested with a fake ADAM server (`dobius/src/main/agents/execution-gate.ts:169-182`,
  `execution-gate-adam.test.ts`). Wired ONLY into `agent-tools/dispatch-build-handler.ts:131`.
- `startAgentRun` today calls only `assertExecutionAdmitted(origin)` = pause-check
  (`agents/agent-runner.ts:305,370`). `AgentRunContext` already has the slots:
  `{correlationId, adamJobId?, adamTaskId?, projectId?, worktreeId?, requestedBy?}`
  (`shared/agents.ts:113-120`). ADAM already keys ingested events by `context.projectId`
  (`ADAM/service/src/events/ingest.ts:30`).
- **Do NOT edit `config/project-registry.yaml`** — reconciled evidence, ADAM-owned.

## Acceptance criteria (all verified derivable from repo text)
1. `startAgentRun` for every origin EXCEPT manual `agents-page` calls the ADAM admission check
   (reuse `checkBuildDispatchAdmission`, or a sibling `checkRunAdmission`) after the pause check at
   `agent-runner.ts:305` and again after `prepareClaudeLaunch` at `:370` — same order as
   `execution-gate.ts:173-181`. Manual `agents-page` runs stay pause-only.
2. On admit, set the run's `context.projectId` from `contextPack.projectId` and a `contextDigest`
   from `contextPack.digest`; both appear on every `agent.run.*` event to `/v1/events/ingest`
   (add `contextDigest` optional to the Dobius event builder AND ADAM `DobiusEventSchema`
   `events/ingest.ts:13-20`).
3. Refusal path: a run into an unregistered / `read_only` / `disabled` / unverified path throws an
   `ExecutionBlockedError`-class error with ADAM's refusal code BEFORE `query`/spawn — no `AgentRun`
   stored, no capacity slot reserved.
4. ADAM offline/unreachable → BLOCK autonomous runs (mirror BUILD-031's recorded default and the
   `adam-unavailable` message text).
5. Tests (per `docs/stabilization/TEST-PLAN.md` ground rules): fake ADAM via
   `http.createServer` on 127.0.0.1, temp userData, NO live systems, NO paid calls. Each new test
   must FAIL on the base branch without the fix and PASS with it. Mutation check: replacing the ADAM
   call with `{allowed:true}` must fail ≥1 test.
6. **Out of scope this slice** (deferred — gated on the Day-1 kernel spec #12 and testing-latitude
   #35): ADAM session-registration/lease route, `.dobius/context/current.json`, env-var delivery,
   the `context_blocked` state, readiness-level threading. Do NOT build these now.

## Micro-task cycle (each task: PLAN → IMPLEMENT → VERIFY → REVIEW → COMMIT → GATE → LOG)
- **B2.1** Extend the admission check to `startAgentRun` for non-manual origins (criteria 1, 3, 4).
- **B2.2** Thread `projectId` + `contextDigest` onto the run context and run events (criterion 2).
- **B2.3** Tests for both, per criterion 5 (fail-without-fix proven; mutation check).

## Per-phase review (Carson's standing rule)
After each task's IMPLEMENT, run **Codex review** (read-only) on that task's diff before COMMIT;
apply valid findings. Then `review-audit` on the whole slice before the PR. Codex model: `gpt-5.5`,
recipe per `learned-codex-exec` (homebrew binary, `-m gpt-5.5`, stdin, `-s read-only`).

## Guardrails
- Branch off `stabilize/codex-final-fixes`, own worktree; never touch `.claude/worktrees/integration`.
- Security-critical (this is the authorization gate) — minimal diff, no unrelated refactors.
- Deny-zone stays Carson + Sam. No push/merge/deploy/install without Carson's go.
- `pnpm typecheck` + `oxlint` clean on touched files; existing tests green vs baseline.

## Done bar
All 3 tasks committed with Codex applied; new tests fail-without-fix + pass-with; typecheck/lint
clean; slice opened as a small PR to the fork for Sam. No install without Carson's go.
