# FIXER Telegram account control correction — 2026-10-16

## Result

Fixed the Telegram account UI's emergency-control behavior. Pause/resume, disconnect, and remote revoke now use a dedicated control lane that stays available during ordinary refresh/save work; only another in-flight emergency operation disables those controls. Starting a control action increments the UI generation so pending ordinary results cannot restore stale account/group state. Ordinary-action cleanup owns only its own busy state and cannot unlock a newer control operation; duplicate control calls are fenced.

Remote revoke continues to use the typed backend `revoke` operation and never falls back to local disconnect. Read-only inspection of `src/main/ipc/desktop-telegram-account.ts` confirms its paused-account composition can authenticate for remote revoke without enabling reply handling. On API failure, the UI shows fixed redacted failure copy and does not claim revocation succeeded.

Added `dobius/docs/TELEGRAM-PERSONAL-ACCOUNT.md` with account registration, secure credential/session handling, exact group-selection guidance, pause/disconnect/revoke distinctions, consent and Adam-gateway limits, uncertain-send behavior, source map, focused test command, and pending live-readiness gates. It links Telegram's primary API and terms pages and makes no claim that account connection grants blanket participant consent.

## Validation

Node v24.18.0:

- `/Users/bayou/homebrew/opt/node@24/bin/node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts src/renderer/src/components/settings/TelegramAccountSection.test.tsx --maxWorkers=1 --reporter=dot` — PASS, 1 file / 17 tests.
- `pnpm exec oxfmt --check src/renderer/src/components/settings/TelegramAccountSection.tsx src/renderer/src/components/settings/TelegramAccountSection.test.tsx` — PASS.
- `pnpm exec oxlint src/renderer/src/components/settings/TelegramAccountSection.tsx src/renderer/src/components/settings/TelegramAccountSection.test.tsx` — PASS.
- `PATH=/Users/bayou/homebrew/opt/node@24/bin:$PATH pnpm run typecheck:web` — PASS, exit 0.
- `git diff --check` on the modified section — PASS.

The new setup guide matches the existing ignore rule `dobius/.gitignore:81` (`docs/**`), so it is present in the workspace but not shown by ordinary Git status. No Git add/ignore changes were made, per task limits.

## Exact owned source hashes

- `dobius/src/renderer/src/components/settings/TelegramAccountSection.tsx` — `27ef71d47ebbdd2ced9b88f58ea9df89f1227afe3d65f98b3f8a4116ee2eeab1`
- `dobius/src/renderer/src/components/settings/TelegramAccountSection.test.tsx` — `6fe12b564aa6251d13a902d93d17ea06dfa0b9314ab2771bee1f3b850da46acf`
- `dobius/docs/TELEGRAM-PERSONAL-ACCOUNT.md` — `831580801fadf47bd470834124e7cb1b8a9eb891d805e25678299b92b465ff5e`

## Scope and limits

Task `task_3e73ce24bf4d`, dispatch `ctx_546c7e25fd3d`, ROOT `term_2958d5fd-ff36-4ae7-9f23-6ed32a748f54`, runtime `6627a505-a9ea-4b59-90e7-d051eb153516`. Only the Telegram account renderer section/test, the new setup guide, this report, and FIXER's own JSON receipt were changed. Backend, MTProto, shared contract, IPC/preload, package files, and other settings owners were not edited. Tests use synthetic UI/API fixtures; no login, send, account/profile/private-data inspection, build/install, or service restart was performed. The guide and source do not establish installed or live acceptance; authenticated Adam event routing, durable cursor recovery, and per-participant consent remain prerequisites. AWS remains deferred and historical Storage paused.
