# TASK-ADAM-3.1 — REVIEW

Re-read of every changed file: `proactive-watcher.ts`, `proactive-watcher.test.ts`,
`jarvis-ipc.ts`, `speech-types.ts`, `JarvisSettingsSection.tsx`.

One serious defect found, reproduced, and fixed; one piece of dead code removed.

## Defect — a filename was read as an outcome, so passing runs announced as failures

`classifyOutcome` matched its markers as bare substrings, and `error` is a
substring of a great many *filenames*. Measured on the pre-fix code:

```
PASSING RUN classified as:        failed
CLEAN VITE BUILD classified as:   failed
```

The first input was a green vitest tail:

```
 ✓ src/shared/codex-auth-errors.test.ts (12 tests) 30ms
 ✓ src/shared/git-remote-error.test.ts (8 tests) 12ms
 Test Files  2 passed (2)
      Tests  20 passed (20)
```

The second was a clean vite build listing an `ErrorBoundary-*.js` chunk. Both
would have made Adam say *"The run in dobius-adam failed."* about work that
succeeded.

This is not a rare edge. `find src -iname '*error*'` returns ten files in this
repo alone — `codex-auth-errors.test.ts`, `git-remote-error.test.ts`,
`computer-use-error-recovery.test.ts` and more — so any test run touching one of
them, and any React build with an error boundary, hits it. The design's stated
risk is *"an assistant that talks at you unprompted is intolerable if it is
wrong"*; this made it wrong most of the time, in the direction that matters
most.

**Word boundaries do not fix this**, which is the trap worth recording: `-` is
already a word boundary, so `\berrors\b` still matches `auth-errors`. The fix is
to drop the whole token — a path names a file, it does not report an outcome.
A `PATHS` regex now strips anything containing `/` or ending in a short
extension, before the marker scan.

Two consequences, both checked:

- `FAILURE_MARKERS` collapsed to `['fail', 'error', '✗', 'exit code']`. With
  paths gone, `fail` alone covers `FAIL`, `failed`, `failure` and `failing`.
  A real vitest failure — `FAIL src/main/window/attach-main-window-services.test.ts`
  — still classifies as failed after its path is stripped, and there is a test
  for exactly that so the fix cannot have gone too far.
- `Error: ENOENT, open /tmp/missing.json` still classifies as failed: the path
  is stripped, the word `error` remains.

## Correction carried over from the first VERIFY run

The neutralisation pass originally **deleted** phrases like `exit code 0` and
`0 errors`. That was wrong in the other direction: for a bare shell command,
`exit code 0` is the *entire* completion signal, so deleting it left a tail with
no marker at all and a real success went unspoken. They are now rewritten to
`✓`, because they are positive evidence, not noise.

## Dead code removed

`Outcome` declared a third member, `'finished'`, that `classifyOutcome` could
never return, and `phrase()` carried an unreachable branch for it. Both removed;
`phrase` is now a single expression.

## Falsifiability check

Reverting the path-strip alone fails exactly the two tests written for it:

| reverted | tests that fail |
|---|---|
| `PATHS` strip | `reads a green vitest run that names error-related test files as passed`, `reads a clean vite build listing an ErrorBoundary chunk as passed` |

## Reviewed and deliberately left alone

- **The 15-second poll instead of a file watcher.** The trigger requires 30
  seconds of silence, so sub-second precision buys nothing and chokidar would
  mean handles over directories that come and go with every terminal. This was
  the design's biggest deletion and it holds up.
- **The cooldown is checked before the completion scan.** A completion that
  occurs *during* a cooldown is therefore not recorded as announced, and can be
  spoken once the cooldown lapses — provided it is still inside the 10-minute
  staleness ceiling. That is the behaviour worth having: the alternative
  silently swallows the one build that failed while Adam was mid-sentence about
  another.
- **`announced` grows for the life of the process.** One small entry per
  worktree path ever seen, capped in practice by how many terminals exist. Not
  worth an eviction policy.
- **The watcher is started unconditionally** and re-reads the setting each tick.
  This is what removes the need for a settings-change subscription — the toggle
  takes effect within 15 seconds — and it speaks nothing at all while off, which
  is the default.
- **Quiet-hours inputs are clamped in the UI (`clampHour`).** An out-of-range
  hour would silently disable quiet hours rather than error, which is the wrong
  failure direction for a mute control.

## Verification after the fixes

- Scoped suite: **382 passing** (343 at end of 2.1, +39 for this task), exactly
  one failing file — `attach-main-window-services.test.ts`, the known
  pre-existing one.
- `tsgo --noEmit` exit 0 on both configs.
- `oxlint` clean on all five touched files. `proactive-watcher.ts` is 257 lines,
  inside the 300-line `max-lines` cap, so nothing needed splitting or
  suppressing.
- No new IPC channel and no new tool name in this task, so the WIRING CHECK's
  channel/tool grep does not apply; the build was still run and `ProactiveWatcher`
  confirmed present in `out/main`.
