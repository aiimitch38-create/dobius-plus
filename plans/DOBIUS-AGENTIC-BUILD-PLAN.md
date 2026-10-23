# Dobius+ Agentic System — Unified Build Plan

**Status:** PLANNING ONLY. No build, no install, no push during this process (Carson, 2026-09-30).
**Author:** Carson + Claude, 2026-09-30.
**What this is:** the single source of truth. It consolidates and supersedes the two companions —
`plans/TASK-DOBIUS-MASTER-BUILD-PLAN.md` (foundation + current state) and
`plans/TASK-LAYA-INTEGRATION.md` (the intelligence layer, 3× Codex-reviewed). Those keep the
granular file:line detail; this is the one to read first.
**Grounding:** a 4-agent deep read of the Obsidian vault (audits 2026-09-16→23, Master Backlog,
Vertex architecture notes) cross-checked against git + logs this session. Code file:line claims
tagged `[Codex-verified]` were confirmed against source in prior Codex rounds.

---

## 1. Current state (verified 2026-09-30 — supersedes the week-old audits)

- **Stabilization COMPLETE.** 50/50 numbered builds + follow-ups merged into `stabilize/integration`
  (tip `a1a82dfc`, 2026-09-25); the 123-bug deep list is addressed (3 deferred with reason);
  lint/typecheck clean per build.
- **2.0.0 build 2 is INSTALLED** (since 2026-09-25) from that branch. "V2 never installed" (ADAM's
  `DOBIUS.md`) is now **stale**.
- **ADAM gate partially closed:** ADAM shipped `POST /v1/context-handshake` (deployed 09-25) and
  `dispatch_build` is gated on it. Agent SDK **sandbox is ON by default**. Obsidian event projection
  is live.
- **Score ~6/10.** Strong daily driver, freshly de-bugged; still short of a *trustworthy* agentic
  system because the deep foundation (registry, durable workflow, context packs, evidence-bound
  "done") is designed-not-built — and the current win is **fragile** (§2).

## 2. URGENT — before anything else (needs Carson's go; no install)

1. **Commit the uncommitted security fixes.** `[Codex-verified 2026-09-30]` `.claude/worktrees/
   integration` is dirty on `stabilize/integration@a1a82dfc` — **27 modified tracked files + 3
   untracked** — exactly in the danger zone (persistence, runtime RPC, sandbox/rails, Asana dispatch,
   CLI dispatch, mobile path guard, voice conductor). These implement the final Codex review's
   6 HIGH + 1 medium fixes. **The installed app was built from this dirty tree** — the fixes exist ONLY
   as unsaved edits. **Method `[Codex]`: review the full diff, INCLUDE the 3 untracked fix files, and
   commit the whole verified fix set in place — do NOT hand-pick from memory.** Commit to
   `stabilize/codex-final-fixes`. **Until then: no `checkout`/`stash`/`restore`/worktree removal on
   that tree — it would delete live production fixes.**
2. **Then the Done Bar for stabilization:** push the branch to the fork, open a PR, Sam reviews.

## 3. The operating principle: foundation before agents

Accepted vault decision (2026-09-17): *no new specialist agents or intelligence until five
foundation capabilities pass an acceptance test.* Laya, the verification floor, and the per-tab
checklist all slot in **on top of** the foundation. The vault's ordered foundation:
`registry/manifest → run adoption (ADAM gate on every path) → event bus/ledger → durable workflow
engine → context packs + write gates → evidence-bound "done" → then intelligence.`

## 4. Target architecture (the whole system in six layers + one shared brain)

**People / authority:** Carson (final sign-off, bottleneck by design) → ADAM (orchestrator,
chief-of-staff, deny-by-default authority) → the crew (agents in tabs). Nothing irreversible below
Carson. ADAM's deny-zone (merge/deploy/spend/force-push/delete/complete-external-task) is Carson +
Sam only. `[Codex] authority.yaml is policy intent, not code-enforced` — so guardrails live in each
consumer's code.

