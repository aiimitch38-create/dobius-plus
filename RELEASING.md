# Releasing Dobius+

How to build Dobius+ and put it on a Mac: the everyday local install, and the signed release
build. Every command here is checked against the repo by
`dobius/config/scripts/check-docs-references.test.mjs`; if you change a script, flag or exit
code, update this file in the same commit.

## What is being built

- The app is **Dobius+ V2**, the code under `dobius/`. Its version is the `version` field in
  `dobius/package.json`.
- The repo root (`electron/`, `src/`, `package.json` at version 1.0.x, `electron-builder.yml`) is
  the **legacy V1 app**. Never package or ship it. The root `package.json` scripts without a
  `legacy:` prefix just forward to `pnpm --dir dobius …`.
- All commands below run from the repo root, `~/Projects (Code)/Dobius/dobius-plus`, with pnpm.
  Do not use npm.
- The repo pins Node 24 (`dobius/package.json` `engines.node`, `dobius/.nvmrc`).
  `pnpm --dir dobius run check:node-toolchain` prints the active and required versions.

## Local build and install (the everyday path)

There is exactly one way to put a build into `/Applications/Dobius+.app`:

```bash
pnpm --dir dobius run build:unpack
scripts/install-dobius-gated.sh dobius/dist/mac-arm64/Dobius+.app
```

`build:unpack` does, in order:

1. `config/scripts/check-node-toolchain.mjs --warn-only` — warns (does not stop) when the active
   Node is not 24.
2. `config/scripts/electron-builder-with-build-number.mjs --snapshot-source` — records the source
   state (branch, commit, dirty flag, diff digest, tag) BEFORE compiling.
3. `pnpm run build` — the full graph: typecheck, relay, electron-vite, web, CLI, native helper.
4. `pnpm run ensure:electron-runtime`.
5. electron-builder `--dir` through the same wrapper, which hands out the next machine-wide build
   number (counter file `~/.dobius-build-number`, becomes `CFBundleVersion`) and seals the
   pre-compile source record into the app as `Contents/Resources/BUILD-PROVENANCE.json`. If the
   tree changed during the compile, packaging stops.

Packaging also checks bare runtime imports in the compiled main, CLI, and shared JavaScript
against the dependencies copied to the bundle's Resources/node_modules directory. After installing, verify the
packaged CLI with `dobius status --json`; a successful GUI launch alone does not validate the CLI.

The output path above is for an Apple-silicon Mac (it is the path the retired scripts print).

`scripts/install-dobius-gated.sh` then:

1. checks that `python3` and its helpers (`scripts/semver-compare.py`, `scripts/source-state.py`,
   `scripts/bundle-manifest.py`, its sibling `scripts/bundle-resource-contract.py`, and
   `scripts/install-record.py`) are present;
2. takes the lock `~/.dobius-install.lock` (waits up to 300 s for another install; a stale lock
   is reported, never broken);
3. refuses a build from another branch than the installed one unless `--take-over`;
4. refuses a build whose version is not valid SemVer, and one that is OLDER than the installed
   app (SemVer precedence: `2.0.0-rc.1` is older than `2.0.0`) unless `--allow-downgrade`;
5. copies the build to a stage beside the app, prepares the install record, and validates the
   stage (Info.plist, executable, arch, `app.asar`, and every artifact in
   `scripts/bundle-manifest.py`). The manifest inspects the bounded `out/main` JavaScript graph
   for the catalog RPC methods `data.catalog.roots` and `data.catalog.page`, including packed
   chunks and files in `app.asar.unpacked`. When either method is present, or either catalog
   helper resource is present, both
   `Contents/Resources/data-catalog/descriptor-directory-bridge.py` and
   `Contents/Resources/data-catalog/native-root-identity.py` must be readable, non-empty regular
   files below `Contents/Resources`; symlinked helpers or parent directories are refused. A
   legacy bundle with neither catalog RPC code nor either helper remains eligible, so the
   documented rollback command can restore builds from before the catalog feature. Malformed or
   oversized capability graphs fail closed. The same bounded main-code inspection requires all
   nine `Contents/Resources/adam-telegram/` runtime assets when the compiled Adam bridge or any
   part of its resource tree is present: seven Python modules, the reviewed Hermes policy
   manifest, and its maintained patch. Legacy bundles without that feature remain eligible.
   Nothing is written into the bundle, so its code
   signature stays intact;
