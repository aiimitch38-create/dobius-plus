# Dobius+ — Full Picture Before We PR

_Written 2026-07-15. Grounded in the actual branch (`feat/voice-conductor`) and its commits — every row cites where it lives so nothing here is a guess._

The goal of this doc: **see everything we have first, then decide what goes into a pull request (PR — a request to merge our changes into the shared code so they can be reviewed) and what waits.** No PR is opened yet.

---

## The one fact that shapes everything

`origin/main` (the shared GitHub repo, `statusdigitalmarketing/dobius-plus`) is still the **old V1 app** — version 1.0.35, small JavaScript app.

This branch is a **completely different, much bigger V2 app** vendored under `dobius/`, plus your additions on top.

That means the work is **not a flat list of features** — it's **three layers stacked on each other:**

1. **The V2 base** — the new engine + UI ("the uplift" foundation). Lands as one unit.
2. **Your finished additions** — sit cleanly on top of the base.
3. **Your in-flight / deferred additions** — not done, or you chose to hold.

You can't PR a Layer-2 feature until the Layer-1 base exists in the shared repo. So the base is the elephant, and it comes first.

---

## Layer 1 — The V2 base (the uplift foundation)

This is the vendored V2 app + the rebrand from Orca → Dobius. It arrives as **one big unit** — you can't split it into small features, because it's a whole application.

| What | Evidence (commit / folder) | Notes |
|---|---|---|
| V2 app vendored under `dobius/` | `020b000`, `1f3d09f`, `61b1848` | The whole TypeScript app: multi-engine terminals, sessions, browser, integrations, tests |
| Orca → Dobius rebrand (1,931-file sweep + renames) | `67c1659`, `64a2467`, `d1a6c97`, `4d1428c`, `d398d2f`, `f9b54b0`, `6b0b56b` | Names, env vars, deps, org (`stablyai` → `statusdigitalmarketing`), update feed |
| Engine bridge / wiring (config migrator, CLI continuity, release alignment) | `d143b00`, `90c2a05`, `a597e31`, `b2e1b07`, `d8d8217` | Makes the V2 app boot as *our* Dobius+, not upstream's |

**Two pages ride along inside this base — they are NOT features you built:**

