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
  `.env` and every `.env.*` except the templates `.env.example`, `.env.sample`, `.env.template`
  (exact names, case-insensitive), `.envrc`, `.npmrc`, `.netrc`, `.pypirc`, `.git-credentials`,
  `auth.json`, `credentials(.json)`, `service-token`, `id_rsa|id_dsa|id_ecdsa|id_ed25519`, and
  `*.pem|.key|.p12|.pfx|.enc|.keystore|.jks`.
- Applied twice: on the lexical requested path (as before) AND on the canonical path relative to
  the real root that contains it, after realpath. Final-leaf `O_NOFOLLOW` write is unchanged.
- Parent substitution: `apply()` re-runs `resolveEditablePath` on the proposal's canonical path
  and refuses if it fails or resolves elsewhere (review can take minutes; `O_NOFOLLOW` only
  guards the leaf). A residual race between this re-check and `openSync` remains (Node has no
  `openat`); it shrinks the window from minutes to microseconds.
- `resolveSelfEditRepoRoot({isPackaged, env, home, resourcesPath})` in the new
  `src/main/jarvis/self-edit-repo-root.ts` (split out so self-edit.ts stays under max-lines 300).
  Order: `DOBIUS_SELF_EDIT_REPO_ROOT` if set. In dev: `DOBIUS_DEV_REPO_ROOT` (set by
  `config/scripts/run-electron-vite-dev.mjs` to this checkout's `dobius/` folder, which is what the
  old comment intended). Packaged: `<repo>/dobius`, where `repo` comes from
  `process.resourcesPath/INSTALL-PROVENANCE.json`, stamped by `scripts/install-dobius-gated.sh`
  (`"repo"` = git toplevel), read via `readSafeJsonFile`. Every source must be absolute, an existing
  directory containing `package.json`, and not `/` or the home folder. Otherwise `{ok:false, error}`
  naming the source (missing stamp / unreadable stamp / bad folder).
- `SelfEditStore` takes an optional `unavailableReason`; when set, every `propose` returns it.
  The renderer tool (`use-voice-agent.ts` `propose_code_change`) already speaks
  `Could not propose that change: <error>`, so the reason is visible/audible. No existing setting
  names a repo root (searched settings/shared types), so an env var is the explicit configuration.

## Files
- `src/main/jarvis/self-edit.ts`
- `src/main/jarvis/self-edit-repo-root.ts` (new)
- `src/main/jarvis/self-edit-path-policy.ts` (new, commit 3)
- `config/scripts/run-electron-vite-dev.mjs`, `src/main/providers/local-pty-provider.ts` (+ tests; commit 3)
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
- `.env.example`/`.env.sample`/`.env.template` (and `.ENV.Example`) allowed;
  `.env.example.local`, `.env.examples`, `.env.local.example` refused.
- Repo root (real temp dirs): packaged env override wins over the stamp; packaged falls back to
  `<stamp.repo>/dobius`; packaged ignores `DOBIUS_DEV_REPO_ROOT` and with no stamp refuses naming
  `DOBIUS_SELF_EDIT_REPO_ROOT`; malformed JSON / array / no `repo` / empty / non-string refused;
  stamp pointing at a missing dir, `"unknown"`, or a folder without `dobius/package.json` refused;
  dev uses launcher checkout, refuses when unset; relative, `/`, home, `home/`, no-package.json
  override refused; unconfigured store refuses every proposal with the reason.

Mutation checks (each made the file fail, then restored; final 24/24 green):
M1 skip canonical check (2 fail); M2 drop `.env.*` rule (2); M3 drop apply re-check (1);
M4 let packaged use `DOBIUS_DEV_REPO_ROOT` (1); M5 drop too-broad root check (1);
M6 ignore `unavailableReason` (1); M7 case-sensitive segments (1, after making the test use an
existing folder: a missing parent was refused for a different reason and masked it).
Follow-up (commit 2): P1 ignore env override (1); P2 use stamp repo without `/dobius` (1);
P3 accept a missing/unreadable stamp (2); P4 drop package.json check (1); P5 dev path taken when
packaged (3); P6 drop template allowlist (1); P7 allow `.env.example.*` prefixes (1). P8 (no trim
on stamp repo) survived: equivalent mutant, an empty/blank repo is refused either way.
P2/P4 re-run after the file split: still fail.