6. only then requests app quit (the terminal daemon and its shells keep running), applies the
   existing scoped main/Chromium quit signals, and verifies the main process has exited before
   swapping. If the main app survives, it refuses before the swap and keeps the installed bundle
   and rollback state; otherwise it swaps the stage in with one atomic rename, writes the install
   record, keeps ONE rollback copy (with its record), removes the `dobius/dist` build copy,
   re-registers the app with LaunchServices and relaunches it;
7. logs the install to `~/.dobius-install-history.log`.

Any failure before the swap leaves the installed app untouched and running.

### Flags

| Flag | Use it when |
|---|---|
| `--take-over` | The installed app was built from another branch and you mean to replace it. Tell that lane. |
| `--allow-downgrade` | You really mean to install an older version, or the installed app has no valid version. |

`--take-over` never bypasses the version guard, and `--allow-downgrade` never bypasses the branch
check. Any other option is refused.

### Installer exit codes

| Exit | Meaning | Installed app |
|---|---|---|
| 1 | Bad arguments: unknown option, no bundle at the path, missing install folder, or the path is the installed app itself | untouched |
| 3 | The installed app belongs to another branch; re-run with `--take-over` if you mean it | untouched |
| 4 | Another install held the lock for longer than the wait | untouched |
| 5 | Version guard: the build has no valid version, or it would downgrade (or the installed version is invalid) | untouched |
| 6 | Copying the build to the stage failed | untouched |
| 7 | The staged copy is not a runnable, complete build (lists the missing artifacts) | untouched, never quit |
| 8 | The atomic swap failed | untouched, relaunched |
| 9 | `python3` or an installer helper is missing, or the installed app's record cannot be looked up, so the guards cannot run | untouched |
| 10 | The main app is still running or its exit could not be verified after the scoped quit attempt | untouched; staged copy removed and unchanged app reopened |
| 130 | Interrupted (Ctrl-C or TERM); a partial stage is removed. A signal that lands between the quit and the rollback move waits until the swap, the install record and the rollback copy are done | relaunched if it was quit |

### Rollback

Every install that replaced an app keeps the previous one at
`~/Library/Application Support/dobius-plus-install-backups/Dobius+.previous` (no `.app` suffix,
so macOS never registers it as a second app). The installer prints the exact command; it is:

```bash
scripts/install-dobius-gated.sh "$HOME/Library/Application Support/dobius-plus-install-backups/Dobius+.previous" --take-over --allow-downgrade
```

### Install record

The installer records whose build is installed (branch, commit, repo, dirty, tag, version,
buildNumber, artifactSha256, install time) OUTSIDE the app, so the app's code signature stays
valid (`codesign --verify --deep --strict "/Applications/Dobius+.app"` passes):

- the installed app: `~/Library/Application Support/dobius-plus-install-backups/INSTALL-PROVENANCE.json`
- the rollback copy:
  `~/Library/Application Support/dobius-plus-install-backups/Dobius+.previous.INSTALL-PROVENANCE.json`. A rollback reinstall
  takes its source state from this record when the bundle has no build record.

```bash
cat "$HOME/Library/Application Support/dobius-plus-install-backups/INSTALL-PROVENANCE.json"
```

Each record carries `bundleIdentity` (a hash of the bundle's Info.plist and code seal, see
`scripts/install-record.py`); readers use it only for the bundle it names. An app installed
before this change has its record inside the bundle at `Contents/Resources/INSTALL-PROVENANCE.json`,
and readers fall back to that.

### Retired entry points

`build-and-install.sh` and `scripts/install-dobius-v2.sh` are retired. They only print the two
commands above and exit 1. Never write to `/Applications/Dobius+.app` by hand (copy, move or
delete); the global install-gate hook blocks it and the gated script is the only path it allows.

### Stopping the app by hand

