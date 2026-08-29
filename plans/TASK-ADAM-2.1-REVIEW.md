# TASK-ADAM-2.1 — REVIEW

Re-read of every changed file: `adam-memory.ts`, `adam-memory.test.ts`,
`agent-context.ts`, `agent-context.test.ts`, `elevenlabs-tools.ts`,
`jarvis-ipc.ts`, `preload/api-types.ts`, `preload/index.ts`,
`voice-agent-client-tools.ts`, `voice-agent-client-tools.test.ts`.

Two real defects found, both **reproduced before being fixed** and both covered
by a test proven to fail against the pre-fix code.

## Defect 1 — the key was uncapped, so ONE fact could evict the whole machine state

`remember` capped the value at 380 chars and never capped the key, while
`entryCost` counts both. A single entry could therefore exceed `MAX_TOTAL_CHARS`
on its own, and `evict()`'s `this.entries.length > 1` guard meant it could never
be cleared — there was nothing else left to drop. The store stayed permanently
over cap.

That mattered because `composeAgentContext` reserves memory's *actual* length
and truncates only the machine state. Measured on the pre-fix code:

```
TOTAL COST = 10001   CAP = 2200
ctx length = 10048   budget = 8000
machine state present? = false
```

So one `remember` call produced a payload 26% over the hard ceiling with the
terminal context entirely absent — which is precisely the regression
`AUTONOMOUS-BUILD.md` names ("a full memory cannot silently push the terminal
context out of the payload"). The model chooses the key string, so this was
model-reachable, not theoretical.

The existing test for that boundary asserted only `not.toContain('Terminal 1')`
and carried the comment *"Memory is capped at 2,200 upstream, so this cannot
happen in practice"*. The probe above disproved the comment. A test whose
premise is false is worse than no test: it reads as coverage.

**Fixed** in three places, because the failure had three independent causes:

1. `MAX_KEY_CHARS = 80`, enforced in `remember` — one entry now costs at most
   460 against a 2,200 cap.
2. `evict()`'s `length > 1` guard removed; termination now comes from the
   protected-entry check below, which is sound only because of (1).
3. `composeAgentContext` slices memory to `MAX_MEMORY_CHARS`
   (`CONTEXT_BUDGET_CHARS / 2`). AdamMemory caps itself far under that, so this
   never fires in normal use — it is the boundary guard for a hand-edited
   `adam-memory.json`, which is a file the plan explicitly invites Carson to
   edit. The function's own doc comment promises a bounded payload; it now
   keeps that promise for every input, not just well-formed ones.

The stale test was corrected to assert the length bound *and* that the machine
state survives, and its misleading comment replaced with the measured numbers.

## Defect 2 — a new fact could evict itself, and `remember` still reported success

`evict()` ran after the write over all entries including the one just added.
When the store was near cap and the incoming entry's category ranked first for
eviction, the new entry was the only candidate its own eviction pass would pick.
Reproduced exactly:

```
cost before note = 2178   (of 2200)
result = {"ok":true}
stored? = false
```

`remember` returned `ok`, so `jarvis:remember` answered *"Saved. I'll remember
that."* and nothing was stored. The plan's own words: *"A silent failure is how
a memory feature becomes untrustworthy."* This was that failure.

**Fixed**: `evict(protectedKey)` skips the entry just written. If it is the only
one left, eviction stops rather than dropping it — bounded and terminating
because of the key cap from defect 1.

## Falsifiability check

Each fix was reverted individually and the suite re-run, to confirm no test was
merely decorative:

| reverted | test that fails |
|---|---|
| key cap | `keeps one entry inside the total cap even at both maximums` |
| protected-key eviction | `never evicts the fact it was just asked to remember` |
| memory share cap | `still bounds the payload when memory alone exceeds the budget`, `leaves the machine state at least half the budget however big memory is` |

## Reviewed and deliberately left alone

- **`remember` matches an existing entry by key alone, ignoring category**, so
  re-remembering a key under a different category moves it. Correct as written:
  `forget(key)` is also key-only, so keys must be globally unique or a fact
  could become unforgettable. Consistent, not a defect.
- **`format()` can slightly exceed `MAX_TOTAL_CHARS`** (headers, `  ` and `: `
  per line — roughly 200 chars at a realistic entry count). It is measured
  against the 4,000-char memory share, not the 2,200 store cap, so there is no
  interaction. Not worth a second accounting path.
- **`load()` does not re-validate lengths.** A hand-edited oversized entry is
  self-healing: the next `remember` evicts it (it is not the protected key), and
  the composer's share cap bounds the payload meanwhile. Adding a third cap here
  would be a fourth place to keep one number in sync.
- **Sequential `ensureClientTool` loop in `jarvis-ipc.ts`.** Correct and the
  comment explains why: each call reads and PATCHes `tool_ids`, so a
  `Promise.all` would race and the loser's tool would be dropped from a list it
  never saw. Left sequential.
- **Invariant A still holds.** The invariant-A test iterates the whole
  `clientTools` map, and `remember` / `forget` were added to the payload it
  probes. Neither touches `runApprovedShell`. Verified passing.

## Verification after the fixes

- Scoped suite: **343 passing** (318 at end of 1.3, +25 for this task), exactly
  one failing file — `attach-main-window-services.test.ts`, the known
  pre-existing one.
- `tsgo --noEmit` exit 0 on both `config/tsconfig.node.json` and
  `config/tsconfig.tc.web.json`.
- `oxlint` clean on all ten touched files.
- WIRING CHECK: `jarvis:remember`, `jarvis:forget`, `remember`, `forget` all
  present in `dobius/out` after `pnpm run build:electron-vite`.
