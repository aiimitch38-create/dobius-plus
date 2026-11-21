# Phase 0 implementation and verification

Implemented TASK-01, TASK-02, and TASK-03 in `WB-build2-phase0` on `wb/build2-phase0`. All three final typechecks passed, the touched-file lint check passed, and the wrapper tests passed 9/9. The wider test run has the exact same 47 failing tests and two suite-loading failures as the untouched base. Full build: Passed (desktop and native macOS helper).

## Changes

- TASK-01: removed Mesh Compute and Hosted Communities from the settings navigation, valid-section list, section type, and card mounts; deleted `features/mesh-compute/`, `HostedCommunitiesSettingsCard.tsx`, `HostedCommunityOnboarding.tsx`, and `shared/api/tauriMesh.ts`. Commit: `390773a6`.

- TASK-02: deleted 10 additional files after fresh, per-file checks found zero importers and zero module-path/export-name references outside each file. The fresh check found 10 qualifying files on this branch. `useBotRecents.ts` was retained because `useBotRecents.test.mjs` imports it. Full file list and proof: [TASK-02-deleted.md](TASK-02-deleted.md). Commit: `ef66d69c`.

- TASK-03: added the four wrappers below using the existing installer and `scriptFor` function. The existing four wrapper entries are unchanged. Tests check installation, executable permissions, routes, authentication, safely encoded quotes/newlines/shell characters, optional read limits, and missing arguments. This report is included in the TASK-03 commit; the completion message carries its SHA.

| Command | Existing bridge route | Arguments |
| --- | --- | --- |
| `dobius-send-to` | `/tabSendTo` | `<tab id> <message>` |
| `dobius-focus` | `/tabFocus` | `<tab id>` |
| `dobius-read` | `/tabRead` | `<tab id> [line limit]` |
| `dobius-open` | `/tabOpen` | `<absolute project path>` |

## Code retained because it is still used

`features/communities/hostedCommunityApi.ts` and its Builderlab invoke wrappers remain: both `AddCommunityDialog.tsx` and `WelcomeSetup.tsx` import `HostedCommunityCreateFlow.tsx`, which imports and calls those wrappers. This follows the instruction to remove wrappers only if nothing else uses them. No production `mesh_*` invoke wrapper remains; mesh command names that remain in `testing/e2eBridge.ts` are test stubs used by the existing relay-mesh harness.

## Verification

All commands ran from the worktree's `dobius/` directory unless stated otherwise.

| Check | Exit | Result |
| --- | --- | --- |
| `pnpm run typecheck:node` | 0 | Passed after all code changes |
| `pnpm run typecheck:web` | 0 | Passed after all code changes |
| `pnpm run typecheck:cli` | 0 | Passed after all code changes |
| `node config/scripts/check-lint-baseline.mjs oxlint --files <four touched TS/TSX files>` | 0 | No new lint errors |
| `npx vitest run --config config/vitest.config.ts src/main/dobius-cli/install-clis.test.ts --maxWorkers=1` | 0 | 9 tests passed |
| `npx vitest run --config config/vitest.config.ts src/main/dobius-cli src/renderer/src/components/communications/features --maxWorkers=2` | 1 | 266 suites passed, 14 failed; 3,164 tests passed, 47 failed |
| Same wider test command in untouched `WORKSTATION-BUILD/dobius/` | 1 | 269 suites passed, 14 failed; 3,184 tests passed, 47 failed |
| `pnpm run build` | 0 | Passed (desktop and native macOS helper) |

The candidate and base have identical sets of all 49 failure entries: 47 test failures plus two suite-loading failures. There are no candidate-only failures. The passing totals differ because TASK-01 removed three Mesh Compute test files containing 22 tests and TASK-03 added two installer tests. The base stayed clean (`git status --short` was empty); its commit was `16b2e5e134172fe920c8ada0623d46f703ab1b0d`.

