# REPAIR BUILD-045 — Full build graph and toolchain (#101 #114)

## Root cause
- **#101.** The retired `build-and-install.sh` ran only part of the build graph (no `build:cli`,
  `build:relay`, `build:web`, `build:native`) and still produced a bundle that looked installable.
  ADAM's Dobius adapter (`/Users/bayou/dobius/projects/ADAM/service/src/adapters/dobius.ts:116-130`,
  `snapshotBundle`) then refused it: it `statSync`s
  `Contents/Resources/app.asar.unpacked/out/cli/index.js`, the Electron framework binary and its
  `_CodeSignature/CodeResources`. BUILD-043 retired that script and `build:unpack` now runs the full
  graph (`pnpm run build` = `build:desktop` [typecheck, relay, electron-vite, web, cli] +
  `build:native` [computer-use helper on macOS]). What was still missing: nothing checked the
  **artifact** itself. `scripts/install-dobius-gated.sh`'s validate step only looked at Info.plist,
  the executable, `app.asar` existing, the arch and the provenance file, so a partial bundle from any
  other path (an old dist folder, a hand-made copy, a build that skipped a step) would still be
  swapped into `/Applications`.
- **#114.** `dobius/package.json` declares `engines.node: "24"`, CI reads it
  (`node-version-file: package.json` in `.github/workflows/*.yml`), but locally nothing pins or
  checks it: no `.nvmrc`, and pnpm only warns on an engine mismatch. Active Node observed on this
  machine during this build: **v22.22.3** at `/Users/bayou/.local/bin/node`. So local builds run on
  a different major than CI and nobody is told.

## Fix
- **New `scripts/bundle-manifest.py`** (beside the other installer helpers). One list of every
  artifact a packaged macOS app must contain, each tagged with the build step that produces it:
  - inside `app.asar` (parsed with the real asar header layout; entry must be a non-empty file whose
    data lies inside the archive, or be marked unpacked): `out/main/index.js`,
    `out/preload/index.js`, `out/renderer/index.html` (electron-vite), `out/web/web-index.html`
    (web), `out/cli/index.js` (cli);
  - non-empty files on disk: `app.asar.unpacked/out/cli/index.js` (the exact ADAM path),
    `app.asar.unpacked/out/package.json`, `app.asar.unpacked/out/main/daemon-entry.js`,
    `relay/<6 platforms>/relay.js` + `.version` (relay), and ADAM's two Electron framework paths
    (symlinks followed, as ADAM does);
  - executables: `Resources/bin/dobius`, the `Dobius+ Computer Use.app` binary (native).
  Exit 0 = complete, 1 = prints one line per missing item, 2 = usage. A non-asar `app.asar` is
  reported, not a crash. Verified read-only against the currently installed
  `/Applications/Dobius+.app`: exit 0, so the list matches a real full build.
- **`scripts/install-dobius-gated.sh`**: the manifest runs in the validate step on the STAGED copy,
  after the existing checks and **before the app is quit**. A missing artifact → lists them,
  `stage_invalid` (exit 7), stage removed by the existing cleanup, installed app untouched, app
  never quit. `bundle-manifest.py` joins the helper-presence check (exit 9 if missing; message now
  says "the install guards cannot run").
- **`dobius/.nvmrc`** = `24` (nvm/fnm pin, matches engines.node).
- **New `dobius/config/scripts/check-node-toolchain.mjs`**: prints
  `Node toolchain: active vX, required 24.x (package.json engines.node, .nvmrc): OK|MISMATCH`.
  Exit 1 on mismatch, `--warn-only` prints the same line as a WARNING and exits 0, exit 2 (never
  softened by `--warn-only`) if engines.node is not a bare major or `.nvmrc` disagrees with it.
  Wired as: `check:node-toolchain` script; first step of `build:unpack` and `build:mac` with
  `--warn-only`; first step of `build:mac:release` strict.
- Test fixtures (`install-dobius-gated-fixtures.mjs`): `makeBundle` now builds a complete bundle —
  a real asar archive (the `v1`/`v2` tag is an entry inside it; `asarOf` reads it back) plus every
  manifest path — with an `omit` option. The two existing suites changed only where they read the
  raw asar bytes (the recorder shim now prints the tag via `asarTagCommand`; the artifactSha256
  expectation hashes `fixtureAsar('v2')`).