**The six layers** (Vertex = command/OS layer, Dobius = execution engine; decided 2026-09-05):
1. **Domain objects** — Project, Mission, Task, workflow, agent run, artifact, verification, approval.
2. **Command bus** — one named entry per action; replaces every-feature-calling-every-service.
3. **Services** — Dobius execution primitives (terminals, browsers, git/worktrees, agents).
4. **Event bus / ledger** — one writer, ordered + deduped, Obsidian projection (live for agent runs).
5. **Persistence** — the ledger is source of truth; scattered JSON stores consolidate into it.
6. **Views** — Kanban, Command Center, comms, knowledge graph — all subscribers, never state owners.

**The shared brain (Laya) — hub-and-spoke:** ONE Laya model (the open-source twin of "Jev";
`choice`/`score`/`noul`, ~33ms GPU / ~50–200ms CPU+ONNX) on the VPS or GPU host. ADAM and Dobius+
are **thin clients** over HTTP/MCP, each with a **safe fallback** (action-bearing decisions fall back
to the deterministic baseline or escalate to a human; cached hints only for read-only labels,
exact-keyed + short TTL — never stale reuse). SPOF hardening: timeout budget, per-client rate limits
+ queue/backpressure, circuit breaker, version telemetry. `[Codex] Dobius+ calls Laya from
main/preload, never the renderer.` One model only — never three copies.

**The loop that connects it all:** a thought lands (note or message) → Laya turns the actionable ones
into cards → ADAM dispatches a card to a tab → the tab shows that card's checklist on the side, each
item live (senses) → Laya flags "did it actually finish vs silently skip" → the verification floor
confirms the card is really done → card moves to Review → Carson signs off → Done → logged to memory.

## 5. The plan, in tiers

### Tier A — Lock in what's done (low risk; each step gated on Carson)
- A1. Commit the Codex-fix files (§2.1).
- A2. Push + PR the stabilization branch; Sam reviews.
- A3. Close the open `DECISIONS-FOR-CARSON` items: rebuild the phone app (handshake v2 has no
  fallback — old phone app can't connect), rotate the ElevenLabs key, GitHub branch protection on
  `main`, enable husky pre-commit (`core.hooksPath` empty), add an `undo_code_change` client tool.
- A4. Refresh ADAM's stale knowledge (`DOBIUS.md` wrong install/branch facts + stale CLI table,
  `brain/NOW.md` stuck at 2026-08-05, 26-entry `LEARNINGS-INBOX.md`). Fix the `Commits Dobius Plus.md`
  vault feed so it sees `stabilize/*`.
- A5. Unblock the SMID agent (blocked 7 days on a "don't ask mode" permission denial, not OAuth; also
  running on Haiku against the most-capable-model rule).

### Tier B — Foundation (five capabilities; each lands as small PRs to Sam)
- B1. **One project registry + manifest** both brains use (reconcile ADAM's `projects.yaml` with the
  Dobius CLI registry: 20 records, 9 missing paths). Manifest: purpose, risk tier, source roots,
  graph policy, workflow profiles, required artifacts, approval policy, agents.
- B2. **Finish run adoption — close the two-brain gate as a CENTRAL BOUNDARY INVARIANT, not a caller
  checklist `[Codex — key correction]`.** Enforce at the choke points — `startAgentRun()`
  (`agent-runner.ts:296,340,474`, which today defaults context to just `{ correlationId: runId }`) and
  the terminal-write boundary — that **managed runs require ADAM/project/worktree context**, with an
  explicit read-only/manual **unmanaged** mode as the only exception. `AgentRunContext` makes
  `adamJobId/adamTaskId/projectId/worktreeId` optional today (`[Codex-verified]` `shared/agents.ts:113`;
  store reconstruction `agent-runs-store.ts:87`) — make them required for managed work at the boundary.
  Then test every caller (lists rot, so the boundary is the real fix): Asana Auto Mode
  (`asana-auto-mode-service.ts:154`), heartbeat (`agent-heartbeat-service.ts:180`), Claude comms
  (`claude-agent-sdk-provider.ts:33`), Voice Conductor (`conductor.ts:148`), iMessage channel
  (`agent-channel-service.ts:137`), RPC `agent.run` (`custom-agents.ts:140`), Agents-page IPC
  (`ipc/agents.ts:144`), Codex provider (`codex-cli-provider.ts:26`), workflow executor
  (`workflow-executor.ts:60`), CLI dispatch. `[Codex-verified] hooks are observability, not
  enforcement — hook failures return 204 by design (agent-hooks/server.ts:1225,1227)`; the gate must
  be a real write-gate at the boundary, not a hook. `dispatch_build` is already gated — this
  generalizes that to all managed runs.