The environment reports Node `v22.22.3` against the package's requested Node 24. No dependencies were installed or changed. For the full build, a temporary `ln` guard refused only `/usr/local/bin/dobius-dev`, because `build:cli` otherwise attempts a global symlink outside the assigned worktree; all other build steps ran normally. No application was installed or published.

Raw verification logs, the path-reference audit, and the temporary guard are saved under `dobius/out/phase0-verification/` (ignored build artifacts).

## Every failure and its baseline result

All paths below are relative to `src/renderer/src/components/communications/features/`. Every listed failure also occurred on the untouched base.

| File | Failing test or suite-loading error | Also fails on base |
| --- | --- | --- |
| `agents/activeAgentTurnsStore.test.mjs` | activeAgentTurnsStore > resurrection after a prune (A) gated by completion (C) > preserves a valid Unix-epoch startedAt envelope timestamp | Yes |
| `agents/ingestArchivedObserverEvents.test.mjs` | archive window holds more than MAX_OBSERVER_EVENTS (3000) frames > test_archive_window_retains_all_events_beyond_3000_cap | Yes |
| `agents/lib/personaCatalogRelay.test.mjs` | test_full_page_is_followed_by_a_cursored_request_for_older_events | Yes |
| `agents/lib/personaCatalogRelay.test.mjs` | test_full_page_of_tied_timestamps_terminates_the_walk | Yes |
| `agents/lib/personaCatalogRelay.test.mjs` | test_overlapping_pages_are_deduped_by_event_id | Yes |
| `agents/lib/personaCatalogRelay.test.mjs` | test_short_first_page_does_not_issue_a_second_request | Yes |
| `agents/lib/resolvePersonaRuntime.test.mjs` | collectRuntimeWarnings — override mode collects one warning per persona whose runtime differs from default | Yes |
| `agents/lib/usePersonaSync.test.mjs` | startPersonaSync forwards its own relay as the event arrival relay | Yes |
| `agents/ui/agentSessionTranscript.test.mjs` | buildTranscript correctly renders prompt segment when session/prompt arrives after status lifecycle events | Yes |
| `agents/ui/agentSessionTranscript.test.mjs` | buildTranscript falls back to a single turn trigger id for older prompt frames | Yes |
| `agents/ui/agentSessionTranscript.test.mjs` | buildTranscript five-section system prompt card is standalone with all sections; CheckCheck context contains only Dobius/thread context | Yes |
| `agents/ui/agentSessionTranscript.test.mjs` | buildTranscript renders Prompt context + user message for a multi-block session/prompt frame | Yes |
| `agents/ui/agentSessionTranscript.test.mjs` | observer feed renders system-prompt before prompt-context in display order (first turn, realistic pool.rs sequence) | Yes |
| `agents/ui/agentSessionTranscript.test.mjs` | observer feed renders system-prompt before prompt-context in display order (multi-turn) | Yes |
| `agents/ui/agentSessionTranscript.test.mjs` | steer ingress bundles its prompt context into the steer prompt segment, not a standalone row | Yes |
| `agents/ui/agentSessionTranscriptHelpers.test.mjs` | parsePromptText extracts event id, content, hex pubkey, and a title-cased kind | Yes |
| `agents/ui/agentSessionTranscriptHelpers.test.mjs` | parsePromptText lowercases the extracted hex pubkey | Yes |
| `agents/ui/agentSessionTranscriptHelpers.test.mjs` | parsePromptText preserves multiline event content in the user bubble text | Yes |
| `agents/ui/agentSessionTranscriptHelpers.test.mjs` | parsePromptText yields a null pubkey when From has no hex | Yes |
| `agents/ui/personaModelDiscoveryStatus.test.mjs` | Dobius shared compute names the empty state and next action | Yes |
| `agents/ui/useLoadArchivedObserverEvents.test.mjs` | useLoadArchivedObserverEvents — mounted hook lifecycle regressions > test_A_B_A_old_request_cannot_corrupt_fresh_A_state | Yes |
| `agents/ui/useLoadArchivedObserverEvents.test.mjs` | useLoadArchivedObserverEvents — mounted hook lifecycle regressions > test_deferred_A_ingest_cannot_exhaust_B_or_steal_B_lock | Yes |
| `agents/ui/useLoadArchivedObserverEvents.test.mjs` | useLoadArchivedObserverEvents — mounted hook lifecycle regressions > test_exhausted_channel_A_switch_to_B_hook_reads_B_from_null_cursor | Yes |
| `agents/ui/useLoadArchivedObserverEvents.test.mjs` | useLoadArchivedObserverEvents — mounted hook lifecycle regressions > test_two_concurrent_fetches_during_backfill_only_one_proceeds | Yes |
| `channels/lib/threadViewModePreference.test.mjs` | keeps the in-memory choice when persistence fails | Yes |
| `channels/lib/threadViewModePreference.test.mjs` | loads and writes the stored split preference | Yes |
| `channels/lib/threadViewModePreference.test.mjs` | missing, malformed, and unreadable preferences default to split | Yes |
| `messages/lib/persistentAgentAudience.test.mjs` | completion after disabling cannot repopulate audiences | Yes |
| `messages/lib/persistentAgentAudience.test.mjs` | conversation scopes isolate identities, channels, and threads | Yes |
| `messages/lib/persistentAgentAudience.test.mjs` | explicit recipients merge and dedupe after successful send | Yes |
| `messages/lib/persistentAgentAudience.test.mjs` | invalid, duplicate, and differently-cased pubkeys normalize | Yes |
| `messages/lib/persistentAgentAudience.test.mjs` | new recipients retain explicit mention order | Yes |
| `messages/lib/persistentAgentAudience.test.mjs` | removal while send awaits wins over late success | Yes |
| `messages/lib/persistentAgentAudience.test.mjs` | removing final chip preserves an explicit empty scope | Yes |
| `messages/lib/persistentAgentAudience.test.mjs` | successful fast send promotes without a persisted draft key | Yes |
| `messages/lib/persistentAgentAudience.test.mjs` | successful send makes authored mention order authoritative | Yes |
| `messages/lib/persistentAgentAudience.test.mjs` | successful send retains saved targets absent from the draft | Yes |
| `messages/lib/persistentAgentAudience.test.mjs` | thread root audience initializes once and explicit clear wins on reopen | Yes |
| `messages/lib/persistentAgentAudience.test.mjs` | timeline scope is intentionally unsupported | Yes |
| `messages/lib/renderScopedReactions.test.mjs` | Suite load: `test.afterEach` is not available in the node:test shim | Yes |
| `messages/ui/virtuaWheelModePatch.test.mjs` | Suite load: missing `src/renderer/src/patches/virtua@0.49.3.patch` | Yes |
| `onboarding/ui/presetLogos.test.mjs` | preset "amp" has a bundled logo or inline mark | Yes |
| `onboarding/ui/presetLogos.test.mjs` | preset "devin" has a bundled logo or inline mark | Yes |
| `onboarding/ui/presetLogos.test.mjs` | preset "grok" has a bundled logo or inline mark | Yes |
| `onboarding/ui/presetLogos.test.mjs` | preset "hermes" has a bundled logo or inline mark | Yes |
| `onboarding/ui/presetLogos.test.mjs` | preset "kimi" has a bundled logo or inline mark | Yes |
| `onboarding/ui/presetLogos.test.mjs` | preset "omp" has a bundled logo or inline mark | Yes |
| `onboarding/ui/presetLogos.test.mjs` | preset "openclaw" has a bundled logo or inline mark | Yes |
| `onboarding/ui/presetLogos.test.mjs` | preset "opencode" has a bundled logo or inline mark | Yes |

## Remaining manual checks

The Settings > Channels screenshot was not captured, and the wrappers were not run against the user's installed app. Generated scripts were executed in isolated test homes, with curl arguments captured to verify the exact bridge requests; the existing dispatch-server tests also ran in the wider test command. The baseline test failures above remain outside this approved deletion-and-wrapper task.
