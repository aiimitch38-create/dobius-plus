# REPAIR BUILD-049 — lint debt (#115)

## Root cause
`pnpm run lint` could never pass, so it gated nothing and lint-staged blocked commits to any
file with old errors. The restored Communications tree (`src/renderer/src/components/communications/`,
double-quote/semicolon style, ported from a Tauri app) was never brought up to this repo's
`.oxlintrc.json`. Dobius features added since then (kanban, operations, settings) also added
unlocalized strings and unstyled scroll containers, and nothing ever ratcheted them.

## Measured before (stabilize/integration @ 27271eb9)
`oxlint`: 3,570 errors + 261 warnings in 663 files.
- By rule: curly 2,948 · max-lines 176 · array-type 170 · prefer-at 68 ·
  consistent-type-definitions 48 · no-explicit-any 37 · no-unescaped-entities 29 ·
  no-object-type-as-default-prop 19 · no-array-reverse 10 · consistent-type-imports 10 ·
  no-useless-spread 7 · no-useless-fallback-in-spread 7 · no-useless-return 7 · prefer-ternary 6 ·
  no-new-array 6 · prefer-template 4 · prefer-import-meta-properties 4 ·
  jsx-no-constructed-context-values 4 · consistent-indexed-object-style 3 · 1 each of
  no-duplicate-case, prefer-string-starts-ends-with, no-unused-expressions, prefer-math-min-max,
  jsx-fragments, jsx-no-useless-fragment, no-this-alias.
- By directory: components/communications 3,519 · components/kanban 23 · src/cli/runtime 10 ·
  src/main/communications 8 · components/sidebar 3 · src/renderer/src (App.tsx + a test) 2 ·
  src/main/dobius-cli 1 · src/main/agents 1 · config/scripts 2 · components/dashboard 1.
- The other `lint` steps also failed: switch-exhaustiveness 17 errors, styled scrollbars
  129 containers in 101 files, localization coverage 4,247 unlisted strings (allowlist was `[]`).
  Reliability gates and localization catalog passed.

## Fix (one commit per directory)
1. `communications/` — `oxlint --fix` restricted to safe rules (curly, array-type, type
   definitions/imports, prefer-template, prefer-at, import-meta-properties, fragments, …). Fixes
   were re-applied as a diff between formatter-normalised before/after copies, so no unrelated
   reformatting landed. Files where that patch did not apply got a small span-based curly
   fixer instead. Hand fixes: redundant trailing `return;` (5), unescaped JSX `'`/`"` →
   `&apos;`/`&quot;` (29), `reverse()` → `toReversed()` only where the receiver is a local copy
   (10), `import()` type annotations → `import type` (9), props `interface … extends` → type
   intersections (4), one ternary-as-statement → if/else, one unreachable duplicate
   `case "get_relay_http_url"` removed (the first, identical case already won; its comment moved
   up), now-unused `fileURLToPath` imports.
   Reverted on purpose: interface → type inside `declare module`/`declare global` (breaks
   declaration merging; `routeTree.gen.ts` is generated and untouched), and 17 `.at(-1)`
   conversions that made values `T | undefined` and failed typecheck.
2. `kanban/`, 3–6. sidebar/dashboard rows, canvas rpc test, cli metadata test, config scripts:
   curly, array-type, one inline `import()` type, one prefer-at, `import.meta.dirname`.
7. Ratchet for what is left: `config/lint-baseline.json` (file → rule → count for oxlint,
   switch-exhaustiveness, styled scrollbars) + `config/scripts/check-lint-baseline.mjs` +
   shared `config/scripts/lint-baseline/lint-baseline.mjs`. A check fails only when a
   file/rule count grows; `pnpm run lint:baseline:update` can only lower counts or drop entries.
   `check-styled-scrollbars.mjs` reads the same baseline. Localization uses its existing
   count-based allowlist, now populated (`config/localization-coverage-allowlist.json`).
   Wired into `pnpm run lint`, lint-staged (`--files` mode, only the staged files) and the
   `pr.yml` Lint step.

## Measured after
`oxlint` errors 3,570 → 290 (all in the baseline); `pnpm run lint` exit 0.
Baseline: max-lines 182 · no-explicit-any 37 · no-object-type-as-default-prop 19 · prefer-at 17 ·
consistent-type-definitions 10 (augmentations + generated file) · no-new-array 6 ·
no-useless-spread 6 (snapshot-before-mutate loops) · prefer-ternary 6 ·
jsx-no-constructed-context-values 4 · no-useless-return 2 (placeholder bodies) · no-this-alias 1;
switch-exhaustiveness 17; styled scrollbars 129; localization 4,247.
max-lines went 176 → 182: adding braces pushed 6 already-large communications files over 400.

## Tests
- `config/scripts/lint-baseline/lint-baseline.test.mjs` (15): growth/new rule/new file detected,
  shrink reported, scoped `--files` compare, shrink never raises/adds, exit code only on growth,
  warnings ignored, non-JSON oxlint output fails closed, arg parsing, scrollbar baseline filter,
  checked-in baseline and localization allowlist stay under recorded ceilings.
- End to end: appended an unbraced `if` to kanban-dates.ts (clean) and dobiusCommunications.ts
  (baselined): full check and `--files` check both exit 1 naming the file; restored → exit 0.
- Behaviour unchanged: `vitest` on `components/communications` 19 failed / 339 passed files —
  all 19 are in basefail.txt; running those 19 with the diff reversed gave the identical 59
  failing test names. Kanban 4/4 files, sidebar+dashboard+canvas+cli 170 files green (the one
  failing config test is baseline: missing module).
- Mutation checks (each failed the suite, then restored): M1 growth check off (3 fail);
  M2 shrink uses max (2); M3 extra baseline entry (ceiling, 1); M4 scrollbar filter removed (1);
  M5 warnings counted (1).

## Rollback
Revert per sub-commit. Reverting only the last commit restores the raw `oxlint` lint step.

## Deviations from EXECUTION-ORDER.md
- Not zero: a shrinking, checked-in baseline (the spec's alternative). No max-lines splits:
  182 files over the limit, none safely mechanical in this build (agent-runner.ts,
  KanbanBoard.tsx, dobiusCommunications.ts included).
- Touched outside the named directories: `package.json` (lint, lint-staged, new
  `lint:baseline:update`), `.github/workflows/pr.yml` (Lint step now uses the baseline check,
  so it loses GitHub inline annotations), `check-styled-scrollbars.mjs`,
  `localization-coverage-allowlist.json`.
- switch-exhaustiveness left in the baseline: each fix means deleting a `default` branch, which
  changes runtime behaviour for out-of-type values.

## Lessons
- `oxlint --fix` for `typescript/consistent-type-definitions` rewrites interfaces inside
  `declare module`/`declare global`, which silently breaks module augmentation.
- `unicorn/prefer-at` fixes are not type-neutral: `.at(-1)` returns `T | undefined`.
- lint-staged runs `oxfmt --write` on staged files; the Communications tree is not in repo style,
  so the first commit that touches a file there will reformat all of it.
