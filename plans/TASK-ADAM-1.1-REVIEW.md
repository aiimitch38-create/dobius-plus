# TASK-ADAM-1.1 — REVIEW

Re-read of `dobius/src/main/jarvis/shell-tool.ts` (212 lines) and
`dobius/src/main/jarvis/shell-tool.test.ts` before commit.

## Fixed in this pass

### 1. Invariant B was defeatable by a symlink (real hole, fixed)

`touchesPluginDir` ran two purely lexical checks: an `adam-plugins` path-segment
test, and a `startsWith` containment test on `resolve(token)`. Neither resolves
symlinks, so:

```
ln -s "$PLUGIN_DIR" /tmp/notes      # done once, by anything
cp evil.mjs /tmp/notes/evil.mjs     # classifies "writing", not "denied"
```

The command then reaches the approval window rendered as
`cp evil.mjs /tmp/notes/evil.mjs`, which reads as harmless, a human approves it,
and unsigned code lands in the plugin folder — executed in the main process on
every launch with no further approval. That is exactly the escalation path
invariant B exists to close, and the classifier did not close it.

`self-edit.ts:88` already solved the same problem for the same reason
(`resolveEditablePath` realpaths the parent directory). Fix reuses that shape
rather than inventing a second one: realpath the token's **parent** — the token
itself is usually a file that does not exist yet — and realpath `pluginDir`, then
containment-check. The resolver is injectable (`ClassifyOptions.realpath`,
defaulting to `realpathSync`), matching `resolveEditablePath`'s signature.

Test added: `denies a path that reaches the plugin folder through a symlink`,
built on a real `symlinkSync`, not a mock. **Verified it fails against the old
lexical-only logic (1 failed / 61 passed) and passes against the fix (62
passed)** — so it tests the hole rather than restating the implementation.

## Reviewed and deliberately left alone

- **`rm` is not on the hard-deny list.** `AUTONOMOUS-BUILD.md`'s deny list omits
  it (`TASK-ADAM-CONTROL.md` mentions `rm -rf /`; the build file wins). `rm` is
  not allowlisted, so it lands in `writing` and needs a human click. Correct: a
  human should be able to approve `rm` on a scratch file.
- **`grep -o` is escalated to `writing` though it means `--only-matching`.** A
  false positive that costs one approval click. The spec requires `-o`, and the
  stated bias is that every ambiguity resolves toward `writing`.
- **Non-string argv elements would throw a `TypeError`.** Not guarded here on
  purpose — `jarvis-ipc.ts` already coerces model input at the IPC boundary
  (`String(path ?? '')`), and that is where TASK-ADAM-1.3 will coerce this argv.
  A redundant second guard in a pure classifier is clutter. **Carried forward as
  an explicit requirement for 1.3.**
- **`chmod -R` against a relative path resolves via `process.cwd()`.** Only
  affects which of `denied`/`writing` a relative system-root path gets; both
  require approval or refuse. Not worth cwd plumbing.

## Verification

- `npx vitest run src/main/jarvis/shell-tool.test.ts` — 62 passed.
- Scoped gate — 283 passing, one failing file
  (`attach-main-window-services.test.ts`, pre-existing and expected).
- Both tsgo configs exit 0; `npx oxlint` clean on both files.
