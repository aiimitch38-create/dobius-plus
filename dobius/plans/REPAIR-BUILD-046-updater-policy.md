# REPAIR BUILD-046 — Updater policy (Upstream)

Bugs: #106 (E1), #107 (E12 + F7), #111 (E14). Depends on BUILD-044 (merged).
Rule from BUILD-043/044: the gated install script is the only thing allowed to replace
`/Applications/Dobius+.app`. The in-app updater must never check, download or install behind
that gate. Carson's Gate A has no `DOBIUS_ENABLE_DOBIUS_UPDATES`.

## Root causes (re-traced 2026-09-25 at HEAD 1fca4df2)

- **#106** The "may we update?" decision was split across layers that disagreed:
  - `attach-main-window-services.ts:161` ran `setupAutoUpdater` when `DOBIUS_ENABLE_DOBIUS_UPDATES=1`. It ignored the disconnect switch.
  - `setupAutoUpdater` (`updater.ts:1234-1239`) checked only dev/packaged. It then set the feed URL, registered `resume`/`browser-window-focus` listeners, ran the startup check and armed the 24h timer (:1340-1356).
  - `runBackgroundUpdateCheck` (:948-956) checked only dev/packaged. Startup, wake, the timer and nudges all go through it.
  - Only `checkForUpdates` (:1001), `checkForUpdatesFromMenu` (:1040) and `downloadUpdate` (:1361) looked at `DOBIUS_SERVICES_DISCONNECTED`.
  - Result: opted in + disconnected meant background checks ran and could show "update available", while Download silently did nothing. Opted out + connected (if the constant were flipped) let the menu check and download run against an unconfigured updater.
- **#107** With updates off, `checkForUpdatesFromMenu` sent `{ state: 'not-available', userInitiated: true }` (:1041, :1045). `UpdateCard` (:481) and Settings show that as "You're on the latest version". Nothing was checked. Separately, `getUpdateStatus` returned `idle` when setup never ran, so Settings said "Updates are checked automatically on launch."
- **#111** `dobius/config/dev-app-update.yml` pointed at `statusdigitalmarketing/dobius`, a different repo from the real feed. The real feed is `updater.ts` `setFeedURL` → `statusdigitalmarketing/dobius-plus`, and electron-builder `publish` (`electron-builder.config.cjs:366-369`) uses the same repo. Nothing read the yml: electron-updater only loads it in dev with `forceDevUpdateConfig`, and a repo-wide search finds no reference.

## Fix

- New `src/main/updater-policy.ts`, the single policy:
  - `resolveUpdatePolicy({disconnected, enableFlag, isPackaged, isDev})` is pure. It returns `{enabled:true}` or `{enabled:false, reason}`.
  - Checks run in order: `disconnected` → `not-enabled` (flag !== '1') → `dev-build`.
  - The disconnect switch always wins over the opt-in.
  - `getUpdatePolicy()` reads `DOBIUS_SERVICES_DISCONNECTED`, the env flag, `app.isPackaged` and `is.dev`, live on every call.
- `updater.ts`: every entry point now consults `getUpdatePolicy()`:
  - `setupAutoUpdater`: no feed URL, listeners, nudge poll or timers when disabled.
  - `runBackgroundUpdateCheck`, which covers startup, wake/focus, the 24h timer and nudges.
  - `checkForUpdates`, `checkForUpdatesFromMenu`, `downloadUpdate`, `quitAndInstall` and `checkForUpdateNudge`.
  - The old separate dev/packaged checks are now the policy's `dev-build` reason.
- `attach-main-window-services.ts`: the deferred setup gate uses the same policy instead of the env var alone. That keeps electron-updater from being required at all when updates are off.
- New `UpdateStatus` variant `{ state: 'disabled', reason: 'disconnected' | 'not-enabled' | 'dev-build', userInitiated? }` in `shared/types.ts`:
  - The main process sends it instead of `not-available` when updates are off.
  - `getUpdateStatus()` returns it whenever the policy is disabled.
  - `statusesEqual` (`updater-fallback.ts`) and `decorateStatusWithActiveNudge` treat it as a cycle-boundary state.
- Renderer:
  - `UpdateCard`: `disabled` is shown only for user-initiated checks, then auto-dismisses after 3 s like "latest version". It renders the new text and the aria label "Automatic updates are off".
  - `should-mount-update-card`: `disabled` mounts only when user-initiated.
  - `ui.ts` slice: `disabled` clears the cached changelog.
  - `GeneralUpdateSettingsSection`: shows the new text for `disabled`. Before this fix it showed "checked automatically on launch" or "latest version".
- Wording (recorded, all 5 locales):
  - en "Updates are managed by the install script."
  - es "Las actualizaciones las gestiona el script de instalación."
  - ja "アップデートはインストールスクリプトで管理されます。"
  - ko "업데이트는 설치 스크립트로 관리됩니다."
  - zh "更新由安装脚本管理。"
  - Keys: `auto.components.UpdateCard.f528af4816` and `auto.components.settings.GeneralUpdateSettingsSection.9b7a940bd3`, from the repo's sha1(`<file>:<text>`) scheme.
  - The text is kept short because `CompactCardContent` truncates to one line.
- `dobius/config/dev-app-update.yml` is deleted. That leaves one intentional update target (`dobius-plus`). Production routing is unchanged.

## Truth table (tests)

