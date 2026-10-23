# Dobius+ Master Build Plan — finishing the agentic system

**Status:** PLANNING ONLY. No build, no install, no push during this process (Carson, 2026-09-30).
**Author:** Carson + Claude, 2026-09-30. Built from a 4-agent deep read of the Obsidian vault
(audits 2026-09-16→23, Master Backlog, Vertex architecture notes) cross-checked against git and
logs this session.
**Companion docs:** `plans/TASK-LAYA-INTEGRATION.md` (the intelligence layer, already 3x Codex-
reviewed). Vault: `Dobius Architecture Decision - Foundation Before Agents 2026-09-17`,
`Dobius Agent Context Contract 2026-09-20`, `Dynamic Workflow Catalog 2026-09-17`,
`Iris Report Dobius Ecosystem 2026-09-18`, `Master Backlog`.

---

## 0. Where we actually are (verified 2026-09-30, supersedes the week-old audits)

The Sept 16–23 audits are one stabilization sprint out of date. What changed since:

- **Stabilization is COMPLETE on a branch.** 50/50 numbered builds + follow-ups merged into
  `stabilize/integration` (tip `a1a82dfc`, 2026-09-25). The 123-bug deep list is addressed there
  (3 deferred with reason). Lint/typecheck clean per build; test suite "clean vs baseline".
- **2.0.0 build 2 IS installed** (since 2026-09-25 10:24, from `stabilize/integration`). So "V2 never
  installed / V1 is the proven build" (ADAM's `DOBIUS.md`) is now **stale**.
- **The ADAM gate is partially closed.** ADAM gained a read-only `POST /v1/context-handshake`
  admission probe (deployed 09-25), and BUILD-031 gated `dispatch_build` on the handshake.
- **Agent SDK sandbox is ON by default** (SBX) — Bash writes restricted to the run folder.
- **Obsidian event projection is live** — `Dobius Agent Activity/*.md` are real ADAM-ingested logs.

**Revised score: ~6/10** (up from the 5/10 I gave off the stale audit). Strong as a daily driver
and freshly de-bugged; still short of a *trustworthy* agentic system because the deep foundation
(registry, durable workflow, context packs, evidence-bound "done") is designed-not-built, and the
current win is **fragile** (see §1).

## 1. URGENT — do before anything else (needs Carson's go; no install)

1. **Commit the uncommitted security fixes.** ~20 modified files in `.claude/worktrees/integration`
   implement the fixes for the 6 HIGH + 1 medium findings from the final Codex review (persistence
   data-loss, sandboxed agent → unrestricted runtime RPC, conductor dispatch bypasses the gate,
   device tokens/E2EE key readable to agents, device revocation misses rotated tokens, SSH mobile
   symlink bypass, Asana triage on unpersisted claim). **The installed app was built from this dirty
   tree, so these fixes exist ONLY as unsaved working-tree edits.** Commit them to
   `stabilize/codex-final-fixes` (or the integration branch) NOW. **Until then: do not `checkout`,
   `stash`, or remove that worktree — it would delete live production fixes.**
2. **Then start the Done Bar** for the stabilization work: push `stabilize/integration` to the fork,
   open a PR, Sam reviews. Nothing has been PR'd yet (local-first, as designed — but the PR step is
   now due).

## 2. The strategy: foundation before agents (the vault's own accepted decision)

There is an **Accepted** architecture decision (2026-09-17): *no new specialist agents, and no new
intelligence, until five foundation capabilities pass an acceptance test.* This plan follows that.
Laya and the per-tab checklist are valuable, but they slot in **on top of** the foundation, not
before it — otherwise (the vault's words) "adding more agents only adds more unmanaged work."

The ordered foundation the vault already specifies:
`registry/manifest → run adoption (the ADAM gate on every path) → event bus/ledger → durable
workflow engine → context packs + write gates → evidence-bound "done" → then agents/intelligence.`

## 3. The plan, in tiers

### Tier A — Lock in what's done (days, low risk)
- A1. Commit the Codex-fix files (§1.1). **Gate: Carson.**
- A2. Push + PR the stabilization branch; Sam reviews (§1.2).
- A3. Resolve the still-open `DECISIONS-FOR-CARSON` items: rebuild the phone app (handshake v2 has
  no fallback — the old phone app will fail to connect), rotate the ElevenLabs key, GitHub branch
  protection on `main`, enable husky pre-commit (`core.hooksPath` is empty), add an
  `undo_code_change` client tool. **Gate: Carson per item.**
- A4. Refresh ADAM's stale knowledge so the orchestrator stops lying to itself: `DOBIUS.md` (wrong
  install/branch facts + stale 4-endpoint CLI table), `brain/NOW.md` (stuck at 2026-08-05), and the
  26-entry `LEARNINGS-INBOX.md` backlog. Fix the `Commits Dobius Plus.md` vault feed so it sees the
  `stabilize/*` branches.
- A5. Unblock the SMID agent (blocked 7 days): it's a "don't ask mode" permission denial, not OAuth;
  and it's running on Haiku, against the most-capable-model rule. **Gate: Carson grants + model bump.**

### Tier B — Foundation (the five capabilities; each lands as small PRs to Sam)
Order and content from the vault's Foundation Decision + Context Contract + Workflow Catalog.
- B1. **One project registry + manifest** both brains use. Reconcile ADAM's `projects.yaml` with the
  Dobius CLI registry (had 20 records, 9 missing paths). Manifest schema: purpose, risk tier, source
  roots, graph policy, workflow profiles, required artifacts, approval policy, agents.
