# REPAIR BUILD-048 — Docs and agent instructions (#108 #113 #116 #117)

## Root cause
The release and agent docs were written for the legacy V1 app (repo-root `electron/` + `src/`,
npm, root `electron-builder.yml`) and were never updated when V2 (`dobius/`) became the app,
nor when BUILD-043/044/045 replaced the install path. Nothing checked the docs against the code,
so they drifted silently.
- #108 `RELEASING.md`: `npm version` bumps the ROOT `package.json` (1.0.29, legacy V1) — the app
  version is `dobius/package.json` (2.0.0). `npm run electron:build -- --publish always` runs
  root `electron:build` = `pnpm --dir dobius build:mac`, which is the local, non-notarized build
  (`hardenedRuntime`/`notarize` are `isMacRelease` only, `dobius/config/electron-builder.config.cjs:239-240`,
  and `DOBIUS_MAC_RELEASE=1` is set only by `build:mac:release`), so it would publish an
  unnotarized build. Artifact names (`dobius-plus-x.y.z.dmg`,
  `electron-builder.yml`, `dist-electron/`, `build/entitlements.mac.plist`) are V1's; V2's DMG is
  `dobius-plus-macos-${arch}.dmg` (`:280`), entitlements `resources/build/entitlements.mac.plist`.
  "Checks 30s after launch and every 4 hours" is V1; V2 checks every 24 h with a 1 h retry
  (`dobius/src/main/updater-events.ts:15-16`), and only when updates are enabled — they are off
  (`dobius/src/main/dobius-disconnect.ts:4` `DOBIUS_SERVICES_DISCONNECTED = true`, and
  `updater-policy.ts` also needs `DOBIUS_ENABLE_DOBIUS_UPDATES=1`). The doc promised users would
  auto-update from a published release; they will not.
- #116 root `CLAUDE.md` + `.claude/CLAUDE.md`: point agents at `/Users/bayou/Projects (Code)/dobius-plus`
  (the old 1.0.x lane repos; the real repo is `~/Projects (Code)/Dobius/dobius-plus`), describe the
  V1 architecture (`electron/`, `src/`, Vite 6, npm scripts), tell agents to run
  `./build-and-install.sh` (retired by BUILD-043, prints a pointer and exits 1) and say it "MUST
  rm -rf the old .app" — the unsafe pattern BUILD-043 removed. `.claude/CLAUDE.md` also lists a
  stale 1.0.22 dirty-tree snapshot and a `~/Projects (Code)/CLAUDE.md` that does not exist.
  `dobius/AGENTS.md:1-17` repeats the wrong repo path.
- #113 `~/.claude/skills/dobius-build-install/SKILL.md` (external): description advertises the
  disabled repack installer and says electron-builder's packager is broken; usage shows only
  `[--take-over]`, no exit codes, no rollback; pre-flight uses nonexistent `~/DobiusPlus`; keeps the
  `pkill -9 -f "Dobius[+][.]app"` advice, which matches the terminal daemon
  (`Dobius+ Helper … daemon-entry.js`, a path inside `Dobius+.app`) and kills every live terminal.
- #117 (verify only): see Verification.

## Fix
- `RELEASING.md` rewritten from the V2 scripts and config: the everyday local path
  (`pnpm --dir dobius run build:unpack` → `scripts/install-dobius-gated.sh`), its flags, every
  exit code, rollback, provenance; the version/tag contract from BUILD-044; the signed release
  build (`build:mac:release` + the 5 env vars `verify-macos-release-env.mjs` requires), artifact
  names, and the plain fact that auto-update is disconnected so a GitHub release updates nobody.
- Root `CLAUDE.md` rewritten: repo role with `~`-relative canonical path, where V2 lives, legacy V1
  warning, real commands (pnpm, run from `dobius/`), the one install path, safety notes that still
  hold (daemon-safe kill, data path). V1-only notes (null bytes in `git-service.js`, tab mounting,
  keyboard shortcuts, V1 IPC lists) dropped. The `@.dobius/NOTES.md` import is kept: the file is
  untracked but lives in the main checkout and is the Dashboard Notes tab's shared memory.
- `.claude/CLAUDE.md` rewritten as a thin workflow layer: read order (no nonexistent workspace
  file), done-bar additions with real commands (typecheck, targeted vitest, oxlint, never
  `pnpm test` in a shared worktree), install via the gated script only.
- `dobius/AGENTS.md:1-17` rewritten: `~/Projects (Code)/Dobius/dobius-plus`, gated install.
  Lines 18+ untouched.
