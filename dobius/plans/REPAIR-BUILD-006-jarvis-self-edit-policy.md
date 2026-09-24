# REPAIR BUILD-006 — Jarvis self-edit path policy (#26 #27 X1)

C2 is unchanged: Jarvis still proposes and applies its own approved edits. This build only
changes which paths it may write and how the editable repo root is found.

## Root cause
- **#26** `resolveEditablePath` (`src/main/jarvis/self-edit.ts`) checked `FORBIDDEN_SEGMENTS` on
  the *requested* string, then realpath'd the parent/leaf and checked only root containment.
  An in-root symlink (`src/meta -> .git`, `src/config.ts -> .env.local`) passed the segment
  check while the canonical target sat in a protected place inside the root.
- **#27** The only secret-file rule was the segment `.env`; `.env.local`, `.env.production`,
  `.npmrc`, keys, `service-token` etc. were writable.
- **X1** `jarvis-ipc.ts` used `resolve(app.getAppPath(), '..', '..')` as the repo root. In dev
  `getAppPath()` is `<checkout>/dobius`, so the root was the folder ABOVE the checkout
  (`~/Projects (Code)/Dobius`, every sibling repo editable). Packaged, it is the bundle's
  `Contents` folder.

## Fix
- `protectedReason(segments, requested)`: forbidden directory segments (`.git`, `node_modules`,
  `out`, `dist`, plus `.ssh`, `.gnupg`), compared case-insensitively (default macOS volume is
  case-insensitive), and the documented sensitive-file policy `isSensitiveFileName()` on the leaf:
  `.env` and every `.env.*`, `.envrc`, `.npmrc`, `.netrc`, `.pypirc`, `.git-credentials`,
  `auth.json`, `credentials(.json)`, `service-token`, `id_rsa|id_dsa|id_ecdsa|id_ed25519`, and
  `*.pem|.key|.p12|.pfx|.enc|.keystore|.jks`.
- Applied twice: on the lexical requested path (as before) AND on the canonical path relative to
  the real root that contains it, after realpath. Final-leaf `O_NOFOLLOW` write is unchanged.
- Parent substitution: `apply()` re-runs `resolveEditablePath` on the proposal's canonical path
  and refuses if it fails or resolves elsewhere (review can take minutes; `O_NOFOLLOW` only
  guards the leaf). A residual race between this re-check and `openSync` remains (Node has no
  `openat`); it shrinks the window from minutes to microseconds.
- `resolveSelfEditRepoRoot({isPackaged, env, home})`: `DOBIUS_SELF_EDIT_REPO_ROOT` if set;
  else in dev only `DOBIUS_DEV_REPO_ROOT` (set by `config/scripts/run-electron-vite-dev.mjs` to
  this checkout's `dobius/` folder, which is what the old comment intended). Must be absolute,
  an existing directory, not `/` and not the home folder. Otherwise `{ok:false, error}`.
- `SelfEditStore` takes an optional `unavailableReason`; when set, every `propose` returns it.
  The renderer tool (`use-voice-agent.ts` `propose_code_change`) already speaks
  `Could not propose that change: <error>`, so the reason is visible/audible. No existing setting
  names a repo root (searched settings/shared types), so an env var is the explicit configuration.

## Files
- `src/main/jarvis/self-edit.ts`
- `src/main/jarvis/jarvis-ipc.ts` (import line + the repo-root block only)
- `src/main/jarvis/self-edit.test.ts`

## Tests (`src/main/jarvis/self-edit.test.ts`)
- In-root symlinked file -> `.env.local` refused, target bytes unchanged.
- In-root symlinked dir -> `.git` refused for existing and new files.
- `.env`, `.env.local`, `.env.production`, nested `.env.development.local`, `.ENV.Local`,
  `.npmrc`, `auth.json`, `*.pem`, `service-token` refused.
- Existing `Out/` folder refused (case-insensitive segment).
- Ordinary source (`src/voice.ts`, `src/env.ts`, `src/token-utils.ts`) allowed.
- Parent folder swapped for a symlink to `.git` between propose and apply: apply refused,
  `.git` file unchanged.
- Repo root: packaged + configured -> configured path (not `Contents`); packaged + only
  `DOBIUS_DEV_REPO_ROOT` -> refused with message naming `DOBIUS_SELF_EDIT_REPO_ROOT`; dev ->
  launcher checkout; relative, `/`, home, `home/` refused; missing dir refused; unconfigured store
  refuses every proposal with the reason.

Mutation checks (each made the file fail, then restored; final 24/24 green):
M1 skip canonical check (2 fail); M2 drop `.env.*` rule (2); M3 drop apply re-check (1);
M4 let packaged use `DOBIUS_DEV_REPO_ROOT` (1); M5 drop too-broad root check (1);
M6 ignore `unavailableReason` (1); M7 case-sensitive segments (1, after making the test use an
existing folder: a missing parent was refused for a different reason and masked it).

## Deviations from EXECUTION-ORDER.md
- `apply()` gained a 4-line re-validation (spec lists only lines 39-44/80-90). BUG-MATRIX #26 asks
  to "address parent substitution"; BUILD-019 also edits `apply()` (#38), so expect a small
  adjacent-hunk merge there.
- Lexical segment check keeps checking the full absolute path (pre-existing behavior); the new
  canonical check is relative to the containing root.

## Decisions for Carson
- The packaged app has no repo root unless `DOBIUS_SELF_EDIT_REPO_ROOT` is set in its
  environment (e.g. `launchctl setenv DOBIUS_SELF_EDIT_REPO_ROOT ".../dobius-plus/dobius"`), so
  Jarvis self-edit in the installed app now refuses with that reason instead of targeting the
  bundle. A Settings field could replace the env var later (config registry, #118).
- `.env.example`-style templates are also blocked (all `.env.*`, fail closed).

## Rollback
Revert the commit. No data or file formats change.

## Verification
- `pnpm run typecheck` exit 0.
- `npx vitest run --config config/vitest.config.ts src/main/jarvis`: 12 files / 107 tests green.
- oxlint + react-doctor clean on the 3 changed files. `oxfmt --check` differences in
  `self-edit.test.ts`/`jarvis-ipc.ts` are pre-existing lines, left alone.
- Full suite: DEFERRED (coordinator).
