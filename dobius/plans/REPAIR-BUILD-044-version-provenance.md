# REPAIR BUILD-044 — Version, provenance, auto-bump (#102 #109 #110 N8 X2 + auto build number)

## Root cause
- #102: the downgrade guard in `scripts/install-dobius-gated.sh` built its sort key with
  `re.findall(r"\d+", v.split("-")[0])[:3]`, dropping everything after the first `-`.
  `2.0.0-rc.1` and `2.0.0` got the same key `[2,0,0]`, so `src >= dst` passed and a
  release candidate installed over the stable app. rc.1 vs rc.2 also compared equal.
- N8: the guard ran only `if [ -n "$SRC_VER" ] && [ -n "$DST_VER" ]`. A bundle with no
  `CFBundleShortVersionString` (or an installed app without one) skipped the check. Any
  unparseable string became `[0]` or an arbitrary digit list.
- X2 / #109: `INSTALL-PROVENANCE.json` held only `branch`, `commit` (short HEAD), `repo` and
  the time. An install built from a dirty tree looked identical to a clean build of HEAD.
  That is how "installed 2.0.0" came from an rc.1 commit plus uncommitted work. Nothing tied
  the record to the artifact itself (no version, no build number, no hash).
- #110: nothing recorded whether the source was a tagged release, so a release could not be
  matched to a tag.
- Auto-bump: the version only moved when someone edited `dobius/package.json`, and
  `CFBundleVersion` was always the plain version, so two builds of the same version could
  not be told apart.

## Fix
- `scripts/semver-compare.py` (new): a strict SemVer 2.0.0 parser plus precedence.
  `valid <v>` gives exit 0/2. `ge <a> <b>` gives exit 0 when a >= b, 1 when older, and 2
  when either version is missing or invalid. Prerelease < release. Numeric identifiers
  compare numerically, so rc.10 > rc.2. Build metadata (`+N`) is ignored, as SemVer
  requires. It is a separate file so every ordering case can be tested directly, without a
  full install per case.
