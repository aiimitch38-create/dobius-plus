# Communications Build Plan v2 — Phases 5 to 7

Written 2026-08-29. Replaces v1 of this file and `TASK-COMMS-P5B-GROKBOT-UI.md`.
Extends `TASK-COMMS-MASTER-PLAN.md` (Phases 0–4 done). Evidence: `IRIS-REPORT-20260829.md`.

v1 was built from reading. This version is built from executing. **Five claims in v1 were
wrong** and are corrected below — one of them invalidated the entire slicing strategy.

## Corrections to v1

| v1 claim | Truth | How it was checked |
| --- | --- | --- |
| Restore feature by feature | **Impossible.** 41 circular dependency pairs. `messages` needs `channels`; `channels` needs `messages`; `shared` imports from `features/`. | transitive-closure script over the extracted tree |
| Smallest useful slice is small | `messages` alone pulls **544 of 1,182 files (46%)**. `messages`+`channels` = 779 (65%). Whole app = 960 (81%). | same |
| Strip communities/moderation/pulse on the way in | **Breaks the build.** `features/messages` imports `communities` and `moderation` directly. | dependency graph |
| 21 files touch Tauri | **49 files.** | `grep -rc` over the extracted tree |
| App wasn't running | It was — PID 6162 from `/Applications`, relay answering. My `pgrep -f "Dobius+..."` hit the documented `+`-is-a-regex-quantifier trap in `.dobius/NOTES.md`. | `lsof -nP -iTCP:3300` |

**Consequence: the restore is one atomic move of ~960 files, not a sequence of slices.**
Going from the smallest useful subset (544) to everything (960) is only 1.76× the files and
removes all cycle-breaking work. Slicing is a false economy.

## Where we are (verified 2026-08-29)

- App running, PID 6162, `/Applications/Dobius+.app`. Relay live on 127.0.0.1:3300.
- Backend 28,806 lines, gate 21/21. Allowlist carries **141 methods**; the Buzz UI calls 68.
- Phases 0–4 committed (`41b274fb`, `7eaf8bbf`, `fdcffaaf`). Phase 5 written, **uncommitted**.
- Branch `feat/computer-use-v2` holds every comms commit. **Nothing has been pushed.**
- Current Communications surface is the 1,333-line stub: DMs only, no agent roster, no calls.

## What the hub is for (stated 2026-08-29, drives everything below)

**Channels are work queues by job type.** You split your work into channels — one per kind of
job — and agents work inside them, coordinate with each other, and handle the tasks that do not
need your attention. Later, each agent gets its own cloud computer.

The hub is not a nicer chat window. It is a place to **delegate and watch work happen**. Every
decision below is judged against that.

Consequence: `channelTemplate.*` — six methods already in our allowlist (`create`, `duplicate`,
`list`, `show`, `update`, `delete`) — is the most on-purpose feature in the backend. A template
is a reusable job type. It moves to the front of the restore, ahead of DMs.

## Definition of working (the acceptance test)

Phases 5–5.5 are done when, in the installed app, all six hold:

1. Communications opens as a **tab** in Dobius+ and shows channels, DMs, and an agent roster.
2. You create a channel **from a template** (a saved job type) and post work into it.
3. You open the agent roster, create an agent, and it appears with its own identity.
4. **Two agents complete a task between them in one channel while you are not watching** — you
   post the work, close the tab, come back, and it is done with the exchange visible. This is
   the core loop; the other five are scaffolding for it.
5. You start a huddle and **add an agent to the call** (`AddAgentDialog`).
6. `scripts/run-comms-gate.sh` still exits 0 at 21/21.

Anything short of all six is not done. **Criterion 4 is the one that matters** — the rest can
pass while the product still fails at its purpose.

---

## Phase 5 — close the provider seam · ~half a day

1. **Push the branch first.** Three weeks of comms work exists only on this disk.
2. Commit the 8 files in `src/main/communications/providers/` + `HarnessCatalogSection.tsx` +
   modified `ipc/agents.ts`, `shared/agents.ts`, `preload/*`. Stage only these paths — the
   checkout holds other agents' jarvis, speech, and computer-use work.
3. Add `OpenRouterProvider` behind the existing seam. Key write-only through the secrets path;
   never returned via status, events, or logs.