| flag | disconnected | startup | wake/focus | 24h timer | menu/Settings | download | install |
|---|---|---|---|---|---|---|---|
| 1 | false | checks | checks | checks | checks | downloads | allowed |
| 1 | true | disabled | no check | no check | `disabled` (not "latest") | blocked | blocked |
| unset | false | disabled | no check | no check | `disabled` | blocked | blocked |
| unset | true | disabled | no check | no check | `disabled` | blocked | blocked |

The wake, timer and download rows first set up an enabled updater, then flip the combo live. This proves each entry point re-checks the policy itself and does not rely on setup being gated.

## Tests

- `src/main/updater-policy.test.ts` (new, 32 tests):
  - Pure truth table and reason order.
  - The entry-point table above (startup / wake+focus / 24h timer / menu / download × 4 combos).
  - `quitAndInstall` is blocked.
  - `getUpdateStatus` returns `disabled` and never `idle` or "latest".
  - A dev build reports `dev-build`, not `not-available`.
  - #111: no `dev-app-update.yml`, and the runtime feed repo equals electron-builder `publish.owner/repo`.
- `src/renderer/src/components/update-disabled-status.test.tsx` (new, 10 tests):
  - The real `UpdateCard` and `GeneralUpdateSettingsSection` rendered via `renderToStaticMarkup`.
  - `disabled` (each reason) shows the install-script text and never "latest version" or "checked automatically".
  - A background `disabled` status mounts no card.
  - A real `not-available` still reads "latest version".
- `UpdateCard.test.ts`: added one test showing `disabled` clears the cached changelog.
- `updater.test.ts`, `updater.check-failure.test.ts`, `updater.mac-install.test.ts` now test the opted-in path. They mock `./dobius-disconnect` as `false` and stub `DOBIUS_ENABLE_DOBIUS_UPDATES=1`, with `unstubAllEnvs` in `afterEach`.
  - Before this build, 43 of these tests failed on baseline because the constant `DOBIUS_SERVICES_DISCONNECTED = true` hit the menu path.
  - With the shared policy, the 34 background/setup tests that used to pass would also have failed.
  - All 88 tests in the 4 `updater.*` files now pass.

### Mutation checks (each test proven able to fail)

- Whole HEAD `updater.ts` with the new policy test: 18/32 fail (startup, wake, timer and menu for all 3 disabled combos; download for not opted in + connected; install; getUpdateStatus ×3; dev build).
- `runBackgroundUpdateCheck` guard removed: 6 fail (wake + timer × 3 disabled combos).
- `setupAutoUpdater` guard removed: 3 fail (startup × 3; feed URL/listeners registered).
- Menu guard sends `not-available` again: 4 fail (menu × 3, dev build).
- `downloadUpdate` guard removed: 3 fail. `quitAndInstall` guard removed: 1 fails. `getUpdateStatus` returns `currentStatus`: 3 fail.
- Policy disconnect check removed: 11 fail. Policy dev check removed: 2 fail.
- Renderer:
  - UpdateCard `disabled` content branch removed: 3 fail.
  - Background-hide gate removed: 3 fail.
  - `should-mount` without `disabled`: 3 fail.
  - Settings `disabled` line removed: 3 fail.
  - `ui.ts` slice without `disabled`: 1 fails.
- `dev-app-update.yml` restored from HEAD: 1 fails.

## Verify

- `pnpm run typecheck`: exit 0.
- Targeted vitest: updater-policy, updater, updater.check-failure, updater.fallback, updater.mac-install, UpdateCard, update-disabled-status and the locale script tests are all green.
- Pre-existing baseline failures, unchanged and not touched by this build:
  - `updater-changelog`, `updater-nudge`, `updater-prerelease-feed(-readiness)`. These are the disconnect constant in those modules.
  - `attach-main-window-services.test.ts`, which fails at import on `tear-off-window.ts`.
  - `i18n/no-top-level-translate`, in `DestinationsSection`.
- `oxlint` and the react-doctor config are clean on every changed file. `verify-localization-catalog` passes and locale parity holds.

## Deviations from EXECUTION-ORDER.md

- Files beyond the list, all needed for the new status variant or the harness:
  - Status variant: `shared/types.ts`, `updater-fallback.ts`, `lib/should-mount-update-card.ts`, `store/slices/ui.ts`, `settings/GeneralUpdateSettingsSection.tsx`, 5 locale JSONs.
  - Policy: new `updater-policy.ts`.
  - Test harness: 3 existing updater test files now opt in explicitly.
- `dobius-disconnect.ts` is unchanged. The constant stays `true`, and the policy reads it.
- `updater.ts:1040` behaviour moves to a new `disabled` state instead of reusing `not-available`.
- `quitAndInstall` and `checkForUpdateNudge` are gated too. Reason: the "never install behind the gate" rule. Also, the nudge path calls `runBackgroundUpdateCheck`.
- `UpdateCard.tsx`: the nested aria-label ternary was re-indented by oxfmt because a branch was inserted.

## Rollback

Revert the commit. There is no data migration and nothing is persisted. `disabled` is never written to disk.

## Lessons

- A master switch implemented as a per-entry-point `if` drifts. Any path added later, such as wake, timer or nudge, silently bypasses it. Keep one policy function and gate every public entry point with it. Make the tests flip the policy live after an enabled setup, so each gate is proven on its own.
