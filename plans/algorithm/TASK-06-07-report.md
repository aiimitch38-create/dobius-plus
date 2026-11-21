# Steps 0.6 and 0.7: dead-chain cleanup

Removed 23 unreachable communications feature modules, their five subject-only tests (26 test cases), and the obsolete standalone communications entry. The current desktop/web entry, all reachable features, four live JavaScript type declarations, image assets, and the effort-table test fixture remain. The complete deletion list and reachability method are in [TASK-02-deleted.md](TASK-02-deleted.md).

## Commits

- Step 0.6: `e960c7ce` — remove unreachable communications feature chains.
- Step 0.7: the commit containing this report — remove stale coverage/lint entries and unused mesh mocks; its SHA is in the worker completion message.

The coordinator approved removing `dobius/src/renderer/src/components/communications/main.tsx` in orchestration message `msg_992b73940b78`. Neither build uses it; leaving it would retain imports of deleted feature chains.

## Step 0.7 changes

- Removed 228 localization allowlist entries across 20 deleted files. Kept every remaining entry unchanged and in its existing order.
- Removed six deleted-file entries from the ordinary lint baseline, one from the switch-exhaustiveness baseline, and five from the scrollbar baseline. No baseline entry or rule count increased.
- Checked both configuration files against all 52 files deleted by TASK-01, TASK-02, and step 0.6; none of those paths remain.
- Removed the mesh fixture state, window setter/type, reset, lifecycle/catalog/status/usage handlers, managed-agent preflight fixture, and mesh-specific discovery fixture from `testing/e2eBridge.ts`. No test references its mesh setter, no reachable production caller invokes the removed `mesh_*` commands, and the application never reaches the bridge; its only non-test importer was the retired standalone entry. The live agent-provider UI stays.

## Verification

All commands ran from this worktree's `dobius/` directory. The second graph walk found no remaining dead feature modules and preserved all 5,827 previously reachable source/data files.

| Check | Exit | Result |
| --- | --- | --- |
| `pnpm run typecheck:node` | 0 | Passed |
| `pnpm run typecheck:web` | 0 | Passed after retiring the obsolete entry |
| `pnpm run typecheck:cli` | 0 | Passed |
| `node config/scripts/check-lint-baseline.mjs oxlint --files src/renderer/src/components/communications/testing/e2eBridge.ts` | 0 | Passed |
| Same touched-file check using `switch-exhaustiveness` | 0 | Passed |
| `pnpm exec oxlint --config config/oxlint-react-doctor.json src/renderer/src/components/communications/testing/e2eBridge.ts` | 0 | Passed |
| `npx vitest run --config config/vitest.config.ts src/renderer/src/components/communications --maxWorkers=2 --reporter=json --outputFile=out/deadchains-verification/final-tests.json` | 1 | 3,824 passed, 59 failed; two additional suite-loading errors, all present before these changes |
| `pnpm run build` | 0 | Passed: desktop, web, CLI, relay, and macOS native helper |
| `pnpm run verify:localization-coverage` | 1 | Same 265 pre-existing unlocalized strings with the original and cleaned allowlists; no new failure |
| JSON formatting check | 0 | Both edited JSON files already match the formatter |
| `git diff --check` | 0 | Passed |

The initial web check reported exactly two missing imports in the obsolete standalone entry; the final check passed after its approved deletion. The edited bridge keeps its existing semicolon/double-quote style: the whole-file formatter flags that style, which predates this task; applying it would reformat thousands of unrelated lines. All three applicable touched-file lint commands pass.

The build runs with a temporary worktree-local `ln` guard that refuses only `/usr/local/bin/dobius-dev`: the CLI build otherwise tries to install a global symlink. The build script already treats that refused installation as optional; its compilation and output checks still run. Node is `v22.22.3`, while the package requests Node 24. No dependencies were installed and no installed application or global CLI was changed.

## Communications test comparison

Captured the baseline on the unchanged starting commit `3b91688e`, in this same child worktree before deleting any file. The baseline had 3,850 passed tests and 59 failed tests; the final run has 3,824 passed and the same 59 failed tests. Both runs also have the same two suite-loading errors. Compared all 61 failing test/error names exactly: none were added or resolved. The 26 removed passing tests belong exclusively to the five deleted subject-only suites.

| Failing file (relative to communications/) | Failing tests / loading error | Also on baseline |
| --- | --- | --- |
| `app/communityViewTransition.test.mjs` | 2 failing tests | Yes |
| `features/agents/activeAgentTurnsStore.test.mjs` | 1 failing test | Yes |
| `features/agents/lib/personaCatalogRelay.test.mjs` | 4 failing tests | Yes |
| `features/agents/lib/resolvePersonaRuntime.test.mjs` | 1 failing test | Yes |
| `features/agents/lib/usePersonaSync.test.mjs` | 1 failing test | Yes |
| `features/agents/ui/agentSessionTranscript.test.mjs` | 7 failing tests | Yes |
| `features/agents/ui/agentSessionTranscriptHelpers.test.mjs` | 4 failing tests | Yes |
| `features/agents/ui/personaModelDiscoveryStatus.test.mjs` | 1 failing test | Yes |
| `features/agents/ui/useLoadArchivedObserverEvents.test.mjs` | 4 failing tests | Yes |
| `features/channels/lib/threadViewModePreference.test.mjs` | 3 failing tests | Yes |
| `features/messages/lib/persistentAgentAudience.test.mjs` | 12 failing tests | Yes |
| `features/messages/lib/renderScopedReactions.test.mjs` | Suite load: missing `node:test.afterEach` shim | Yes |
| `features/messages/ui/virtuaWheelModePatch.test.mjs` | Suite load: missing `src/renderer/src/patches/virtua@0.49.3.patch` | Yes |
| `features/onboarding/ui/presetLogos.test.mjs` | 8 failing tests | Yes |
| `shared/api/invites.test.mjs` | 4 failing tests | Yes |
| `shared/api/relayReconnectController.test.mjs` | 1 failing test | Yes |
| `shared/lib/emojiOnly.test.mjs` | 1 failing test | Yes |
| `shared/lib/mediaUrl.test.mjs` | 4 failing tests | Yes |
| `shared/lib/ncryptsecSourceScan.test.mjs` | 1 failing test | Yes |

## Evidence and remaining work

Raw logs, before/after dependency graphs, the TypeScript-AST audit script, the configuration-cleanup counts, both Vitest JSON reports, and the exact failure-name comparison are under `dobius/out/deadchains-verification/` (ignored build artifacts). See `tests-comparison.json`, `config-cleanup.json`, and `localization-comparison.json` for compact machine-readable evidence.

The existing communications test failures and localization debt remain outside this deletion task. The coordinator can review and merge these two commits into the home-base checkout.