- `scripts/install-dobius-gated.sh`:
  - Version guard (runs after the lock, as before): the source version must be valid
    SemVer, or the install is refused with exit 5. This applies even with `--take-over`,
    because a bundle without a version is not a valid build (N8). When `$DEST` exists
    and `--take-over` is absent, the installed version must also be valid. If it is not,
    the install is refused ("cannot be proven not to be a downgrade"). Otherwise the
    source must be `>=` the installed version by SemVer precedence (#102). A helper
    failure (python missing, helper missing) is a non-zero exit, so it fails closed.
  - `plist_value` helper keeps BUILD-043's `-f` guard, so PlistBuddy's "File Doesn't
    Exist" text is never read as a version.
  - Provenance JSON gains these fields (nulls, never guesses):
    - `dirty`: from `git status --porcelain --untracked-files=all`.
    - `diffDigest`: `sha256:` over `git diff HEAD --binary`, plus each untracked,
      non-ignored path with its content hash. Symlinks hash their target.
    - `tag`: `git describe --exact-match HEAD`, which matches annotated tags only.
    - `version`: CFBundleShortVersionString.
    - `buildNumber`: CFBundleVersion, only when it is a positive integer.
    - `artifactSha256`: the staged `app.asar`.

    Existing keys are unchanged, so the ownership check still reads `branch`.
  - The INSTALLED line and the history log now include `version X build N`.
- Auto build number:
  - `dobius/config/scripts/electron-builder-with-build-number.mjs` (new) allocates the
    next number from a machine-wide counter, `~/.dobius-build-number` (tests override it
    with `DOBIUS_BUILD_NUMBER_FILE`). The lock is an mkdir lock with a 30 s wait. A held
    lock is reported, never broken. The write is atomic (tmp + rename). A corrupt counter
    throws; it is never reset. The script then runs `electron-builder` with
    `DOBIUS_BUILD_NUMBER` set and passes its exit code through.
  - `dobius/config/electron-builder.config.cjs`: `mac.bundleVersion` = `DOBIUS_BUILD_NUMBER`,
    which must be a positive integer or the config throws. When unset it is `null`, which is
    electron-builder's default (the plain version). The number is allocated only in the
    wrapper, never when the config is required, because tests require the config.
  - `dobius/package.json`: `build:unpack` and `build:mac` call the wrapper in place of
    `electron-builder`. The `ensure:electron-runtime` guard is unchanged.
    `build:mac:release`, `build:win` and `build:linux` are unchanged.

## Version scheme (decision, recorded for Carson)
- `dobius/package.json` `version` stays a SemVer version that a person sets on purpose.
  It is the only thing the downgrade guard compares. It is never rewritten by a build.
  Rewriting it would dirty the tree on every build, and a stale branch built later
  would then outrank newer code.
- Every local package build gets the next build number automatically, with no manual
  edit. The number is SemVer build metadata (`2.0.0+57`). macOS shows it as
  "Version 2.0.0 (57)" through CFBundleVersion, and the installer records it as
  `buildNumber`. Precedence ignores it, so it can never make an older version look newer.
  It orders builds on this machine only.
- An install does not bump the number. A signed bundle's Info.plist is sealed, and
  reinstalling the same artifact should keep its number. Each build gets a new number,
  and each install records the number of the build it installed.
- Prerelease and rollback policy:
  - Moving forward (rc.1 → rc.2 → 2.0.0 → 2.0.1) installs without a flag.
  - Reinstalling the same version is allowed.
  - Anything older, including 2.0.0 → 2.0.0-rc.2, needs `--take-over`.
  - The rollback command the installer prints already passes `--take-over`.
- Release-tag contract (#110): a release is an annotated tag `v<version>` on a clean
  commit. Provenance records `tag`, `commit`, `dirty`, `version` and `artifactSha256`, so
  an audit can match all four. No tag was created in this build.

## Tests
- `dobius/config/scripts/install-dobius-gated.test.mjs` (extended):
  - `semver-compare.py`: 11 ordered pairs, each checked both ways (rc.1/rc.2/stable/patch,
    rc.10 vs rc.2, 1.0.66 vs 2.0.0-rc.1, and SemVer spec examples). Equal versions and
    build metadata are covered. Invalid inputs are refused: `''`, `2.0`, `v2.0.0`, a
    leading zero, and PlistBuddy's "File Doesn't Exist" text.
  - End-to-end runs (fixture DEST only):
    - rc.1 over 2.0.0 → exit 5, app untouched.
    - 2.0.0 over rc.2 → installed.
    - A source with no version → exit 5, with or without `--take-over`.
    - An installed app with no version → exit 5, then installed with `--take-over`.
    - Clean git fixture with an annotated tag → `dirty:false, diffDigest:null,
      tag:'v2.0.0', version, buildNumber:41`, and `artifactSha256` equal to the sha256
      of the fixture asar.
    - Dirty fixture (edited tracked file) → `dirty:true` plus an sha256 digest. Adding
      an untracked file changes the digest.
    - A bundle packaged without the counter → `buildNumber:null`.
- `dobius/config/scripts/electron-builder-with-build-number.test.mjs` (new):
  - Two consecutive allocations give 1 then 2.
  - Allocation continues from an existing counter.
  - A corrupt counter throws, and the file is left as it was.
  - A held lock throws and is left in place.
  - The wrapper passes the number to a stand-in `electron-builder` and passes its exit
    code through.
- `dobius/config/scripts/electron-builder-config.test.mjs` (extended):
  - `DOBIUS_BUILD_NUMBER=42` gives `mac.bundleVersion '42'` and leaves other version
    fields unset.
  - An unset or empty value gives `null`.
  - `2.0.0` and `0` throw.

## Verification
- Targeted:
  - Files run: `install-dobius-gated.test.mjs`, `electron-builder-with-build-number.test.mjs`,
    `electron-builder-config.test.mjs` and `package-electron-runtime-contract.test.mjs`.
  - Result: 81 passed, 4 failed. All 4 failures are pre-existing Linux/artifact naming
    tests in `electron-builder-config.test.mjs`, which is listed in `basefail.txt`. They
    expect `dobius-linux.${ext}` or `dobius` where the config has `dobius-plus-*` or
    `dobius-ide`. They are untouched by this build.
- Mutation checks (each made its tests fail, then the file was restored; logs in
  `stabilize-run/044/mut-*.log`):
  - M1: prerelease dropped in `parse`, the old behaviour. 9 tests failed, including the
    rc-over-stable install.
  - M2: the source and installed version checks skipped when empty, the old N8
    behaviour. Both N8 install tests failed.
  - M3: `dirty = False` and `tag = None` hard-coded. The clean and dirty provenance tests
    failed.
  - M4: the counter no longer incremented. The consecutive-build, continue-from-counter
    and wrapper tests failed.
  - M5: `mac.bundleVersion: null` hard-coded. The config test failed.
- `pnpm run typecheck` exit 0. oxlint and the react-doctor config report 0 findings on the
  changed JS files. `bash -n` passes on the script, and `py_compile` passes on the helper.
- Full suite: DEFERRED (coordinator).

## Rollback
Revert the commit. The counter file `~/.dobius-build-number` is inert and can be deleted by
hand. Provenance written by this build only has extra keys, and old readers ignore them.

## Deviations from EXECUTION-ORDER.md
- `dobius/package.json:3` (`version`) is not changed. By design, the version is not
  auto-bumped (see scheme). The package.json change is the two build scripts.
- The spec names `buildVersion`. `mac.bundleVersion` is used instead. The top-level
  `buildVersion` also feeds the Windows FileVersion and the AppImage version, where a bare
  integer is wrong. `bundleVersion` sets only CFBundleVersion.
- Source state (`dirty` and `diffDigest`) is taken when the installer runs, from the repo
  containing the bundle, like the existing `commit`. It is not embedded at build time. If
  the tree changes between build and install, the record describes the tree at install.
  `artifactSha256` plus `buildNumber` still pin the exact artifact. Embedding a build-time
  record inside the sealed bundle is a possible follow-up.
- The root `package.json` (1.0.29, the legacy v1 app) is not touched. It is not what the
  packaged app reports.

## Lessons
- In git worktrees, `dobius/node_modules` is an untracked symlink. `.gitignore` has
  `node_modules/`, which matches directories only. So an install from a stabilize worktree
  records `dirty: true`. That is truthful as far as git is concerned. Installs from the
  main checkout, where node_modules is a real ignored directory, are not affected.
- electron-builder requires the config in tests, so any side effect there, such as
  allocating a counter, would run on every test. Keep allocation in the wrapper.