| Page | Evidence | Reality |
|---|---|---|
| **Dashboard** (V2's own) | vendored in `1f3d09f` / `61b1848`; only touched by rebrand since | Upstream's busier dashboard. It's *already in the base.* |
| **Knowledge page** | vendored in `1f3d09f` / `61b1848` | Same — upstream page, already in the base. |

> **Key point for your "hold" list:** Dashboard and Knowledge can't be "left out of a commit" — they're baked into the vendored app. Holding them back means **hiding their nav entry** (so they're unreachable), not excluding work. The code ships either way.

---

## Layer 2 — Your finished additions (ride cleanly on the base)

These are separable commits you added on top. They look done and most have tests.

| Feature | What it is | Evidence | Ready? |
|---|---|---|---|
| Daemon terminal-history persistence | Terminals survive quit/update instead of dying | `2e5c162`, `cacf08f` | Looks done, tested |
| Launch-at-login (reboot gap fix) | App relaunches after a full computer restart | `launch-at-login.ts` (untracked, 3 tests green) | Looks done, tested |
| CLI / Agents tab over RPC | `dobius` command-line tool can drive the Agents tab | `619ef22` | Looks done |
| Keep project context on torn-off terminals | Dragged-out terminal remembers its project | `d2e7787` | Looks done |
| 18 legacy Dobius terminal themes | The old color skins, ported | `900ae5a` | Looks done |
| computer-use distinct app icon | Separate badged icon for the macOS helper | `13563f5` | Looks done |
| V1-parity surfacing (new, uncommitted) | App-skin toggle, engine-parity checklist UI, Behavior settings pane | `app-skin.ts`, `engine-parity-checklist.ts`, `BehaviorPane.tsx` (untracked) | New — needs a look |

---

## Layer 3 — In-flight or deliberately held

| Feature | Yours or vendored? | Evidence | Why it waits |
|---|---|---|---|
| **Voice Conductor** | Yours (in-flight) | `c3e6d35`, `e1bda83`, `a594a14`, `f15295d`, `00d4bd3` + uncommitted `agent-spawn`, `lead-tab-store`, `persistent-work-registry`, RPC | Parity checklist marks it **in-progress**. It's this branch's headline. → **Your call** (see below) |
| **Manager** | Yours (your build) | `69b283d`, `e02a44c`, `6b83807`, `c623e7c`, `add3879`, `deef242`, `5d8a218`, `411f002` (8 commits, renderer + main) | You said hold. Genuinely in-flight. |
| **TV / quick-apps** (floating window) | Yours (your build) | `e9b95df`, `06a7e22`, `76897b8`, `b813cc8`, `a813bd6`, `a0fb75b`, `ec24c39`, `42734aa` (9 commits) | You said hold. |
| **OpenCode engine** | Vendored (base) | woven through **122 files**, sibling of Codex/Grok/Hermes | Can't be cleanly removed. **Stays in the code, finish wiring later.** |
| **Speak Last Response** | Planned (not built) | split out of parity checklist "Mobile and speech" | ✅ **DOING** — read Claude's latest reply aloud |
| **Status Digital task pipeline** (Intake→…→Done) | Planned (not built) | parity checklist: `planned` | ✅ **DOING** |
| Simplified Status Digital dashboard | Planned (not built) | parity checklist: `planned` | ❌ **DROPPED** |
| Build Monitor | Planned (not built) | parity checklist: `planned` | ❌ **DROPPED** |
| Visual preview + one-click deploy | Planned (not built) | parity checklist: `planned` | ❌ **DROPPED** |
| Mobile / Tailscale access | Planned (not built) | split out of parity checklist "Mobile and speech" | ❌ **DROPPED** |

> **Scope decision (2026-07-15):** Of everything left, we finish exactly three: **Voice Conductor**, **Status Digital task pipeline**, and **Speak Last Response**. The other four planned items are dropped. Note: the checklist bundled Speak Last Response with Mobile as one item — we keep the speech half, drop the mobile half.

---

## Compare & contrast: PR now vs. not yet

| Bucket | Items | Verdict |
|---|---|---|
| **PR now (the foundation)** | V2 base + rebrand + engine bridge (Layer 1) | **Must go first** — everything else needs it |
| **PR now (finished on top)** | Daemon persistence, launch-at-login, CLI/Agents RPC, torn-off terminal context, 18 themes, computer-use icon | Ready after a quick build + test verify |
| **Your call** | Voice Conductor | Headline work, has tests, but marked "in-progress" — PR now or finish first? |
| **Remove from PR** | Dashboard page, Knowledge page | Take out the page + nav entry + route. Keep shared `dashboard/` components the sidebar uses. |
| **Stays in base, unfinished** | OpenCode engine | 122 files deep — can't cleanly remove; wired up later |
| **Hold — just leave the commits off** | Manager, TV/quick-apps | Your own separable commits; not in-scope for the base PR |
| **Nothing to PR yet** | Simplified dashboard, Build Monitor, Visual preview/deploy, Mobile, task pipeline | Planned, not built |

---

## How each held-back thing is kept out (decided 2026-07-15)

1. **Dashboard — REMOVE from the PR.** Take out the Dashboard **page, its nav entry, and its `activeView === 'dashboard'` route** (App.tsx lazy import + render + sidebar nav). ⚠️ Do **not** delete `components/dashboard/` wholesale — shared pieces like `DashboardAgentRow` are used by the sidebar we're keeping. Remove the page, keep the shared components.
2. **Knowledge — REMOVE from the PR.** Cleaner than Dashboard — it's just the page. Remove the `KnowledgePage` lazy import, its `activeView === 'knowledge'` render, and its nav entry.
3. **OpenCode — stays in the base, unfinished.** 122 files deep; can't be cleanly removed. Rides along, wired up later.
4. **Manager, TV — separable additions.** Keep their commits off the PR branch. Clean.

---

## PR readiness scorecard (checked 2026-07-15)

Scored against a merge-ready bar. "The PR" = the pushable foundation (v2 base + finished layer on `feat/voice-conductor`).

| Check | Result | Detail |
|---|---|---|
| Typecheck (node/cli/web) | ✅ Clean | node exit 0; cli + web emitted zero type errors |
| Red flags | ✅ Clean | no `remote-debugging-port` in source, no whole-word `orca`/`stablyai`, no `@ts-ignore` in delta, no TODOs in new code |
| **Your added code** | ✅ **Green** | VC 45/45; launch-at-login 3/3; **0 delta files** appear in the full-suite failures |
| Full test suite | ❌ 337 failed / 95 files (of 24,771) | **all in the vendored upstream base, none in your delta.** ~1.4%. Likely env-specific (headless dev box, no full electron/native/network runtime). Not yet characterized per-file (needs a `--reporter=json` re-run) |
| Lint (delta) | ✅ **Fixed** (commit `54ce215`) | was ~14 `curly` + 2 `max-lines`; `conductor.ts`/`cli-server.ts` split into `conductor-system-prompt.ts` + `conductor-cli-routing.ts`; curly autofixed. oxlint clean, typecheck clean, 45/45 VC tests green |
| Committed & coherent | ⚠️ Dirty | 16 finished+tested files uncommitted |
| Held-back mechanics | ❌ Not done | Dashboard/Knowledge nav still exposed; Manager/TV commits still on branch |
| Reviewed | ❌ Not done | no review-audit pass on the delta |

**Two scores, because they answer different questions:**
- **Your added work: ~9/10 already** — typechecks, tests green, no red flags. Only lint style + committing left.
- **The whole PR as one mergeable unit: ~6.5/10** — dragged down by the base suite showing red, the dirty tree, the undone hold-back mechanics, and it being a very large first PR reviewers can't fully exercise.

**Gap to 9/10 (ranked, all closable):** 1) lint (`oxlint --fix` + split 2 files), 2) commit the dirty tree, 3) characterize/triage the 337 base failures (are they env-only? then note it; if any are real, fix), 4) hold-back mechanics, 5) one review-audit pass.

