# TASK-ADAM-4.3 — REVIEW

Re-read of every changed file: `voice-agent-client-tools.ts`,
`voice-agent-client-tools.test.ts`, `use-voice-agent.ts`, `plugin-loader.ts`,
`plugin-loader.test.ts`, `jarvis-ipc.ts`, `preload/index.ts`,
`preload/api-types.ts`.

## Defect — the tool map was accidentally a thenable, and it hung forever

The proxy's `get` trap returned a dispatch function for **any** unknown string
key. `then` is an unknown string key. That made the whole `clientTools` object a
**thenable**: promise machinery sees a callable `.then`, calls it with
`(resolve, reject)`, and waits for a resolve that is never sent — because the
call went to `jarvis:runPlugin` looking for a plugin named `then`.

Measured before the fix:

```
typeof tools.then = function
await Promise.resolve(tools) => HUNG — never resolved
```

Not a hang of milliseconds — it never settles. This map is handed to the
ElevenLabs SDK inside the `startSession` options object, so a single `await` or
`Promise.resolve` anywhere upstream in the SDK would freeze the conversation at
startup, with no error and nothing in any log. That is the worst failure shape
this build has produced, and the one hardest to diagnose from the symptom
("the orb just spins").

It also could not have been caught by the existing tests: `Object.entries` does
not see proxy fallbacks, so the invariant-A loop walks right past it.

**Fixed** with a `NEVER_DISPATCHED` set containing `then`, applied in both `get`
and `has`. Inherited keys (`toString`, `constructor`, `valueOf`) need no listing
because `in` walks the prototype chain and resolves them on the target; symbols
were already excluded. `then` is the one name that is neither inherited nor a
tool. Two regression tests: one asserting `Promise.resolve(tools)` settles, one
asserting inherited keys still resolve normally rather than dispatching.
Removing the guard fails the first.

## Defect — a type predicate that asserted something untrue

`isDispatchableName` was written as `property is string`. But it returns false
for plenty of strings — `then`, and every real tool name — so TypeScript
narrowed the false branch to `symbol`, which is simply wrong. It surfaced as
`TS2352` on `property as string`, and the tempting fix was to force the cast.

Forcing it would have buried an unsound assertion behind a cast. Changed to a
plain `boolean` and `Reflect.get(target, property)`, which is the idiomatic
proxy accessor and needs no cast at all. The web typecheck passes without any
suppression — which matters, because a `@ts-ignore` here is exactly what the
gate checks for.

## Extracted so the dispatch path could be tested at all

The tool-name lookup started inline in the `jarvis:runPlugin` handler. There is
no `jarvis-ipc.test.ts` in this repo and never has been — that file needs
Electron to import — so the only judgement in the dispatch path would have
shipped untested.

Moved to `runPluginByToolName(plugins, toolName, parameters)` in
`plugin-loader.ts`, leaving the handler a pass-through. Three tests, including
one that matters more than it looks: **a plugin is matched by its tool name
(`plugin_weather`), never by its bare name (`weather`)**. Matching the bare name
would let a foreign tool called `weather` reach plugin code.

This is the same move that made invariant A testable in 1.3 and the sync guard
testable in 4.2: if a rule cannot be reached from a test, it is not a rule.

## Why both explicit entries and a proxy

Not belt-and-braces for its own sake. **How the ElevenLabs SDK resolves a tool
name is not observable from here.** `clientTools[name]` needs the `get` trap;
enumerating `Object.keys` up front needs real entries. Nothing in this build can
open a live conversation to find out, and picking wrong ships a plugin system
that silently never fires — with the plugin, the registration and the IPC all
working, which is the hardest possible thing to debug. Both, for about fifteen
lines, is correct under either.

## Invariant A, re-checked under the new catch-all

The catch-all is a new door into the tool map, so the invariant was re-proven
rather than assumed:

- The existing loop still walks every real entry (`ownKeys` reports only real
  keys, so enumeration stays honest).
- A **new** test drives the fallback directly with the names an attacker-shaped
  plugin would choose — `approve_shell`, `run_approved_shell`, `apply_shell`,
  `plugin_evil` — and asserts none reaches `runApprovedShell` or
  `discardShellCommand`, and that all four land on plugin dispatch instead.
- A third test proves a plugin claiming `ask_adam` cannot shadow the real one.

## The wiring check this task exists to satisfy

The build file pairs "route any unrecognised name" with "the built bundle must
still contain every hand-written tool name" — the worry being a catch-all that
swallows the real tools. Re-greped after the build:

```
OK ask_adam   OK get_context   OK run_dobius   OK propose_code_change
OK apply_code_change   OK remember   OK forget   OK propose_shell
```

Plus `jarvis:pluginToolNames` and `jarvis:runPlugin` in both `out/main` and
`out/preload`, `There is no plugin called` in main, and `runPluginTool` in
preload and the renderer chunk. Nothing was swallowed.

## Reviewed and deliberately left alone

- **`has: () => true` for dispatchable names.** Needed so an SDK that checks
  `name in clientTools` before calling still dispatches. Real keys and inherited
  keys are unaffected; `then` is excluded by the same guard as `get`.
- **`pluginToolNames()` is fetched once per session start**, not watched. A
  plugin synced after the fetch still dispatches through the fallback, which is
  the whole reason the fallback exists — the explicit list is the fast path, not
  the only one.
- **No try/catch in `dispatchPlugin`.** `runPlugin` already converts a throwing
  plugin into a sentence, and an unknown name answers in words. A second catch
  would only obscure which layer failed.

## Verification after the fixes

- Scoped suite: **430 passing** (420 at end of 4.2, +10 for this task), exactly
  one failing file — `attach-main-window-services.test.ts`, the known
  pre-existing one.
- `tsgo --noEmit` exit 0 on both configs, with no suppressions added.
- `oxlint` clean on all eight touched files.
- Build exit 0; wiring check above.
