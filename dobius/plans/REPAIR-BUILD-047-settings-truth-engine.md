# REPAIR BUILD-047 — Settings truth (engine) (#122 F8 F11, X9)

## Root cause
- **F11 "Share anonymous usage data".** `M/telemetry/client.ts` compiles transport off
  (`const TELEMETRY_ENABLED = false`, fork: never sends) and also requires an official CI build
  identity + write key. `track()` returned early on that gate, but the Privacy pane only learned
  about env kill switches (`telemetry:getConsentState` → `resolveConsent`), so it showed a live,
  checked switch and the text "Dobius+ sends anonymous counts…" in a build that can send nothing.
- **F8 "Markdown Review Notes".** `settings.markdownReviewToolsEnabled` (default true,
  `S/constants.ts:209`) had zero readers outside the Settings row (grep: only
  `GeneralEditorSettingsSection.tsx` + test fixtures; no reader even in the vendoring commit
  `1f3d09f6`). The rich editor's review tools are driven by `markdownAnnotationsEnabled`
  (EditorPanel default `true`), so the switch did nothing.
- **X9 / F14 env over setting.** `resolveClaudeCommand()` (`M/codex-cli/command.ts:218`) used
  `options.overridePath ?? process.env.DOBIUS_CLAUDE_CLI_PATH`, but no caller passes
  `overridePath` (agent-runner:401, rate-limits/claude-pty:238, claude-accounts/service:907). So
  headless Claude spawns ignored Settings > Agents > Claude "Command" (`agentCmdOverrides.claude`,
  labelled "Override the binary path or name") and the env var silently won.

## Fix
- F11: `isTelemetryTransportAvailable()` exported from `client.ts` (same expression `track()`
  used; `track()` now calls it, so UI truth and send gate are one function). The
  `telemetry:getConsentState` handler returns `{effective:'disabled', reason:'transport_unavailable'}`
  first when it is false. Shared type gains that reason (never produced by `resolveConsent`);
  renderer IPC shape check accepts it. PrivacyPane: `computeBlockedReason` → `{kind:'unavailable'}`;
  switch disabled, reads **off** (`isSharingSwitchOn`), helper text "Not available in this build:
  Dobius+ sends no usage data, so this switch has no effect." Stored `telemetry.optedIn` untouched.
- F8: wired, not retired. `useRichMarkdownReviewData` reads `settings.markdownReviewToolsEnabled`
  from the store (missing/unloaded = on). Off → `canAnnotateRichMarkdown=false` (no add-note
  button/popover; the controller's existing effect clears stale popovers/highlights) and
  `markdownComments=[]` (no notes rail, note layer, copy/send-to-agent actions). Notes stay
  stored and still appear in Source Control. Scope = rich editor mode, exactly as the label says.
- X9: precedence is now caller `overridePath` > Settings override > env var > PATH scan
  (**setting over env**, per brief). `setClaudeSettingsOverrideReader()` registered once in
  `index.ts` right after the Store loads, reading `agentCmdOverrides.claude` live. The value is
  shell text for terminals, so for headless spawns: `"quoted path"` is unwrapped; a bare name is
  resolved through the PATH/version-manager scan; a value with arguments cannot be one
  executable, so it falls back to env/scan with a one-time `console.warn`. When the setting wins
  over a set env var, a one-time `console.warn` names that (visible, not silent).
- F12 orphans (`showTasksButton`, `voice.voiceEngine`, `voice.localTtsEngine`): **no code
  defect.** grep over `src/` finds no reader, type or default for any of them
  (`showTasksButton` was removed with its last reader in `b9e33582`). They exist only as
  leftover keys in Carson's stored settings; no UI shows them. Left in place (brief: never delete
  user settings values).
- F13 `workspaceDirHistory` → `~/orca/workspaces`: **by design, not changed.** It is history of
  previous workspace roots (`persistence.ts:640-660` appends the old layout on change), used only
  to classify worktrees that may still live under an old root (`worktree-ownership.ts:47-88`). A
  deleted old root matches nothing; pruning it would delete user data.

