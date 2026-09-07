# REPAIR — test fixtures still assert "Dobius" where the app renders "Dobius+"

## Symptom
34 tests fail across 20 files in `components/sidebar`, `components/settings`.
Pre-existing on `feat/vertex-task-backend`; not introduced by 9325a69d.

## Root cause (proven, not inferred)
The Orca -> Dobius+ rebrand swept user-facing copy in SOURCE but not in TEST fixtures.
Two files verified directly:

| source | test |
|---|---|
| `delete-worktree-toast.ts:39` "...clear it from **Dobius+**." | `delete-worktree-toast.test.ts:37` "...clear it from **Dobius**." |
| `agent-awake-copy.ts:24` "**Dobius+** also asks this device..." | `AgentsPane.test.tsx:163` "**Dobius** also asks this device..." |

Commit `3e1f63de` ("repair fixtures the rebrand left half-swept") fixed exactly 2 files
(`register-app-menu.test.ts`, `persistence.test.ts`). The rest were left.

## Danger — why a blind sed is wrong
Bare `Dobius` in these files is NOT always copy. Real occurrences include:
- `DobiusIndex`, `ensureDobiusCliAvailableOnPath` (identifiers)
- `unlinkDobius={vi.fn()}` (JSX prop)
- `Dobius.app/Contents/MacOS/Dobius` (path)
`s/Dobius/Dobius+/g` would produce `Dobius+Index` and fail to compile.

## Fix
Boundary-safe replacement only: `Dobius` NOT preceded by [A-Za-z0-9_] and NOT followed by
[+A-Za-z0-9_]. Applied per-file, with the test suite as the oracle:
  for each file: apply -> run that file's tests -> KEEP if green, REVERT if not.
No source files change. Only test fixtures.

## Verify
- `tsgo --noEmit` both configs exit 0 (guards against identifier corruption)
- failing count strictly decreases, no previously-passing test breaks

## Rollback
`git restore --worktree -- <file>` per file; nothing staged until green.

## Second pass — the remaining 9, four separate root causes (all fixed)

1. **`AddRepoHostSelector.test.tsx`** (1). Source `AddRepoHostSelector.tsx:156` says
   "Pair with **Dobius+** running on another computer."; the test said "Dobius". Only that
   line changed. Its other two Dobius assertions (`:133`, `:134`) are CORRECT as-is — they
   match `shared/protocol-compat.ts:63`, which the rebrand never swept and which still says
   bare "Dobius". This is why the blanket first pass reverted this file.

2. **`CommentMarkdown.test.tsx`** (2) and 3. **`repository-icon-github.test.ts`** (2) +
   **`RepositoryIconPicker.github-avatar-refresh.test.tsx`** (1). Same cause as the copy
   sweep but a different token: the `stablyai/dobius -> statusdigitalmarketing/dobius-plus`
   org rename updated the EXPECTED urls/labels and left the INPUT fixtures on `repo: 'dobius'`,
   so each test contradicted itself. Fixed the inputs (and the echoed-back `upstream:`
   expectations, which must move together). The `parkerrex` fixtures deliberately keep
   `repo: 'dobius'` — they model the fork's own origin slug, not the parent org.

4. **`VoicePane.test.tsx`** (3). Not a rebrand issue. `JarvisSettingsSection` mounts inside
   VoicePane and calls `window.api.jarvis.status()` in an effect (`:38`); the test's
   `window.api` mock had no `jarvis`, so the effect threw `TypeError: Cannot read properties
   of undefined (reading 'status')`. The component's `.catch()` cannot catch that — it is a
   synchronous property access on `undefined`. Added a `jarvis.status` stub shaped per
   `main/jarvis/jarvis-ipc.ts:172` (`{ shortcutActive, phase }`).

## Result
    34 failures -> 0.  334/334 files, 3433 passed, 3 skipped, exit 0.
    tsgo --noEmit exits 0 on both tc.web and node.
Only test fixtures changed across both passes. No source file, no behaviour.

## Third pass — the source copy itself (protocol-compat.ts, fixed)

`shared/protocol-compat.ts:61,63` were the last user-facing strings still saying bare
"Dobius" in the runtime-compat block. Both templates fixed (4 occurrences), and the two
assertions in `AddRepoHostSelector.test.tsx:133,134` moved with them — the same two lines
that were deliberately LEFT alone in the first two passes, because until now the code
genuinely said "Dobius" and the tests were right to match it. Fixing source is what makes
changing them correct.

These strings are plain template literals, not i18n keys (checked `locales/en.json`), so no
translation files needed updating.

## Still flagged — NOT fixed
Two files outside the requested scope still say bare "Dobius" in user-facing copy:
- `communications/features/agents/ui/personaModelDiscoveryStatus.ts:71`
  "This version of Dobius cannot use shared compute. Update Dobius or choose another provider."
- `shared/computer-use-error-recovery.ts:39`
  "Update Dobius or use a supported platform/provider path before retrying."
No test asserts either, so CI cannot catch them.

## Separately discovered — pre-existing failures in src/shared (NOT touched)
7 failures in 3 files, unrelated to any of this and present before these commits
(`tui-agent-startup.test.ts`, `feature-tips.test.ts`, `project-host-setup-projection.test.ts`
last changed in caee2df0; none imports protocol-compat). Symptoms are CLI-wrapper naming,
e.g. `expected 'dobius claude-teams' to be 'dobius-ide claude-teams'` — likely the same
half-finished rebrand, one token further on (`dobius` vs `dobius-ide`). Needs its own repair.