4. Add `protected-path-guard.ts` — reimplemented, not copied. Refuse any provider file
   operation resolving inside a protected root, checking the resolved path **and** the
   realpath of the nearest existing ancestor so symlinks cannot escape. Call from the seam so
   all four providers inherit it.

**Verify:** `typecheck:node` 0 · `vitest run src/main/communications/providers` · gate 21/21 ·
one test proving a symlink into a protected root is refused.

## Phase 5.5 — restore the Buzz UI · the bulk, 3–5 days

**Prerequisite.** Delete `getOrCreateDobiusIdentity()` from `main.tsx` and call the
main-process identity store. It writes a plaintext private key to `localStorage` — the exact
hole Phase 4's migration closed. Nothing lands before this.

### 5.5a — spike (half a day, go/no-go)

Restore the whole tree to
`dobius/src/renderer/src/components/communications/`, swap `router.tsx`
`createHashHistory()` → `createMemoryHistory()`, add the `@/` alias, install the deps, and run
`typecheck:web`. **The error count is the estimate.** Under ~200, continue. Over ~500, stop and
reconsider — that is the kill criterion, decided before we start rather than after.

### 5.5b — make it compile (1–2 days)

- **49 Tauri call sites** → our native equivalents (window drag, tray, zoom, notifications,
  huddle audio, updater). `AddAgentDialog.tsx`'s `invoke` → `invokeDobiusRuntime`.
- **Dependencies.** ~14 new. Load-bearing: `@tanstack/react-query` (88 files), `motion` (77),
  `@tanstack/react-router` (23), `virtua` (19), `emoji-mart` (11). Droppable:
  `@mediapipe/tasks-vision` (**1 file** — drop unless huddle video is wanted), `jdenticon` (2),
  `upng-js` (2), `shiki` (3). Run `electron-rebuild` after install — project done-bar requires
  it after any dependency change.
- Rewrite `@radix-ui/react-*` imports to our unified `radix-ui`.
- **Do not strip communities/moderation/pulse yet** — `messages` imports them. Delete after
  it compiles and runs, as a separate commit, or leave them.

### 5.5c — make it ours (1–2 days)

Rename Buzz symbols to Dobius+ naming. Map the **49 hardcoded hex values** to CSS variables
(house rule). Theme layer is already tokenised — 487 custom properties, 335 `var()` refs — so
this is a rename pass, not a redesign. Wire the Communications tab in `App.tsx` to the restored
root, replacing the `BuzzNativePage` import.

**Attribution (Apache 2.0 requires it):** keep `LICENSE`, add repo-root `NOTICE` crediting
upstream Buzz, state files were modified, add a line to the About dialog.

**Channel templates get first-class treatment here.** The six `channelTemplate.*` methods the
allowlist already serves are what turn a channel into a reusable job type — the hub's actual
purpose. Whatever the restored UI gives us for templates, surface it prominently rather than
burying it in settings. If Buzz's UI has no template surface, build a minimal one: name, default
agents, default prompt. This is not polish; it is the feature.

### Rebrand pass — keep the look, replace the identity

**Rule: keep every layout, animation, spacing, and interaction. Replace only the identity.**
The design is what we are keeping; the name and marks are what make it theirs.

**Loading screen and logo** — `shared/ui/buzz-logo/` holds five files:
`BuzzLogoAnimation.tsx` (the loading screen), `BuzzMark.tsx`, `FlappingBee.tsx`,
`FuzzyLogo.tsx`, `buzz-logo-animation.css`. Replace with a Dobius+ mark, **reusing the same
animation timing and CSS** so the loading screen feels identical — only the shape changes.
`FlappingBee` is bee-specific and gets replaced outright rather than renamed.

**Image assets** to swap: `public/buzz.svg`, `public/landing/buzz-wordmark.png`,
`public/app-icon@2x.png`, `public/app-icon@3x.png`.

**Bee-themed content** — `public/onboarding/starter-team/` ships `bumble.png`, `fizz.png`,
`honey.png` as default agent avatars. Replace with Dobius+ starter agents; the bee names are
Buzz's identity, not ours.