---

## Voice Conductor — connectivity status (checked 2026-07-15, static)

**Code is sound; it's just not turned on.** Traced end to end, not guessed:

- **Wiring is complete:** toggle (`VoiceConductorSection.tsx`) → `syncVoiceConductorFromSettings` at boot → background **Opus SDK session** (no window/tab, 3s respawn) + token-authed **HTTP server on :8422** backing the `dobius-*` CLIs, iMessage, and Asana lanes. Mobile RPC (`voice.intent`/`voice.reply`) registered.
- **Tests:** 45/45 pass across 9 VC files.
- **Live right now: not connected** — `conductorEnabled` isn't in the config (default off), the running installed app predates this uncommitted code, and nothing is listening on :8422.
- **Gap — no desktop path:** ⌘E dictation only *inserts text into the focused field* (`dictation:insertText`). Nothing routes spoken input to the conductor from the app. It's fed **only** by mobile RPC / CLI / iMessage.

**To finish VC:** (1) build+install so the code runs, (2) flip the toggle and smoke-test :8422 + the Opus session, (3) decide whether an in-app mic→conductor wire is in scope (today it isn't). Step 1–2 are on hold per Carson.

---

## The one decision that needs you

**Voice Conductor** is the only genuinely ambiguous one. It's the branch's main work and has tests, but the parity checklist still calls it *in-progress*. Everything else sorts itself cleanly. So: **PR Voice Conductor now, or finish it first?**

---

## PR finalization plan (decided 2026-07-15)

- **Squash the PR branch into a clean commit** at the end. The code has zero whole-word "Orca", but **11 commit messages** in history reference it (the rebrand/transfer commits). Squashing collapses them into one fresh message, so **no "Orca" appears anywhere in the PR** — code or history.
- Squash happens **once, at finalization** (after the feature removals + committing the in-flight baseline), so history isn't rewritten twice.
- Safe: branch `pr/v2-statusdigital-clean` has never been pushed and is not `main`.

## Recommended next step (not done here)

1. You review this picture and confirm the buckets.
2. Decide Voice Conductor: now or later.
3. **Then** pick how the V2 base lands (replace `main` in one base PR, vs. a long-lived `v2` branch). That's a git-strategy call we make *after* the picture is agreed — not before.
