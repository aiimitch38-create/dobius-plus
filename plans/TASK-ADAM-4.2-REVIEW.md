# TASK-ADAM-4.2 — REVIEW

Re-read of every changed file: `elevenlabs-tool-sync.ts`,
`elevenlabs-tool-sync.test.ts`, `elevenlabs-tools.ts`, `jarvis-ipc.ts`.

Three real findings, all fixed.

## Finding 1 — a test that claimed to prove the safety rule and did not

The first version of `INVARIANT — the executor refuses a poisoned plan` called
`syncPluginTools` with an empty plugin list and asserted no `DELETE` happened.
That passes, but it proves nothing about the executor's guard: the **planner**
already filtered the foreign tools out, so the guard was never reached. It
duplicated an existing test while wearing the name of the one thing this task
most needed proven.

This is the same failure mode TASK-ADAM-1.2's review caught (a "caps output"
test that would have stayed green with the cap deleted) and the same one 4.1's
review caught (a comment asserting something impossible that was not). A test
whose premise is unreachable is worse than no test, because it reads as
coverage.

Fixed structurally rather than by rewording: `applyToolSync(apiKey, agentId,
plan, fetch)` is now split out of `syncPluginTools`, so a plan the planner would
never produce can be handed straight to the executor. The test now passes
`remove: [ask_adam, something_carson_made]` and asserts zero `DELETE` calls plus
both refusal messages. A companion test (`still deletes the prefixed tools in a
mixed plan`) guards against the refusal being drawn so wide the sync stops
working.

Falsifiability, per layer:

| reverted | tests that fail |
|---|---|
| the executor's prefix guard | `will not delete a non-prefixed tool even when handed one directly`, `still deletes the prefixed tools in a mixed plan` |
| the planner's prefix filter | `never proposes deleting ask_adam…`, `leaves a tool Carson made himself alone…`, `does not treat a foreign tool as an update candidate`, and two `syncPluginTools` tests |

Neither layer is decorative.

## Finding 2 — two startup paths racing to PATCH the same agent

`registerJarvisIpcHandlers` had `void ensureAgentToolsRegistered(store)` and the
plugin startup path fired **concurrently**. Both read the agent's `tool_ids` and
PATCH them back, so whichever finished second would write a list computed before
the other's tools existed — silently dropping them.

This is precisely the hazard `ensureAgentToolsRegistered`'s own internal loop is
sequential to avoid; the comment explaining it is in the same file. The race was
simply one level up, between the two callers.

Fixed: one `registerToolsAndPlugins(store)` that awaits the built-in
registration, then loads plugins, then syncs — strictly sequential, with the
reason written at the call site.

## Finding 3 — widening a return shape broke a contract another test pinned

Adding `description` and `parameters` to `ToolSummary` was implemented by always
emitting them, defaulting `description` to `''`. That broke
`elevenlabs-tools.test.ts` ("reads id and name out of the tool_config
envelope"), which deep-equals `{ id, name }`.

The lazy fix would have been to edit that assertion. The right fix was the
opposite: **stop fabricating the keys.** A tool whose `tool_config` carries no
description should not come back claiming to have an empty one — that is the
parser inventing data the API never sent. Keys are now only set when present,
the existing contract is untouched, and the test that caught it stands
unmodified.

Worth noting the failure was caught by the count, not by reading: the scoped run
went to **two** failing files. That is exactly what the build file's "if a
second file starts failing, you broke something" rule is for, and it worked.

## Verified in the bundle, as 4.1's handoff required

4.1 recorded that `plugin_` was absent from `out/main/index.js` because
`pluginToolName` was unreferenced and tree-shaken, and said to re-check once
4.2 called it. Re-checked after this task's build:

```
plugin_             1
adam-plugins        1
refused to delete   1
not a plugin tool   1
/tools/             2
```

Present, including both guard strings and the new `/tools/{id}` endpoint used by
update and delete.

## Reviewed and deliberately left alone

- **`differs` compares `parameters` with plain `JSON.stringify`.** Key order
  matters to it, but the remote config was created from this same local shape,
  so order matches; and a false "changed" costs one idempotent PATCH. A
  recursive canonical stringify is a dozen lines guarding a problem that has not
  occurred. Cut in the plan, still cut.
- **`deleteClientTool` treats HTTP 404 as success.** A tool already gone is the
  state the caller wanted, and failing would make every later sync retry a
  delete that can never succeed. Tested.
- **No rollback of a partially applied sync.** The next launch re-syncs; that is
  what convergence means. A rollback path would be more code with more ways to
  go wrong, running against a live account.
- **`reconcileAgentTools` does nothing when nothing changed**, so an ordinary
  launch with no plugin changes makes zero writes. Tested (`makes NO destructive
  call…` asserts zero `PATCH` as well as zero `DELETE`).

## Unverified, and flagged for Carson

As in TASK-ADAM-1.3: the endpoint shapes for `PATCH /tools/{id}` and
`DELETE /tools/{id}` are implemented to the documented shape and tested against
a fake `fetch`. **No billed calls were made against Carson's account.** The
first launch with plugins installed is worth watching for
`[jarvis] plugin tools synced …` or a `[jarvis] plugin tool sync: …` warning.

## Verification after the fixes

- Scoped suite: **420 passing** (399 at end of 4.1, +21 for this task), exactly
  one failing file — `attach-main-window-services.test.ts`, the known
  pre-existing one.
- `tsgo --noEmit` exit 0 on both configs.
- `oxlint` clean on all four touched files.
- Build exit 0; wiring check above.
