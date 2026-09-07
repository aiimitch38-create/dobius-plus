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

## Known NOT covered (separate bugs, left alone)
4 failing files have no bare "Dobius": CommentMarkdown, RepositoryIconPicker.github-avatar-refresh,
repository-icon-github, DeleteWorktreeDialog(partial). Symptoms include
`expected 2832 to be less than -1` and `Cannot read properties of undefined (reading 'status')`
— different root causes, not diagnosed here.
