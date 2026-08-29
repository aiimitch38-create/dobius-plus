# TASK-ADAM-2.1 — Model-writable memory

Adam currently gets the last three conversation summaries and nothing he chose
to keep. This gives him `remember` and `forget`, persisted locally and injected
into the context he already receives at connect.

## Algorithm gate

1. **QUESTION.** Does `forget` need to exist, or is a per-value overwrite enough?
   It needs to exist, and the plan gives the evidence: he told Carson the disk
   was 98% full when it was 91%. An auto-remembered wrong fact that can only be
   overwritten (requiring you to know the key AND a correct replacement) is worse
   than no memory. Kept.
   Questioned and **cut**: free-form categories. Six fixed ones mean the model
   cannot invent `misc` and quietly turn memory into a junk drawer.
2. **DELETE.** No search/query API — the whole store is ~2,200 characters and is
   injected wholesale, so searching it is the model's job, not ours. No history
   or undo of forgotten values. No per-category caps on top of the global one.
3. **SIMPLIFY.** Plain JSON file + `writeFileSync`, the shape `SelfEditStore`
   would have used if it persisted. Reuse `ensureClientTool` from TASK-ADAM-1.3
   for registration rather than a second API layer.

## What

**New `dobius/src/main/jarvis/adam-memory.ts`.**

- Six fixed categories: `identity, preferences, projects, relationships, wishes,
  notes`. Anything else is refused with the valid list in the message, so a
  refusal teaches the model rather than just failing.
- `userData/adam-memory.json`. 380 chars per value, 2,200 total.
- Keys are normalised (trimmed, lowercased) so `Wife` and `wife ` are one entry
  rather than two contradictory ones.
- **Eviction: oldest `notes` first, then oldest of anything.** `notes` is the
  catch-all, so it is the right thing to lose; `identity` is the last.
- `remember`, `forget`, `list`, `format`.

**Injection into `agent-context.ts`.** The build file's constraint:
`buildAgentContext` already truncates at 8,000 chars while the agent prompt is
~8,400, so the memory block goes in **before** the truncation and must not push
the terminal context out.

Appending after the slice would leave the payload unbounded; putting memory
first inside the slice would let a full memory evict the terminal context, which
is the exact failure the build file names. So: **reserve memory's budget and
truncate only the machine-state portion.** Total stays bounded at 8,000, memory
is never silently dropped, and the terminal context loses only what memory
actually uses.

**IPC / preload / tools:** `jarvis:remember`, `jarvis:forget`, `remember` and
`forget` client tools, both registered with `ensureClientTool`.

Both tools return a short confirmation string. The plan's Mark LI `silent: true`
idea is **not** copied: these are `expects_response: true` like every other tool
here, because a `remember` that fails (bad category, cap hit) must be able to say
so. A silent failure is how a memory feature becomes untrustworthy.

## Test

- round trip: remember then read back through `list` and `format`
- an unknown category is refused and names the valid ones
- a value over 380 chars is refused (not silently truncated — a half-stored fact
  is worse than a rejected one)
- total-cap eviction drops oldest `notes` before anything else, and `identity`
  last
- re-remembering a key updates in place rather than adding a duplicate
- key normalisation: `Wife` and `wife ` are the same entry
- `forget` removes, returns false for an unknown key
- persistence: a second instance on the same file sees the first one's writes
- a corrupt/absent JSON file loads as empty rather than throwing
- **the injected context stays within 8,000 chars and still contains the terminal
  block when memory is full** — the specific regression the build file calls out

## Risks

- **Model writes junk into memory.** Bounded by the caps and the fixed
  categories, and `forget` is the escape hatch. The file is plain JSON in
  userData, so Carson can read or delete it by hand.
- **A wrong fact persists across calls.** That is the point of the feature and
  the reason `forget` ships with it rather than later.

## Estimate

~140 lines of source, ~170 of test, plus the context injection and wiring.