**User-visible strings** — **276 files contain "Buzz"**, including error and security copy that
users read: *"Buzz keeps your identity key in your system keychain"*, *"Buzz couldn't access the
clipboard"*, *"Buzz shared compute"*. A blind find-and-replace will damage `BuzzMark` imports and
the `buzz-` CSS class names, so do strings and symbols as two separate passes, strings first.

**Keep `public/harness-logos/`.** Those are third-party marks (amp, devin, grok, hermes, kimi,
omp, openclaw, opencode) identifying other vendors' harnesses, with a `CREDITS.md` recording
provenance and license for each. Nominative use — they identify their own vendors, so they stay,
and the credits file stays with them. Add a row when we add a preset.

**Verify:** `grep -ril buzz src/renderer/src/components/communications` returns only provenance
comments and the NOTICE attribution; no user-visible string, asset, or window title says Buzz.

### 5.5d — prove and clean up

Run the five acceptance criteria. The tree brings **355 test files** with it — get them running
under our vitest config; they are the regression net for everything above. Only then delete
`components/buzz/native/` (1,333 lines).

**Rollback:** every stage is its own commit. Revert to the stub is `git revert` of the mount
commit alone — the stub stays on disk until 5.5d.

## Phase 6 — gateway, policy, audit · 2–3 days

Now specified, not sketched. **Amended by `TASK-COMMS-P8-ADDITIONS.md` Part A** — read it
before starting: A1 replaces the audit columns below with a four-kind action taxonomy, A2 adds
an off/shadow/enforce ladder so we never ship straight to fail-closed, and A3 adds permission
scope fencing. All three are design changes to unwritten work, so they cost nothing.

1. **`communications-policy.ts`** — evaluate `{agent, toolFamily, channel, action}` against
   JSON rules. Deny before allow. Empty policy permits nothing. A malformed rule refuses and
   names itself in the error. Pure function, no IO, fully unit-testable.
2. **`communications-audit.ts`** — append-only table via `SyncDatabase` (`node:sqlite`,
   mirroring `src/main/runtime/orchestration/db.ts`). Columns: actor, action, target, decision,
   rule name, outcome, relay event id, timestamp. Secrets recorded as *used*, never by value —
   reuse the existing redaction helpers (21 files already).
3. **Wire into the provider seam**, not into each provider: resolve → policy → write audit row
   → execute → record outcome. No path acts before a row exists. All four provider types
   governed with zero per-provider code.
4. **Approval arm** — the existing `agent-decision-approval-bridge` becomes the human gate for
   `decision: "ask"`.
5. **Audit view** in the restored UI, using its existing table components.
6. **Two audits carried from the Grok Bot investigation**, each one focused read:
   - does our approval bridge invalidate approvals across account switch? (they fence this
     with a revision gate; we may not)
   - do we pass raw agent transcript text into another agent's prompt anywhere? (prompt
     injection surface; they strip system-reminder blocks)

**Verify:** gate scenarios prove an action yields a policy decision, an audit row, and a
refusal that names its rule. **Do not use a Docker container as the boundary** — Grok Bot's
runs with no `--network none`, no `--cap-drop`, no `--read-only`; it is convenience, not
security.

## Phase 7 — prove it live, then ship · 1 day

Over the live relay through real IPC: DM a Claude agent, a Codex agent, and a custom-harness
agent; two agents coordinate in one channel via mentions; a risky action hits policy → approval
→ outcome recorded; the audit view shows the trail.

Then the Done Bar: PR, `review-audit`, build + install, ship-check together.

---

## Risks, ranked

1. **5.5a error count is genuinely unknown.** Mitigated by making the spike a go/no-go with a
   number agreed in advance.
2. **Identity regression.** Prerequisite, not a follow-up.
3. **Atomic restore means no partial value.** Until 5.5b compiles, there is nothing to look at.
   This is the cost of the cycles and cannot be engineered away.
4. **Shared checkout.** Stage only communications paths, every commit.
5. **Unpushed work.** Fixed by step 1 of Phase 5.

## Order

Push → Phase 5 → identity fix → 5.5a spike (go/no-go) → 5.5b → 5.5c → 5.5d →
Phase 6 → Phase 7 → Done Bar.

**Estimate: 7–10 working days**, dominated by 5.5b/5.5c and gated on the 5.5a number.