- B3. **One event bus + ledger** as source of truth (single writer, ordering/dedup, Obsidian
  projection — generalize the live agent-run projection). Consolidate scattered JSON stores.
- B4. **Durable workflow engine** (Temporal-style): typed steps, checkpoints, retry, idempotency,
  cancellation, restart recovery. Fixes the crash bugs: orphaned "running" coordinator row
  (`[Codex-verified]` `orchestration-gates.ts:49,89`), capped 50-record history
  (`agent-runs-store.ts:113,121`), journal replay cap (`agent-run-event-journal.ts:104,115`), Codex
  slot leak, Vertex empty-board overwrite (`vertex-task-store.ts:65,205`). Acceptance = survives a
  mid-run restart.
- B5. **Context packs + write gates** (the vault's 8-step handshake): resolve project/worktree/task,
  Graphy freshness receipt, capability/skill resolution, inject the pack, stale-context invalidation,
  block writes without it. Fail closed for managed work; read-only for discovery.
- B6. **Evidence-bound "done."** No task completes without diff + test output + screenshots + verifier
  result attached; approvals bound to a specific artifact (live DB: 21,135 events vs 33 evidence
  rows, 0 approvals).
- **Foundation acceptance test** (the vault's six-terminal test) must pass before Tier D.

### Tier C — The work model + per-tab checklist (Sam's actual ask)
- C1. **Task / Mission / Project as real domain objects** (nothing else renders until these exist).
- C2. **Kanban is a view, not a system** — renders Vertex tasks off the event bus; Vertex is master,
  Asana a sync target. Fix `[Codex-verified]` that `update(status)` appends (`vertex-task-store.ts:238`)
  while `move()` orders (`:257`) — auto-moves need ordering + audit reason + idempotency.
- C3. **Per-tab to-do checklist = the In-Progress card, zoomed in.** Surface Claude Code's own
  `TodoWrite` items (already flowing through the agent-hooks server) on the side of each tab, each
  item showing the state the app already tracks — working / waiting / **permission** / blocked / done
  (`AgentStateDot`, `smart-attention`). Solves "you told it too many things, it stalled on a
  permission, jumped to the fifth, and you didn't know the first never finished." Not a new task
  system — a second view of the one card.

### Tier D — Intelligence (Laya), ONLY after foundation acceptance
`[Codex] D0/D0b (offline eval + replay) MAY run in parallel with Tier B` — as long as they stay
hermetic (dataset + harness + replay only; no service dependency, no app wiring, no auto-actions).
Everything that *wires into* the app or acts (D1+) still waits for the Tier B acceptance test.
Order from `TASK-LAYA-INTEGRATION.md` (already 3× Codex-reviewed):
- D0. **Phase 0a — offline eval harness (gates everything).** Frozen labeled dataset (log tails,
  cards, verification evidence), scored vs a regex baseline AND a Claude call; confusion matrix;
  per-surface thresholds; fail-open/closed policy. If Laya doesn't beat the baseline, stop.
- D0b. **Offline replay triage report** (no live service).
- D1. **Service contract + threat model**, then **stand up the shared service** (Docker, `/health`,
  auth, version pin, rate limits). Prove the safe fallback first.
- D2. **ADAM client, read-only** — terminal senses + dollar-impact queue ranking. Carson's repo.
- D3. **Data model + audit API** in Dobius+ (small PR): `blockedReason`, `verificationEvidence`,
  `classifierVerdict` (+confidence), and an immutable append-only audit-event API with
  idempotency/race rules.
- D4. **Kanban Blocked *suggestions*** (human confirms) → then smart retry / backlog triage
  auto-moves **only where Phase 0 accuracy justifies it**, audit trail on.
- D5. **Verification floor (flagship), websites first.** Playwright/tests/vision = the eyes (gather
  evidence). **Laya = the cheap filter** (a `score` "looks done?" on every change, deciding whether
  the deep check is warranted). **`review-audit` = the judge** (names the gap on borderline/high-
  stakes). Carson = sign-off. `[Codex] Fail closed on hard evidence` — `tsc`/test failures, HTTP
  500s, console errors fail without Laya; Laya routes up, never suppresses; high-stakes always get the
  deep check. Laya is the router, not the verdict.
- D6. **ADAM's hands** — wire CLI wrappers to the already-existing `/tabSendTo` + `/tabRead`
  (`[Codex-verified]` `dispatch-server.ts:164,195,284`; only `install-clis.ts:107` wrappers lag).
- D7. **Obsidian indexer** (auto-link/file/action-extract, suggestions first) + in-app gate
  auto-resolve (deny-zone excluded).

## 6. Prerequisites (hard gates)

1. **§2.1 committed** before touching the integration worktree.
2. **Evaluation harness** (D0) before any Laya wiring.
3. **Data model + audit API** (D3) before any auto-move or verification storage.
4. **Security before any VPS work:** stale `.claude.json` token backups (#19), `pcif` passwordless
   sudo on prod (#20), 4 SSH keys + provider tokens in home (#21). **Never sync home secrets to the
   VPS; generate fresh keys there.**
5. **The Laya repo** (Carson has it; not on this Mac) + **VPS GPU vs CPU** (or run on the GPU gaming
   PC).

## 7. Concerns (flagged per Carson's ask)

1. **Production runs uncommitted code** (§2.1) — biggest live risk.
2. **Security before VPS** (§6.4).
3. **Collaborator, not owner** — Tier B/C/D-Dobius changes are small PRs Sam reviews; no big-bang cutover.
4. **ADAM's knowledge lags weeks** — an orchestrator on stale facts is dangerous (A4).
5. **Apple Developer ID cert still missing** (blocked on Carson) — no self-update; Gatekeeper re-checks
   every launch. Signing/updater switches + overridden Windows signature check need revisiting before release.
6. **False-negative filtering is Laya's core danger** — a cheap "looks fine" hiding the one broken case;
   bounded by thresholds + sampling + mandatory deep checks for high-stakes.

## 8. Ideas (parked)

Phone/web brain viewer on the VPS (#7); collapse the four schedulers into one; Vault Game Mode (a live
health screen once the event bus exists); finish the Manager Tab (two slices already built + verified
against 598 real Drive docs); reclaim ~50GB stale cache.

## 9. Guardrails (whole program)

- **No install/build/push during planning** (Carson, 2026-09-30); each tier needs an explicit go.
- **Do not touch `.claude/worktrees/integration`** until §2.1 is committed.
- **Deny-zone stays Carson + Sam.** **Never auto-move a card to Done; never rewrite a vault note** —
  suggest, don't act. **Verification is never Laya alone.** **One Laya model, never in the Electron
  bundle.** **No home secrets to the VPS.**
- **Plan from installed reality:** 2.0.0 build 2 on `stabilize/integration`.

## 10. Open decisions for Carson

1. Commit the uncommitted fixes now — which branch? (§2.1)
2. Push + PR the stabilization work to Sam now, or stay local-first? (§2.2)
3. Autonomy tier ladder (reversible? leaves machine? green/amber/red) — undefined in the vault; needed
   before write gates (B5).
4. Vertex vs ADAM — control plane, UI shell, or rename? Changes where the workflow engine lives.
5. VPS GPU or CPU-only (or the GPU gaming PC)? Where is the Laya repo? (Tier D)
6. Testing latitude (Backlog #35) — may agents build integration/e2e tests + instrumentation not
   visible as features? Shapes how every tier is verified.

## 11. Done bar (per tier)

- Each tier lands as small PRs reviewed + merged by Sam; `pnpm typecheck` + `oxlint` clean; existing
  tests green; a runnable test + proven fallback per phase.
- Tier D gated on the Tier B foundation acceptance test.
- No card reaches Done, and no vault note is mutated, without a human.
- Every Laya-driven action carries an auditable reason (the event log).
