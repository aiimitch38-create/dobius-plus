# TASK: Laya — a shared decision-and-verification service for ADAM + Dobius+

**Status:** Scoping (not started). Phase 0a gates everything.
**Author:** Carson + Claude, 2026-09-29.
**Prior review:** Codex (gpt-5.5) reviewed two earlier drafts; its corrections are baked in as
baseline facts (tagged `[Codex]` where load-bearing). A fresh review is requested on this
shared-service rewrite.

---

## 1. The idea in one paragraph

Stand up **Laya** (`github.com/NandhaKishorM/laya`) — the open-source, self-hostable twin of the
paid "Jev" — as **one shared decision service** on the VPS, and let both **ADAM** and **Dobius+**
call it. Laya reads text and returns a *typed decision* — `choice` (pick one), `score` (rating),
`noul` (yes/no + probability) — in ~33 ms (GPU) / ~50–200 ms (CPU+ONNX), with no text generation,
so no hallucinated prose. It becomes the cheap, instant judgment layer under the whole operation:
ADAM's reflexes, the Kanban, the Obsidian vault, and a real verification floor — while authority
and Carson's final sign-off stay exactly where they are.

## 2. Architecture — one brain, many clients (hub-and-spoke)

Like a power grid: one plant, many buildings plugged in, a backup generator per building.

```
                    ┌───────────────────────────────┐
                    │  LAYA SERVICE  (the one brain)  │
                    │  VPS (or GPU host). HTTP + MCP. │
                    │  choice / score / noul.         │
                    │  auth · /health · version pin.  │
                    └───────▲───────────────▲─────────┘
                            │               │
            (Carson's repo) │               │ (owner's product — PR-gated)
                  ┌─────────┴──────┐  ┌──────┴───────────┐
                  │ CLIENT: ADAM   │  │ CLIENT: Dobius+  │
                  │ queue rank,    │  │ Kanban moves,    │
                  │ Obsidian,      │  │ verification,    │
                  │ orchestration  │  │ terminal senses  │
                  └───────┬────────┘  └────────┬─────────┘
                    dumb fallback        dumb fallback
                   (regex / cache)      (regex / cache)
```

**The plant — the Laya service.** Exactly ONE real model instance, on the VPS (or Carson's GPU
gaming PC if the VPS is CPU-only). Clean contract: `{ text, schema }` → `{ decision, confidence }`.
Auth token, `/health`, request-timeout budget, model/version pinning, no-PII logging. Batches many
requests into one pass (~7 ms/item), so a single shared service is *cheaper* than per-client copies.

