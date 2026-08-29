# TASK-ADAM-4.3 — Generic plugin dispatch

The last wire. A plugin tool invoked by the agent has to reach `run()` in main,
without anyone hand-writing a renderer entry per plugin — that per-capability
cost is the whole thing Phase 4 exists to remove.

## Algorithm gate

1. **QUESTION.**
   - *Does the renderer need a catch-all, or would one explicit entry per loaded
     plugin do?* Explicit entries are simpler and enumerable. But the build file
     says "routes **any unrecognised** tool name", and its very next sentence —
     "the built bundle must still contain every hand-written tool name" — shows
     what the author was worried about: a catch-all that quietly swallows the
     five real tools. So the catch-all is wanted, and the wiring check is the
     guard on it. Kept.
   - *Then are explicit entries redundant?* No, and this is the reason to do
     both: **how the ElevenLabs SDK looks a tool up is not something this build
     can observe.** If it does `clientTools[name]`, only a proxy trap works. If
     it enumerates `Object.keys` to register handlers up front, only explicit
     entries work. Nothing here can run a live conversation to find out, and
     picking wrong ships a plugin system that silently never fires. Doing both
     costs about fifteen lines and is correct under either.
   - *Does dispatch need its own error handling?* No — `runPlugin` already
     converts a throwing plugin into a sentence. Deleted.
2. **DELETE.** No per-plugin renderer code, no plugin manifest in the renderer,
   no retry. The renderer learns only a list of names.
3. **SIMPLIFY.** Main already has `getLoadedPlugins()` and `runPlugin`. The
   renderer needs one IPC to run a plugin and one to list the names.

## What

**Main (`jarvis-ipc.ts`):**
- `jarvis:pluginToolNames` → `string[]` of `plugin_<name>` for loaded plugins.
- `jarvis:runPlugin` → looks the tool name up in `getLoadedPlugins()` and calls
  `runPlugin`. An unknown name returns a sentence rather than throwing, so the
  agent hears something it can say.

**Preload:** `pluginToolNames()` and `runPluginTool(name, parameters)`.

**Renderer (`voice-agent-client-tools.ts`):**
`createVoiceAgentClientTools(pluginToolNames: string[] = [])` builds the five
hand-written tools, adds one explicit entry per plugin name, then wraps the
result in a `Proxy` whose `get`/`has` fall back to plugin dispatch for any name
not already in the map. `ownKeys` returns the real keys, so enumeration — which
is what the invariant-A test relies on — is unchanged.

`use-voice-agent.ts` fetches the names before `startSession` (it is already in
an `async` function awaiting `agentOpening()`) and passes them in.

## The two things this must not break

1. **Invariant A.** The catch-all is a new way into the tool map, so the
   invariant-A test is extended: as well as iterating every real entry, it now
   invokes an unrecognised name and asserts that path cannot reach
   `runApprovedShell` either. A fallback that could execute a queued shell
   command would be the exact hole invariant A exists to close.
2. **The hand-written tool names must survive.** The default `[]` keeps
   `createVoiceAgentClientTools()` working for existing callers and tests, and
   the WIRING CHECK re-greps all eight names in the built bundle.

## Test

- an explicit plugin entry dispatches to `jarvis:runPlugin` with its name and
  parameters
- an **unrecognised** name dispatches through the proxy fallback
- `'ask_adam' in tools` and `Object.keys(tools)` still report the real tools,
  and enumeration does not include the fallback
- a hand-written tool is NOT shadowed by the fallback
- invariant A holds through the fallback path (new assertion, above)
- main: a known tool name runs its plugin; an unknown one returns a sentence
  instead of throwing

## Risks

- **The proxy is the one clever thing in this build.** It is confined to a
  single function, has all three traps written explicitly, and is covered by
  enumeration tests so a future reader is not left guessing.

## Estimate

~80 lines of source, ~120 of test.