- New `dobius/config/scripts/check-docs-references.mjs` + test: the scripted check (see Tests).
- External (NOT edited, for Carson's approval): proposed full text of the skill and the hook in
  `stabilize-run/048/proposed-SKILL.md` and `stabilize-run/048/proposed-dobius-install-gate.sh`.

## Tests
`dobius/config/scripts/check-docs-references.test.mjs` (+ `check-docs-references.mjs`). For the
four docs (AGENTS.md only its first section — the rest is style guidance with example file names):
1. every `pnpm [--dir D] run <script>` names a script in that package.json (default `dobius/`);
2. every repo path in code spans/blocks exists (resolved from the doc's folder, repo root, then
   `dobius/`); build outputs, bundle-internal paths (`dist/`, `out/`, `Contents/`, `app.asar*`),
   the untracked `.dobius/` notes folder and `~`/`$HOME` paths are exempt;
3. every `--flag` on a line that runs `install-dobius-gated.sh` is an option the script's `case`
   accepts;
4. RELEASING.md's "Installer exit codes" table lists EXACTLY the `exit N` codes in
   `scripts/install-dobius-gated.sh` (both directions);
5. every `DOBIUS_*` env var named exists in the installer / `dobius/config` / `dobius/package.json`
   / `dobius/src/main/*.ts`;
6. banned text: `npm run|version|install`, `rm -rf`, `./build-and-install.sh`, either retired
   installer inside a fenced command block, `~/DobiusPlus`, `/Users/`, `pkill -9`, and any
   `pkill`/`killall` line naming `.app` (kills the daemon).
7. every rewritten doc names `scripts/install-dobius-gated.sh`, and the three agent docs name
   `~/Projects (Code)/Dobius/dobius-plus`.
Tests (12): the real docs pass and the CLI exits 0 on them; verbatim excerpts of the pre-fix
docs are flagged; one fixture repo per rule shows it catches a bad doc and accepts a good one.

## #117 (verify only) — CLOSED, already correct
- `~/.claude/SKILLS-HOOKS-AGENTS.md:108` now reads "Dobius+ does NOT re-assert them (no
  `ensureLearnHooks()` exists in the source, verified 2026-09-24)". Re-checked 2026-09-25.
- `grep -rn ensureLearnHooks` over the worktree (excluding node_modules): hits only in
  `docs/stabilization/` (the bug list and reports), none in source.
- The real hook writer is `dobius/src/main/claude/hook-settings.ts` `applyManagedHooks` /
  `removeManagedHooks`: it only adds/removes Dobius's own managed command (matched by script file
  name) and keeps every other hook entry, so the learn hooks are neither re-asserted nor removed.
  Nothing to change; no test (no code or repo doc involved).

## Verification
- Targeted: `config/scripts/check-docs-references.test.mjs` 12/12 green. CLI:
  `node config/scripts/check-docs-references.mjs` → "4 docs checked, all resolve.", exit 0.
- Seen FAIL without the fix (M1): the four docs restored from `HEAD` (pre-BUILD-048) → the
  real-docs test and the CLI test fail; the CLI lists 50+ findings (npm commands, `rm -rf`,
  `./build-and-install.sh`, `/Users/...` paths, `~/DobiusPlus`, `dist-electron`, `latest-mac.yml`,
  V1 file names, missing installer exit-code section, missing canonical repo / gated installer).
  Docs restored → green. Log: `stabilize-run/048/mut-M1-old-docs.log`.
- Mutations of the checker (each failed its test, then restored; logs `stabilize-run/048/mut-*.log`):
  M2 exit-code completeness off → exit-table test fails; M3 flag check off → flag test fails;
  M4 path check off → 3 tests fail; M5 pnpm script check off → pnpm test fails; M6 env check off →
  env test fails; M7 banned patterns off → 2 tests fail.
- Coupling to the code (each temporary, restored, `git status` clean afterwards): M8 an extra
  `exit 2` added to `scripts/install-dobius-gated.sh` → real-docs + CLI tests fail ("installer
  exit 2 is not documented"); M9 `--force` added to the RELEASING.md install command → real-docs +
  CLI tests fail.
- `pnpm run typecheck` exit 0. `npx oxlint` and the react-doctor config: 0 findings on the two new
  files (one `prefer-string-starts-ends-with` fixed). `oxfmt` run on the two new files only.
- Full suite: DEFERRED (coordinator).
- Not verified by running (building/installing is out of scope): the `dobius/dist/mac-arm64/`
  output path of `build:unpack` (it is the path the retired pointers and the pre-043
  `build-and-install.sh` used) and the release artifact set of `build:mac:release` (taken from
  `electron-builder.config.cjs`; `dmg.sign` default `false` read from electron-builder's
  `app-builder-lib/scheme.json`).

## External proposals (for Carson; not applied)
- `stabilize-run/048/proposed-SKILL.md` — full new `dobius-build-install` SKILL.md: description
  names only the gated path (no repack, no "packager is broken" — `build:unpack` packages with
  electron-builder `--dir`, and repo NOTES 2026-07-12 records a successful package), real
  pre-flight (no `~/DobiusPlus`), both flags, all exit codes, rollback, daemon-safe stop commands
  in place of `pkill -9 -f "Dobius[+][.]app"`, escaped `pgrep -a` running check, troubleshooting.
  Carson may also delete the skill's retired `scripts/` folder (repack.mjs, install.sh).
- `stabilize-run/048/proposed-dobius-install-gate.sh` — the hook with only the BLOCKED message
  changed (build command, both flags, pointer to RELEASING.md). `bash -n` clean; fed a
  `cp -R … /Applications/Dobius+.app` payload → exit 2 with the new text; `ls` payload → exit 0.

## Rollback
Revert the commit. Docs only plus one check script and its test; nothing runtime changes.

## Deviations from EXECUTION-ORDER.md
- External skill + hook not edited (brief): proposed text written to `stabilize-run/048/`.
- `.claude/settings.json` still allow-lists V1 `npm run …` commands and denies the retired
  `./build-and-install.sh`; not in the spec's file list and harmless (root npm scripts forward to
  `pnpm --dir dobius`), left as is.
- No `package.json` script added for the check: it runs as a vitest test in the normal suite;
  adding a script would touch a file other builds edit.