## Tests (all seen FAIL with the fix removed, PASS with it)
- `src/main/telemetry/client-transport-availability.test.ts` — false outside an official build.
- `src/main/ipc/telemetry-consent-state.test.ts` — opted-in user gets `transport_unavailable`;
  it wins over `DO_NOT_TRACK`; available build falls through to stored preference.
- `src/renderer/src/lib/telemetry-consent-state.test.ts` — new reason passes the IPC shape check;
  unknown reasons still fail closed.
- `src/renderer/src/components/settings/PrivacyPane.test.ts` (extended) +
  `PrivacyPane.unavailable.test.tsx` (happy-dom, real effect) — opted-in user sees an off,
  disabled switch with the reason; click does not call setOptIn; stored `optedIn` stays true;
  available build keeps a live switch.
- `src/renderer/src/components/editor/useRichMarkdownReviewData.test.ts` (happy-dom, real store) —
  on/off/live-toggle/unloaded-default.
- `src/main/codex-cli/command-claude-override.test.ts` — setting beats env (+ warning), live read,
  env still used without a setting, quoted path, bare name via scan, args → fallback + warning,
  caller override on top.
- Mutation checks (script `stabilize-run/047/mutate.py`): M1 transport gate always true (1 fail);
  M2 IPC skips transport check (2); M3 renderer drops new reason (1); M4 pane ignores
  unavailable (2); M5 switch shows stored pref (2); M6 review setting ignored (2); M7 settings
  override ignored (5).
- Not unit-covered: the one-line reader registration in `index.ts` (startup composition root).

## Verify
- `pnpm run typecheck` exit 0.
- Targeted vitest: codex-cli, main/telemetry, ipc telemetry tests, renderer settings/, editor/,
  lib telemetry tests → 214 files / 1443 tests passed.
- oxlint + react-doctor config: clean on all changed files.
- `verify:localization-catalog` reports the new key missing in non-English catalogs, same as the
  existing BUILD-004 keys (English fallback via `translate`); left for the catalog sync job.

## Deviations from EXECUTION-ORDER.md
- `R/components/editor/useRichMarkdownReviewController.ts` unchanged; the consumer is
  `useRichMarkdownReviewData.ts` (the controller's data hook) — smallest place both
  `canAnnotateRichMarkdown` and the notes list come from.
- `S/constants.ts` unchanged: the named orphans are not in code (see F12).
- Touched `src/main/index.ts` (outside the list): one import + one registration line; needed
  because the three Claude spawn sites have no store handle.
- Touched `src/shared/telemetry-consent-types.ts`, `src/renderer/src/lib/telemetry.ts`,
  `src/main/ipc/telemetry.ts`, `en.json` for the unavailable state.

## Lessons
- A settings audit needs "is it read" AND "does the reader actually gate the surface": F8 had a
  type, a default and a UI row, and still no reader.

## Rollback
Revert the commit. No stored data is migrated or rewritten.

## Follow-up (coordinator, second commit)
- FirstLaunchBanner: `TelemetryFirstLaunchSurface` asks `getConsentState()` once the user is in the
  notice cohort and renders the notice only when the build can send (hidden while unknown and on
  `transport_unavailable`). `optedIn` stays `null`; nothing is persisted. Test:
  `src/renderer/src/components/TelemetryFirstLaunchSurface.test.tsx` (hidden when unavailable,
  shown when it can send, no IPC outside the cohort).
- Privacy description is conditional: when unavailable it reads "This build of Dobius+ does not
  send usage data." in place of "Dobius+ sends anonymous counts…". Test: extended
  `PrivacyPane.unavailable.test.tsx`.
- Locales: `transportUnavailable` + `transportUnavailableDescription` added to en, es, ja, ko, zh
  (English text in all of them). `verify-localization-catalog.mjs` still exits 1, but only for
  `AsanaPane.autoModeBlocked{Paused,Unreadable}`, because this branch predates BUILD-003B (7b4f829b
  on integration). A per-locale parity diff shows no other missing keys.
- Mutation checks: M8 banner ignores transport (1 fail); M9 description unconditional (1 fail).
- Targeted run with i18n tests: 1 failure, `i18n/no-top-level-translate.test.ts` (flags
  `DestinationsSection.tsx`, untouched; listed in basefail.txt), so it is a baseline failure.