Never kill by bundle path (a pattern like `Dobius+.app`): the terminal daemon runs from inside
the bundle as a `Dobius+ Helper` process, and killing it ends every live terminal session.
The installer's own quit uses `pkill -a -x "Dobius\+"` (main app only) and
`pkill -f "Dobius\+ Helper.*--type="` (Chromium helpers only), then checks that the main app
process is gone before replacing its bundle. A surviving main process or an inconclusive process
check makes the installer refuse with exit 10; it does not broaden the kill scope.
The wait and final check match the exact `Dobius+` process name, so valid command-line arguments
such as `--remote-debugging-port` do not hide the running app.

## Versions and tags

- `dobius/package.json` `version` is set by a person, on purpose, as SemVer. Builds never rewrite
  it. It is the only thing the downgrade guard compares.
- Each local build gets the next build number automatically. macOS shows it as
  "Version 2.0.0 (57)". It orders builds on this machine only and never makes an older version
  look newer.
- Moving forward (rc.1 → rc.2 → 2.0.0 → 2.0.1) installs with no flag. Reinstalling the same
  version is allowed. Anything older needs `--allow-downgrade`.
- A release is an annotated tag `v<version>` on a clean commit. The install record
  (`tag`, `commit`, `dirty`, `version`, `artifactSha256`) lets you check an install against
  the tag.

## Signed release build (other Macs)

Auto-update is **off** in this build. `dobius/src/main/dobius-disconnect.ts` sets
`DOBIUS_SERVICES_DISCONNECTED = true`, and `dobius/src/main/updater-policy.ts` also requires
`DOBIUS_ENABLE_DOBIUS_UPDATES=1` in a packaged app. Publishing a GitHub release therefore updates
nobody: every Mac, including this one, installs through the gated installer. Turning updates back
on is a code change and a separate decision.

To produce signed, notarized artifacts:

```bash
pnpm --dir dobius run build:mac:release
```

It stops before building unless:

- the active Node is 24 (strict `config/scripts/check-node-toolchain.mjs`, no `--warn-only`);
- these environment variables are set (checked by `config/scripts/verify-macos-release-env.mjs`):
  `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `CSC_LINK` (the Developer ID
  certificate file), `CSC_KEY_PASSWORD`. Keep them in your shell or keychain, never in the repo.

With `DOBIUS_MAC_RELEASE=1` (set by the script), `dobius/config/electron-builder.config.cjs` turns
on the hardened runtime, notarization and forced code signing, using the entitlements in
`dobius/resources/build/entitlements.mac.plist`. Output goes to `dobius/dist/`:

- `dobius-plus-macos-arm64.dmg` and `dobius-plus-macos-x64.dmg` (`dmg.artifactName`);
- a `.zip` per arch with electron-builder's default name (no `artifactName` is set for it);
- the unpacked apps (for example `dobius/dist/mac-arm64/Dobius+.app`), plus any update metadata
  electron-builder writes, which only matters if auto-update is ever re-enabled.

The DMG file itself is not signed: the config sets no `dmg.sign`, and electron-builder's default
is `false`. The app inside it is signed and notarized.

`build:mac:release` does not use the build-number wrapper: `CFBundleVersion` is the plain version
and no `Contents/Resources/BUILD-PROVENANCE.json` is sealed, so a gated install of it records the source state at
install time (`"sourceStateFrom": "install"`).

Check the app before handing it to anyone:

```bash
spctl -a -vvv dobius/dist/mac-arm64/Dobius+.app
```

Expected: `accepted` with `source=Notarized Developer ID`.

The release target in the config is GitHub `statusdigitalmarketing/dobius-plus`. The workflows
under `dobius/.github/workflows/` are inherited from the upstream engine; GitHub only runs
workflows from the repository root's `.github/`, so they do not run for this repo. Upload
artifacts by hand with `gh release upload` if you publish one.

## Local signing (optional)

Local builds (`build:unpack`, `build:mac`) sign with `CSC_NAME` if set, otherwise the first
keychain identity found in this order: Developer ID Application, Apple Distribution, Apple
Development, `Dobius Local Signing`. With none of these they are signed ad-hoc, and macOS then
treats each build as a new app (permission grants for microphone, accessibility and screen
recording are dropped). A self-signed `Dobius Local Signing` certificate keeps one identity
across builds.