**Client A — ADAM** (Carson's own `adam-system` repo). A privileged client with its own decision
schemas. His "private brain" is really *private access to the shared brain* — he ships no model.

**Client B — Dobius+** (the app). The *same* service, called for product features. "Baked into the
software" becomes "the software calls the service" — **no ML dependency shipped inside the Electron
app** (no Docker on the Mac; the model never lives in the bundle).

**The backup generator — a safe local fallback in each client.** `[Codex — fix first]` The
fallback must be *safe*, not just cheap. When the service is unreachable or below threshold:
- **Action-bearing decisions** (a card move, a verification pass/fail) fall back to the deterministic
  baseline (the old keyword check) or **abstain/escalate to a human** — never stale reuse.
- **A cached last-known decision is allowed ONLY for read-only hints** (e.g. a terminal-status
  label), keyed by the *exact* `{text, schema, modelVersion}` with a short TTL — never for anything
  that acts.
- Never a second model. Mirror `adam-client.ts:84`, which collapses transport failure into one clean
  error result.

**Service hardening (it's a single point of failure — mitigate, don't pretend otherwise) `[Codex]`:**
timeout budget per call, per-client rate limits + a request queue with backpressure (one ADAM burst
must not starve Dobius+ suggestions), a circuit breaker that trips to fallback, and health/version
telemetry. `[Codex] Dobius+ calls Laya from main/preload, never the renderer` — the board dispatcher
lives in the renderer (`board-dispatch.ts:1,122`); remote calls + the auth token go through
main/preload so secrets and remote failure modes never leak into UI code.

**The one rule that makes "all three" work:** one model on the server; everyone else is a thin
client with a safe fallback. Never three real copies (3× the hundreds-of-MB model, 3× to maintain,
guaranteed drift).

## 3. Who owns what (the boundary that drives the plan)

**Carson → ADAM → the crew.** ADAM (`~/dobius/projects/ADAM`) is the main orchestrator on the
workstation — chief-of-staff / researcher / verification engine (`ROLE.md`), driving the other
agents (Watson, Edith, …). Voice (`/v1/converse`) is one interface into him. Carson is the
bottleneck by design; everything ships on his sign-off.

- **The Laya service + Client A (ADAM)** = **Carson's territory.** His repo, no merge gates, move
  fast, prove value.
- **Client B (Dobius+)** = **the owner's product.** Carson is a collaborator, not owner; changes
  ship as small reviewable PRs, Sam gates every merge, V2 isn't installed yet. So the app-side
  surfaces are pitched as *product features* and land via PR — **only after Phase 0a proves
  accuracy.** "Call a service" is a lighter, more reviewable change than embedding a model.
- **Authority.** `[Codex] authority.yaml is policy intent, not code-enforced on the Dobius side
  (ADAM's audit says it was test-only)`, so the guardrails in §8 must be written into each client's
  code, not assumed. ADAM's deny-zone (`merge / deploy / spend_money / force_push /
  permanent_delete / complete_external_task`) is Carson + Sam only; Laya decides and routes, never
  acts on the irreversible.

## 4. Surfaces, split by client

Every surface cites the code that grounds it; every consumer falls back to current behaviour on a
non-200 / low-confidence result.

### Client A — ADAM surfaces (Carson's repo, build first)

**A1. ADAM's reflexes.** `ROLE.md` §4 ("convert thinking into deterministic rules; spend the saved
thinking on verification") is exactly Laya's job: `score` Carson's judgment queue by dollar impact
→ blocked-on-him → freshness (§1); `choice` to reduce options to "a or b?" (§2).
- *Intent routing is NOT worth it:* `[Codex] ADAM's answer-vs-job is already cheap deterministic
  routing (regex + a feature classifier, converse.ts:26,103)`, not a full model call. Skip it.

**A2. Terminal senses.** Dobius+ already writes terminal logs used as recent-activity context
(`terminal-history-context.ts:70`); `TASK-ADAM-CONTROL.md:88` plans a regex tail watcher. ADAM's
watcher calls Laya instead of regex → a typed state per terminal (working / stuck / failed /
needs-Carson / urgency). Read-only for ADAM; this is his sensory feed over the crew.

**A3. Obsidian second brain.** The cabinet `~/Obsidian Vault/AI Research/` is ADAM's cross-tool
filter layer (`brain/README.md`: durable, non-project knowledge only, "never raw"). Laya:
auto-link (`noul` "related?" → suggest `[[wikilinks]]`, embedding-prefiltered), auto-file/tag
(`choice`), action extraction (`noul` "is this a task?" → candidate Kanban cards), importance
`score`, and the cabinet guardrail (`choice` "durable vs project-specific" before any AI writes).
Nightly VPS job + on-change watcher. **Suggestions only — never rewrite Carson's notes.**

**A4. ADAM's hands.** `[Codex] the targeted primitives already exist server-side` —
`/tabSendTo` and `/tabRead` handlers (`dispatch-server.ts:164,195,284,292`); only the installed CLI
*wrappers* still expose active-tab send + tabs/status/task-done (`install-clis.ts:107`). ADAM's own
`DOBIUS.md` (4 endpoints, active-tab hazard) is stale — correct it. "Real hands" = wiring wrappers
to primitives already built. With A2's senses, ADAM can dispatch → watch → triage → route to
`review-audit` → surface to Carson.

### Client B — Dobius+ product surfaces (PR to Sam, after Phase 0a)

**B1. Kanban auto-mover.** The board already auto-moves on hard signals: To Do + agent → dispatch →
`in-progress` (`board-dispatch.ts:81,121`); success → `review`, deliberately not Done
(`board-dispatch.ts:132`), via `window.api.vertexTasks.update` (`board-dispatch.ts:122`).
- `[Codex] Failure does NOT auto-move today` — card stays In Progress with failed/dead metadata;
  retry is a manual human click (`board-dispatch.ts:143`, `KanbanCard.tsx:83`).
- `[Codex] Moving isn't "nearly free"` — `update(status)` appends (`vertex-task-store.ts:238`);
  `move()` controls position (`vertex-task-store.ts:257`); `update()` is last-write-wins JSON, so
  auto-moves need ordering, an audit reason, idempotency, and race handling.
- Laya adds the judgment moves the board can't compute: **Blocked detection** (empty column),
  **smart retry** (transient → To Do vs dead-end → Blocked), **backlog triage** (readiness +
  priority + label). Keep exit-code moves deterministic. **Never auto-move to Done.**

**B2. Verification floor — "real verification under everything" (flagship).** Serves ADAM's core
purpose (`ROLE.md` §3) and Carson's mantra "review, audit, ship test / written ≠ merged ≠ live".
- **Honest boundary `[Codex]`:** Laya only classifies text — NOT the eyes, NOT the judge. It can't
  reliably decide arbitrary task completion, and a typed classifier can't explain *why* in prose.
- **Division of labour:** Playwright / tests / `tsc` / a vision model = the eyes (gather evidence;
  websites first; fresh window per capture). Laya = the cheap filter — a `score` "how done does this
  look?" run on *every* change, deciding whether the deep check is warranted. `review-audit` = the
  generative judge that names the gap on borderline/high-stakes. `ship-test` = post-deploy. Carson =
  final sign-off.
- **`[Codex] Fail closed on hard evidence:** `tsc`/test failures, HTTP 500s, console errors fail
  the check *without* Laya. Laya may only route work *up* to the deep check, never suppress it;
  high-stakes (auth/prod/money) and ambiguous cases always get the deep check.
- Value = coverage: `review-audit` is too slow to run on everything; a Laya score is cheap enough to
  be the floor and route the suspicious ones up. Router, not verdict.

**B3. In-app coordinator gates.** `decision_gate` rows exist (question/options/resolution,
`types.ts:64`) but `[Codex] the coordinator does NOT auto-resolve them — it blocks and waits for
human/external resolution (coordinator.ts:359)`. So Laya here is *new autopilot*: auto-resolve
low-risk gates above threshold; deny-zone or low-confidence escalates. Lowest priority (adds
autonomy rather than replacing a cost).

## 5. Prerequisites (must exist before wiring)

1. **Evaluation harness (Phase 0a, gates everything).** A frozen, hand-labeled dataset (log tails,
   cards, verification evidence packs), scored vs. a regex baseline AND a Claude call: metrics +
   confusion matrix, a threshold *per surface*, and an explicit fail-open/fail-closed policy per
   surface. If Laya doesn't clearly beat the baseline, stop.
2. **Data model + audit API** (gate before any auto-move / verification storage). On `VertexTask`
   (`vertex-task-types.ts`): `blockedReason`, `verificationEvidence`, `classifierVerdict`
   (+confidence). `[Codex] Plus an evidence schema and an immutable append-only audit-event API with
   idempotency/race rules` — extra JSON fields on last-write-wins `update()` are not enough.
3. **Service contract + threat model (gate before Phase 1) `[Codex]`** — pin the request schema,
   model/version, auth, timeout, retry, circuit-breaker, no-PII logging, and the exact per-surface
   fallback semantics (§2) BEFORE standing the service up. The safe fallback is proven in each client
   before it depends on the service.
4. **CLI wrappers** for `/tabSendTo` + `/tabRead` — `[Codex] a Phase 5 gate only` (A4), not a
   general prerequisite.
5. **The Laya repo** — Carson has a copy (NOT on this Mac; likely VPS or gaming PC). Confirm it's
   current before building on it. Else `git clone …/laya`; `pip install ".[serve,onnx,mcp]"`.
6. **Where the service runs** — VPS GPU vs CPU-only, or the GPU gaming PC. Changes latency/setup.

## 6. Phased build plan

One model on the server; every early surface ships as *suggestions/labels*, never auto-actions,
until the numbers earn trust. ADAM (Carson's repo) leads; the product client follows via PR.

- **Phase 0a — Offline eval only (1 day). GATES EVERYTHING.** `[Codex — most important]` Write it
  as a concrete eval contract: frozen labeled dataset, regex + Claude baselines, metrics + confusion
  matrix, per-surface thresholds, fail-open/closed policy. No service, no app integration. Go/no-go.
- **Phase 0b — Offline replay triage report (½ day).** `[Codex-fixed]` Run Laya over *recorded* log
  tails, print per-terminal labels. Offline — does NOT need a live service.
- **Phase 0c — Service contract + threat model (½ day). `[Codex]`** Pin schema, version, auth,
  timeout, retry, circuit-breaker, fallback semantics, no-PII logging — on paper, before any host.
- **Phase 1 — Stand up the shared service (1 day).** `laya serve` in Docker on the VPS/GPU host,
  `/health`, auth, version pin, rate limits + queue, the `{text,schema}` contract. Prove the safe
  fallback path first.
- **Phase 2 — ADAM client, read-only (1–2 days).** A2 terminal senses live + A1 queue ranking.
  Carson's repo, no gates, no card moves. First real value.
- **Phase 3 — Data model + audit API (1–2 days).** Prereq §5.2, landed in Dobius+ as a small PR
  (storage only, no behaviour change) so later product surfaces have somewhere to write.
- **Phase 4 — Dobius+ client: Kanban Blocked *suggestions* (1–2 days, PR to Sam).** Laya proposes
  "looks blocked"; a human confirms. Not auto-moves.
- **Phase 5 — Verification evidence packs + advisory score (2–3 days, PR to Sam). Flagship,
  websites first.** Eyes gather evidence; Laya scores; borderline/high-stakes → `review-audit`;
  hard failures fail closed without Laya.
- **Phase 6 — Promote trusted moves to auto** (smart retry, backlog triage) **only where Phase 0
  accuracy justifies it**, audit trail on.
- **Phase 7 — ADAM hands (1–2 days).** Wire CLI wrappers to `/tabSendTo` + `/tabRead` (A4).
- **Phase 8 — Obsidian indexer (2–3 days).** A3, suggestions first.
- **Phase 9 — In-app gate auto-resolve (1–2 days, PR to Sam).** B3, confidence-gated, deny-zone out.

## 7. Requirements to confirm (the-algorithm, step 1)

1. Do we want new autopilot on in-app gates (B3), or should those stay human?
2. VPS GPU or CPU-only — or run the service on the GPU gaming PC?
3. Where is Carson's Laya repo?
4. Does Sam want verification (B2) as a Dobius+ product feature, or should it stay ADAM-side only?

## 8. Risks & guardrails (enforced in each client's code, not assumed)

- **Wrong auto-decision no human sees** → per-surface confidence threshold + fallback + never
  auto-decide anything in the deny-zone.
- **`[Codex] Biggest risk — false-negative filtering.** A cheap "looks fine" can stop the deep
  reviewer from ever seeing the one case that mattered. Mitigate: per-surface thresholds, random
  sampling into the deep check, mandatory deep checks for high-stakes categories. Laya routes up,
  never suppresses.
- **Never auto-move a card to Done; never silently rewrite an Obsidian note** — suggest, don't act.
- **Verification is never Laya alone** — it filters, `review-audit` judges, Carson signs off; hard
  evidence fails closed.
- **One model only** — service on the server; no ML dependency in the Electron bundle; no Docker on
  the Mac; no three-copy sprawl.
- **`[Codex] Safe fallback, not stale reuse** — action-bearing decisions fall back to baseline or
  human escalation; cached hints only for read-only labels, exact-keyed + short TTL. "Route up, never
  suppress" must be enforced in code, not just documented.
- **`[Codex] SPOF hardening** — timeout, per-client rate limits, queue/backpressure, circuit breaker,
  version telemetry; Dobius+ calls the service from main/preload, never the renderer.
- **Auto-moves need the §5.2 data model + audit API first** — otherwise they're mysterious and racy.

## 9. Done bar

- Phase 0a accuracy report clears the baseline before any wiring.
- Each phase ships with a runnable test and its fallback proven.
- `pnpm typecheck` + `oxlint` clean on touched files; existing tests green.
- No card reaches Done, and no vault note is mutated, without a human.
- Every Laya-driven action carries an auditable reason (the event log).
- Product-side changes (Client B) are small PRs reviewed and merged by Sam.
