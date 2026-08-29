# TASK-ADAM-4.1 — Plugin loader (and invariant B)

Drop one `.mjs` file in a folder, Adam gains a tool, no rebuild. This is the
phase that makes future phases unnecessary: every capability so far cost a main
handler + an ElevenLabs registration + a renderer change + a rebuild.

This task also owns **invariant B**.

## Algorithm gate

1. **QUESTION.**
   - *Name validation?* Required, and not cosmetically. The name becomes an
     ElevenLabs tool name and the renderer's dispatch key, so
     `^[a-zA-Z_][a-zA-Z0-9_]{0,63}$` is what keeps a plugin from minting a name
     that collides with `ask_adam` or breaks the API call. Kept.
   - *Duplicate rejection?* Required — two plugins claiming one name means
     dispatch silently picks one, and which one depends on directory order.
   - *Catch throwing plugins?* Required. An unsigned third-party file must not
     be able to stop the app booting.
   - *The startup log line?* Required by the build file, and it is the only way
     Carson can see what is running. Nothing runs silently.
   - *A plugin sandbox / permission model?* **Cut.** Plugins are code Carson
     installs by hand into a folder Adam cannot write to. A sandbox would be
     protecting him from himself, and invariant B is what actually holds the
     line.
2. **DELETE.**
   - **Hot reload / file watching.** Carson installs plugins by hand; a restart
     is not a burden and a watcher on an unsigned-code directory is a liability.
   - **Versioning, dependency resolution, plugin ordering config.** None asked
     for, none needed for a folder of single files.
3. **SIMPLIFY.** Runtime `import()` of a `file://` URL is stdlib — no registry,
   no bundling step, no manifest file. Validation is one regex and three
   `typeof` checks. Invariant B's shell half is **already done and tested** in
   TASK-ADAM-1.1, so this task adds only the self-edit half rather than
   re-implementing containment; the `adam-plugins` name has one definition
   (`ADAM_PLUGINS_DIR_NAME` in `shell-tool.ts`) and `self-edit.ts` imports it.

## Verified before designing, not assumed

The built main process is **CommonJS** (`"type": "commonjs"`). A bundler that
rewrites `import()` to `require()` would make every `.mjs` plugin fail to load
at runtime, and no unit test in this repo would catch it — the tests run under
Vitest's ESM loader, where it always works.

Checked against the real bundle: `out/main/index.js` preserves `import(...)`
un-rewritten (14 occurrences, e.g. `await import("@parcel/watcher")`). The
WIRING CHECK for this task is therefore to confirm the loader's *variable*
dynamic import survives too, not just literal ones.

## What

**New `dobius/src/main/jarvis/plugin-loader.ts`.**

- `loadAdamPlugins(dir)` reads `*.mjs`, sorted for deterministic order, and
  returns `{ plugins, failures }` — never throws, never rejects. A failure
  carries the filename and a human reason, so a broken plugin is reported, not
  swallowed.
- Each plugin must export `PLUGIN = { name, description, parameters }` and an
  async `run`. Rejected: a missing/invalid export, a name failing the pattern, a
  duplicate name, a `run` that is not a function, and a module that throws on
  import.
- `runPlugin(plugin, parameters)` catches a throwing `run` and returns the error
  as text, so a bad plugin makes Adam say "that failed" rather than taking down
  the IPC handler.
- `pluginToolName(name)` → `plugin_<name>`. **The prefix lives here**, because
  TASK-ADAM-4.2 must decide tool ownership by this prefix rather than by a
  hardcoded list — `agent-context.ts:12-18` documents this codebase getting
  burned by exactly that, and here the failure mode is deleting a working tool.
- Every loaded plugin logged at startup by name and path; every failure warned.

**Invariant B — the self-edit half.** `adam-plugins` is added to
`FORBIDDEN_SEGMENTS` in `self-edit.ts`, imported from `shell-tool.ts` so the
folder has one definition. The segment check also runs against the **resolved**
path, not only the requested string: the requested string can be a symlink whose
real target is inside the plugin folder, which is the same hole TASK-ADAM-1.1
found and fixed on the shell side.

## Test

- a valid plugin loads and is returned
- a bad name is refused and named in `failures`
- a duplicate name is refused, and the FIRST one still loads
- a module that throws on import is reported, and the other plugins still load
- a plugin whose `run` throws is caught by `runPlugin`
- a missing `PLUGIN` export, and a `run` that is not a function
- a missing directory loads as empty rather than throwing
- **invariant B, self-edit:** a write into the plugin directory is refused
- **invariant B, self-edit via symlink:** a path whose real target is inside the
  plugin directory is refused
- **invariant B, shell:** already covered by
  `shell-tool.test.ts:143` — five tests, including the symlink case. Re-run, not
  duplicated.

Tests use real `.mjs` files in a temp directory and the real `import()`, because
a stubbed importer would not prove the mechanism this task depends on.

## Risks

- **Unsigned code in the main process.** That is the feature. Bounded by
  invariant B: Adam cannot write to the folder, so only Carson can install one.
- **Bundler rewriting the dynamic import.** Addressed above; confirmed by the
  WIRING CHECK against the built bundle rather than by assumption.

## Estimate

~150 lines of source, ~180 of test, plus the self-edit change.