- B2. **Finish run adoption (close the two-brain gate on EVERY path).** Make ADAM job/task/worktree
  IDs required, not optional, and route the still-ungated paths through the handshake: Asana Auto
  Mode, heartbeats, Communications, Voice Conductor, iMessage, CLI dispatch. Add an explicit
  read-only "unmanaged" mode for exploration. (dispatch_build is already gated — this finishes it.)
- B3. **One event bus + ledger** as the source of truth, with a single writer, ordering/dedup, and
  the Obsidian projection (already live for agent runs — generalize it). Consolidate the scattered
  JSON stores.
- B4. **Durable workflow engine** (Temporal-style): typed steps, checkpoints, retry, idempotency,
  cancellation, restart recovery. Acceptance = survives a restart mid-run. Also fixes the crash bugs
  (orphaned "running" coordinator row, capped 50-record history, journal replay cap, Codex slot leak).
- B5. **Context packs + write gates** (the 8-step handshake): resolve project/worktree/task, Graphy
  freshness receipt, capability/skill resolution, inject the pack, stale-context invalidation, block
  writes without it. Fail closed for managed work; read-only for discovery.
- B6. **Evidence-bound "done."** No task completes without diff + test output + screenshots + a
  verifier result attached, and approvals bound to a specific artifact. (Live DB today: 21,135 events
  vs 33 evidence rows, 0 approvals — this is the gap that makes "done" untrustworthy.)
- **Foundation acceptance test** (vault's six-terminal test) must pass before Tier D.

### Tier C — The work model + the per-tab checklist (Sam's actual ask)
- C1. **Task/Mission/Project as real domain objects** (nothing else — Kanban, Missions, Command
  Center — can render properly until these exist).
- C2. **Kanban is a view, not a system** — it renders Vertex tasks off the event bus, never calls
  Asana directly; Vertex is master, Asana is a sync target.
- C3. **Per-tab to-do checklist = the In-Progress card, zoomed in.** Surface Claude Code's own
  `TodoWrite` items (already flowing through the agent-hooks server) on the side of each tab, each
  item showing the state the app already tracks (working / waiting / **permission** / blocked / done
  via `AgentStateDot` + `smart-attention`). This is Sam's "work into the orchestrator + move the
  to-do lists." Not a new task system — a second view of the one card model.

### Tier D — Intelligence (Laya) — ONLY after foundation acceptance
Full detail in `plans/TASK-LAYA-INTEGRATION.md` (hub-and-spoke shared service; ADAM + Dobius as thin
clients; safe fallback; verification floor where Laya filters and `review-audit` judges; product
surfaces PR-gated). The per-item "did it actually finish vs silently skip?" judgment on the C3
checklist is Laya's first real job here.

## 4. Concerns (surfaced, per Carson's ask)

1. **Production runs uncommitted code** (§1.1) — the single biggest risk on the board right now.
2. **Security before any VPS work:** stale `.claude.json` backups may hold tokens (#19), `pcif` host
   has passwordless sudo on prod (#20), 4 SSH keys + provider tokens in home (#21). Never sync home
   secrets to the VPS; generate fresh keys there. Hard prerequisite for the Laya/VPS hosting.
3. **Collaborator, not owner.** Every Tier B/C change is a small PR Sam reviews; no big-bang cutover.
4. **ADAM's knowledge lags reality by weeks** — an orchestrator planning off stale facts is dangerous
   (A4 fixes it).
5. **Apple Developer ID cert is still missing** (blocked on Carson) — without it the app can't self-
   update and macOS re-verifies every launch. Nothing else unblocks it.
6. **Signing/updater switches** disable auto-update even with a cert; Windows signature check is
   overridden to succeed — revisit before any real release.

## 5. Ideas (surfaced)

- **Phone/web brain viewer** (Backlog #7): a tiny markdown server on the VPS so the vault is readable
  anywhere without Obsidian — cheap, and it pairs with the Laya VPS host.
- **One scheduler.** Collapse Dobius Auto Mode + heartbeats + ADAM pulses + legacy scheduled tasks
  into one, so work stops being triggered four different ways.
- **Vault Game Mode** (designed-not-built): a Fallout-Shelter-style live view of the real backend —
  a fun, honest "is everything healthy?" surface once the event bus exists.
- **Manager Tab**: two backend slices already built + verified against 598 real Drive docs; exposing
  it over IPC is the cheapest visible new feature.
- **Reclaim disk**: `.claude-profiles` 7.9 GB stale, `~/.cache` 42 GB — free wins (the machine hit
  99% memory during the audit).

## 6. Guardrails (this whole program)

- **No install/build/push during planning** (Carson, 2026-09-30). Tier A onward each needs an
  explicit go.
- **Do not touch `.claude/worktrees/integration`** until §1.1 is committed — it holds live prod code.
- **Deny-zone stays Carson + Sam:** merge, deploy, spend, force-push, delete, complete external task.
- **Foundation before agents** — Tier D is gated on the Tier B acceptance test.
- **Plan from the installed reality:** 2.0.0 build 2 on `stabilize/integration`, not the old audit
  baseline or `fix/channel-cost`.

## 7. Open decisions for Carson

1. Commit the uncommitted security fixes now, to which branch? (§1.1)
2. Push + PR the stabilization work to Sam now, or keep local-first longer? (§1.2)
3. Autonomy tier ladder — the vault never defined the names/values (reversible? leaves machine?
   green/amber/red). Needs deciding before write gates (B5).
4. Vertex vs ADAM — is Vertex the ADAM control plane, a UI shell over it, or a rename? Unreconciled
   across the notes; it changes where the workflow engine lives.
5. VPS GPU or CPU-only (or run Laya on the GPU gaming PC)? Where is your Laya repo? (Tier D)
6. Testing latitude (Backlog #35, still unanswered) — may the agents build extensive integration/e2e
   tests + instrumentation not visible as features? Shapes how every tier is verified.
