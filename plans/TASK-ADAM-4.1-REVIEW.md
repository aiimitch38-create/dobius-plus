# TASK-ADAM-4.1 — REVIEW

Re-read of every changed file: `plugin-loader.ts`, `plugin-loader.test.ts`,
`self-edit.ts`, `jarvis-ipc.ts`.

## The risk this task was really about, settled with evidence

The built main process is **CommonJS**. If the bundler had rewritten
`import(...)` to `require(...)`, every `.mjs` plugin would fail to load in the
shipped app — and **no unit test in this repo could have caught it**, because
Vitest runs under an ESM loader where it always works. That is the precise shape
of bug the build file's WIRING CHECK exists for.

Checked against the real bundle rather than assumed. `out/main/index.js` emits:

```js
module2 = await import(node_url.pathToFileURL(sourcePath).href);
```

Un-rewritten, with the variable specifier intact. Plugins will load. The
loader's own strings (`adam-plugins`, `no PLUGIN export`, `not a valid plugin
name`, `loaded from`) are all present too.

One honest note: `plugin_` does **not** appear in the bundle yet.
`pluginToolName` is currently unreferenced, so it is tree-shaken. That is
correct for this task and it must reappear once TASK-ADAM-4.2 and 4.3 call it —
worth re-checking then rather than assuming.

## Defect found — a plugin could register a tool the model can never call

`toPlugin` defaulted a missing or non-string `description` to `''`. But
`ClientToolConfig` in `elevenlabs-tools.ts:13` declares `description: string`
as required, and the description is the **only** thing telling the model when to
invoke a tool. A plugin without one would load, register, consume an API call,
and then never be invoked — presenting to Carson as "my plugin does not work"
with nothing in any log explaining why.

That is the same silent-failure shape this build has hit twice already (the
`parameters`-as-array bug in TASK-ADAM-1.3, and the unregistered-tool case its
logging was added for). Fixed: a plugin with no description is refused at load
time with the reason `plugin "<name>" has no description`, so it shows up in the
startup warnings where Carson will see it. Three test fixtures that had used
`description: ''` were given real descriptions, which they should have had
anyway.

## Documented rather than "fixed" — ESM module caching

Node caches ES modules by URL, so calling `loadAdamPlugins` a second time in one
process returns the original module even after the file changes on disk.
Cache-busting with a `?v=` query string would leak one module per reload, so the
honest contract is restart-only, and it is now written into the function's doc
comment. Worth knowing before TASK-ADAM-4.2 considers a re-scan.

## Invariant B — both doors, both proven shut

- **Shell half:** already built and tested in TASK-ADAM-1.1
  (`shell-tool.test.ts:143`, five tests including a real `symlinkSync` case).
  Re-run here, not duplicated.
- **Self-edit half (this task):** `adam-plugins` added to `FORBIDDEN_SEGMENTS`,
  **imported** as `ADAM_PLUGINS_DIR_NAME` from `shell-tool.ts` rather than
  spelled a second time — the shell tool, the resolver and the loader must all
  mean one folder, and a second literal is exactly how they drift apart.
- The segment check now also runs against the **resolved** path, not only the
  requested string. A symlink named `notes` pointing at the plugin folder passes
  every lexical check; only resolution reveals where the write lands. This is
  the same hole TASK-ADAM-1.1's review found on the shell side, and it was open
  here until this task.

Falsifiability, checked per change rather than in aggregate:

| reverted | test that fails |
|---|---|
| `ADAM_PLUGINS_DIR_NAME` in `FORBIDDEN_SEGMENTS` | `refuses a self-edit write into the plugin directory`, `refuses a path whose REAL target is inside the plugin directory` |
| the resolved-path segment check | `refuses a path whose REAL target is inside the plugin directory` |

A negative control (`still allows an ordinary file in the same root`) guards
against the rule being drawn so wide it breaks self-edit outright. That test
initially failed for an unrelated reason — the resolver realpaths the parent
directory, which the test had not created — which would have made it a false
pass had it been written the other way round. Fixed by creating the directory.

## Reviewed and deliberately left alone

- **`getLoadedPlugins()` is exported but not yet called.** It exists so
  TASK-ADAM-4.3's `plugin:run` dispatch and 4.2's sync have one list to read,
  and without it `loadedPlugins` would be write-only. Three lines, both callers
  are named tasks in this build, and it lives in the same file. Flagged rather
  than hidden: if 4.2 and 4.3 do not use it, it should be deleted.
- **A plugin file that is a symlink out of the folder is still imported.** Only
  Carson can put a file there (invariant B), so this adds nothing over "Carson
  installed a plugin".
- **A directory named `*.mjs`** fails the import and is reported as a failure.
  Correct behaviour, no special case needed.
- **`loadAdamPlugins` cannot reject** — `readdirSync` and every `import` are
  inside `try`, including the `pathToFileURL` call. So the `void` at the call
  site cannot produce an unhandled rejection, matching
  `ensureAgentToolsRegistered`'s existing shape in the same file.
- **No hot reload, no sandbox, no versioning.** Cut in the plan and still cut.

## Verification after the fixes

- Scoped suite: **399 passing** (382 at end of 3.1, +17 for this task), exactly
  one failing file — `attach-main-window-services.test.ts`, the known
  pre-existing one.
- `tsgo --noEmit` exit 0 on both configs.
- `oxlint` clean on all four touched files. `plugin-loader.ts` is 183 lines,
  inside the 300-line cap.
- Build exit 0, with the dynamic import verified in the emitted bundle above.