## Deviations from EXECUTION-ORDER.md
- `apply()` gained a 4-line re-validation (spec lists only lines 39-44/80-90). BUG-MATRIX #26 asks
  to "address parent substitution"; BUILD-019 also edits `apply()` (#38), so expect a small
  adjacent-hunk merge there.
- Lexical segment check keeps checking the full absolute path (pre-existing behavior); the new
  canonical check is relative to the containing root.

## Decisions for Carson
- Packaged app: editable root is `<repo>/dobius` from the installer's provenance stamp, so C2 keeps
  working with no setup after a gated install. Installs without a stamp (e.g. the v2 installer)
  refuse with a spoken reason until `DOBIUS_SELF_EDIT_REPO_ROOT` is set. The editable root is the
  app folder, not the whole git repo (scripts/, docs/ are outside it), matching the old intent.
- `.env` templates (`.env.example`, `.env.sample`, `.env.template`) are editable; all other
  `.env*` stay blocked.

## Review follow-up (commit 3)
- F1: `config/scripts/run-electron-vite-dev.mjs` now always assigns `DOBIUS_DEV_REPO_ROOT` (was
  `||=`), so a `pnpm dev` launched from another dev instance's terminal cannot inherit that
  checkout as its self-edit root. `local-pty-provider.ts` also strips `DOBIUS_DEV_REPO_ROOT` and
  `DOBIUS_SELF_EDIT_REPO_ROOT` from child shells (added to `PANE_IDENTITY_ENV_KEYS`; an explicit
  caller-supplied value is still honored, same as the pane keys).
- F2: canonical root-relative segments that end in `.` or space, or contain `:`, are refused on
  every platform (Windows would open `.git.` as `.git`, and `.env::$DATA` as `.env`). Only the
  root-relative canonical path is checked, so a drive prefix like `C:` in the root is not affected.
  The path policy moved to `src/main/jarvis/self-edit-path-policy.ts` to keep self-edit.ts under
  max-lines.
- Tests: `.git./config` (with a real `.git.` folder so this rule is what refuses), `.env `,
  `.env::$DATA`, `src/voice.ts.`; pty spawn does not pass either root var; the dev wrapper test
  now starts with an inherited `DOBIUS_DEV_REPO_ROOT=/other-checkout/dobius` and still sees
  its own checkout.
- Mutation checks (each failed 1 test, restored): F2a drop alias check; F2b drop `:` rule;
  F2c trailing space only; F2d trailing dot only; F2e check not applied on canonical path;
  F1a/F1b drop either strip key; F1c launcher back to `||=`.
- Verification: typecheck exit 0; oxlint + react-doctor clean on all 7 changed files;
  src/main/jarvis + local-pty-provider + run-electron-vite-dev tests: 14 files / 172 passed.
- Deviation: touches `config/scripts/run-electron-vite-dev.mjs`, `local-pty-provider.ts` and
  their tests, outside the spec's file list (requested by review F1).

## Rollback
Revert the commit. No data or file formats change.

## Verification
- `pnpm run typecheck` exit 0.
- `npx vitest run --config config/vitest.config.ts src/main/jarvis`: 12 files / 107 tests green (commit 1); after follow-up, src/main/jarvis + src/main/storage: 14 files / 132 tests green.
- oxlint + react-doctor clean on the 3 changed files. `oxfmt --check` differences in
  `self-edit.test.ts`/`jarvis-ipc.ts` are pre-existing lines, left alone.
- Full suite: DEFERRED (coordinator).