## Tests
- `dobius/config/scripts/install-dobius-gated-manifest.test.mjs` (new, 16):
  complete bundle passes; each of 8 omissions (ADAM cli path, a relay.js, a relay .version, web
  index inside asar, main inside asar, native helper, bin/dobius, framework CodeResources) reported
  with its build step; empty file + non-executable shim reported; non-asar app.asar reported; every
  fixture path is individually required (fixture/manifest drift guard); **installer refuses a
  fixture bundle missing `out/cli/index.js` with exit 7, prior bundle kept, no stage/lock**; with
  recorder shims and `DOBIUS_INSTALL_TEST_MANAGE_APP=1`, an incomplete bundle never calls
  osascript/pgrep/pkill/open/lsregister; helper missing → exit 9; `build:unpack` runs
  `pnpm run build` whose graph includes relay/electron-vite/web/cli + native.
- `dobius/config/scripts/check-node-toolchain.test.mjs` (new, 7): repo pins 24 in both places;
  OK/MISMATCH messages print active vs required; unsupported range / missing engines / drifted
  .nvmrc → invalid; CLI strict exit 1 vs `--warn-only` exit 0 (run against a fixture requiring
  active+1, so it holds under any active Node); matching Node passes; `--warn-only` does not hide a
  broken requirement (exit 2); build scripts wiring.
- Existing `install-dobius-gated.test.mjs` + `install-dobius-gated-version.test.mjs`: all green
  with the manifest gate on (51 tests).

### Mutation checks (each seen FAIL, then restored and PASS)
1. Installer manifest call replaced with `$(true)` → 2 installer tests fail (refuse-missing-cli,
   never-quits).
2. `app.asar.unpacked/out/cli/index.js` removed from `DISK_FILES` → 4 fail (omission case, empty
   file case, drift guard, installer refusal).
3. `evaluateNodeToolchain` mismatch branch forced to OK → 2 fail (mismatch message, CLI strict exit).

## Verification
- `pnpm run typecheck` exit 0.
- Targeted vitest: install-dobius-gated (3 files), check-node-toolchain,
  package-electron-runtime-contract, electron-builder-with-build-number: all green.
  `electron-builder-config.test.mjs` has 4 failures that are pre-existing (listed in
  `stabilize-run/basefail.txt`; Linux artifact names/desktop entry), untouched here.
- oxlint + react-doctor oxlint: clean on all changed .mjs files. `bash -n` on the installer,
  `py_compile` on the helper.
- Full suite: DEFERRED (coordinator).
- No build, package or install was run; the installed app was only read (`bundle-manifest.py`
  and an asar header listing).

## Deviations from EXECUTION-ORDER.md
- The spec's `build-and-install.sh:25-31` edit is obsolete: BUILD-043 retired that script
  (prints the gated command, exits 1) and `build:unpack` already runs the full graph. #101's
  remaining gap was fixed as the brief directs: an artifact-manifest check in the gated
  installer's validate step. The build-graph requirement is locked by a test instead of a script edit.
- The manifest also checks ADAM's two Electron framework paths (existence only). ADAM additionally
  requires the framework binary to be >= 50 MB; that size check is NOT replicated (it would need a
  50 MB fixture per test run).
- Sherpa-onnx speech native modules (`Resources/node_modules/sherpa-onnx-darwin-<arch>`) are not in
  the manifest: they come from the dependency install, not the build graph.

## Decisions for Carson
- Local builds (`build:unpack`, `build:mac`) only WARN on a Node mismatch, because this machine
  runs Node 22 and a hard stop would block the only install path. `build:mac:release` is strict.
  Flip: remove `--warn-only` from `build:unpack`/`build:mac` once Node 24 is the active Node.

## Rollback
Revert the commit. The installer then validates as before BUILD-045; nothing persistent is written.

## Lessons
- The gated-installer fixtures used a plain-text `app.asar`; any check that reads inside the asar
  needs real asar fixtures. `fixtureAsar(tag)` builds one in ~20 lines (8-byte size pickle,
  header pickle, data).
