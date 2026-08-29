# TASK-ADAM-1.2 — REVIEW

Re-read of every changed file: `shell-command-store.ts`, its test,
`self-edit-window.ts`, `jarvis-ipc.ts`, `preload/index.ts`,
`preload/api-types.ts`, `ShellCommandReview.tsx`, `SelfEditView.tsx`.

## Fixed in this pass

### 1. A test that claimed to check the output cap and checked nothing

```ts
it('caps output so a huge listing cannot flood the agent turn', async () => {
  const store = new ShellCommandStore({}, async () => 'x'.repeat(10_000))
  const result = await store.propose(['ls', '/'])
  expect(result.kind).toBe('ran')     // <- asserts only that it ran
})
```

The injected runner returns 10,000 characters and the store never truncates —
truncation lives in `runArgv`, which this test replaced. So it asserted the
opposite of its name and would have stayed green if the cap were deleted
entirely. The real coverage is the next test
(`truncates real runner output at 4000 characters`, which exercises `runArgv`).
Deleted rather than repaired: a green test that cannot fail is worse than no
test, because it reads as coverage.

### 2. Two definitions of the plugin directory (invariant B drift risk)

`jarvis-ipc.ts` built the path with `join(app.getPath('userData'), 'adam-plugins')`
while TASK-ADAM-4.1 will need the same folder for the loader and for
`self-edit.ts`'s `FORBIDDEN_SEGMENTS`. Three hand-joined copies of one path is
precisely the drift that `agent-context.ts:12-18` records this codebase getting
burned by — and here the failure is silent: the deny rules would guard a folder
the loader no longer reads, and invariant B opens with every test still green.
Added `adamPluginDir(userDataPath)` to `shell-tool.ts` as the single definition;
4.1 must use it too.

### 3. The review window said "Nothing was run" about a command that had run

After `runApproved`, the id is deleted from the queue, so the second button's
`discardShellCommand` call returned `false` and the view still reported
`Discarded. Nothing was run.` The button already relabels to "Close" once output
exists; now it also skips the discard call and reports `Finished.` A review
surface that misreports whether something executed is worse than no message.

## The extra failing test files — a broken gate command, now fixed

The scoped gate intermittently reported a second and third failing file
(`tear-off-window.test.ts`, `createMainWindow.test.ts`), which the build file
defines as "you broke something — fix it before moving on". Nothing was broken,
and the cause turned out to be the gate itself.

Two hypotheses were wrong before the right one. First guess: my new test files
changed Vitest's worker sharding. Second guess: `vi.mock('electron')` plus a
dynamic import letting one file corrupt another's module registry. Both were
structural stories that fit the symptom. **Capturing the actual error text
settled it in one line:**

```
Error: Test timed out in 5000ms.
 ❯ src/main/window/tear-off-window.test.ts:22:3
     23|     const { validateTearOffTerminalRequest } = await import('./tear-of…
```

5000ms is Vitest's default. This project sets `testTimeout: 30_000` — and
`package.json` runs `vitest run --config config/vitest.config.ts`, because there
is no `vitest.config.ts` at `dobius/` root. **The bare `npx vitest run` in
`AUTONOMOUS-BUILD.md` and `scripts/verify-adam-task.sh` was loading no config at
all.** Those `src/main/window` files pull electron and pty through a cold TS
transform (~30s of transform for the scoped set), so under worker contention a
dynamic import blows a 5s budget. Also silently missing: the `@`/`@renderer`
aliases and `define: DOBIUS_FEATURE_WALL_ENABLED`, so a test needing any of them
would fail under the gate and pass under the real runner.

Fixed in `scripts/verify-adam-task.sh` and `AUTONOMOUS-BUILD.md` (both in the
blast radius). Measured:

| Command | Result |
|---|---|
| bare `npx vitest run` | 1 bad run in 6; failing files varied |
| `--config config/vitest.config.ts` | 4/4 clean, 295 passing, one failing file |

The passing count is identical either way, so **no baseline moved** — the 221
figure stands, it was only being measured with an unstable runner.
`attach-main-window-services.test.ts` remains the one expected failure and is
still left alone under hard rule 7.

## Reviewed and deliberately left alone

- **Re-classifying inside `runApproved` was cut.** `propose` is the only writer
  to the queue and never queues `denied`; `classifyShellCommand` is
  deterministic on argv, so the second call cannot disagree with the first.
- **The agent never hears a command's output.** It is told the command is
  waiting; the result goes only to the review window. A gap in conversation
  quality, not in safety, and closing it means handing the agent a channel keyed
  to the pending command — deferred rather than improvised here.
- **A re-registration of the IPC handlers builds a new store** and orphans
  pending commands. `SelfEditStore` has had the same property since it shipped;
  matching it beats a second lifecycle model.

## Verification

- Scoped gate (with the corrected `--config` command): **295 passing** (283 +
  12), one failing file (`attach-main-window-services.test.ts`), confirmed over
  four consecutive runs.
- Both tsgo configs exit 0. `npx oxlint` clean on all eight touched files.
