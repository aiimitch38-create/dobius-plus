# TASK-02 deletion evidence

Deleted 10 files under `dobius/src/renderer/src/components/communications/features/`. Checked on 2026-11-21 after TASK-01 commit `390773a6`.

Before each deletion, `rg -n --hidden -F` searched the full module path, its `@comms/` alias, basename, and every named export across `dobius/src`, `dobius/tests`, and `dobius/config`. The table records the exact basename/export search terms; full paths and aliases come from the file column. Each search returned zero matches outside the file itself immediately before unlinking. Static path resolution separately checked relative imports, `@comms`, `@renderer`, `@/`, `.js`-to-TypeScript imports, directory entry points, re-exports, lazy imports, require calls, and source-file string references. Test files were retained as runner entry points.

## Deleted files

| File (relative to communications/features/) | Basename and export search terms | External matches / importers |
| --- | --- | --- |
| `agents/lib/pickBotName.ts` | `pickBotName` | 0 / 0 |
| `agents/ui/AgentGroupRows.tsx` | `AgentGroupRows`, `AgentGroupRowsProps` | 0 / 0 |
| `agents/ui/CreateNewButton.tsx` | `CreateNewButton` | 0 / 0 |
| `agents/ui/useWindowFileDragOver.ts` | `useWindowFileDragOver` | 0 / 0 |
| `channels/ui/useEffectiveRuntimes.ts` | `useEffectiveRuntimes` | 0 / 0 |
| `channels/ui/useReusableAgentDetection.ts` | `useReusableAgentDetection` | 0 / 0 |
| `messages/useLoadMissingAncestors.ts` | `useLoadMissingAncestors` | 0 / 0 |
| `moderation/ui/TimeoutDurationSubmenu.tsx` | `TimeoutDurationSubmenu` | 0 / 0 |
| `projects/lib/projectLabels.ts` | `projectLabels`, `getDiscussionLabel` | 0 / 0 |
| `workflows/ui/CreateWorkflowDialog.tsx` | `CreateWorkflowDialog` | 0 / 0 |

## Kept candidates with references

Files with importers or source-file references were kept, including members of any unreachable chain. The original estimate of about 42 did not override the requirement to retain every file with an importer.

| File (relative to communications/features/) | Reason retained |
| --- | --- |
| `agents/lib/useBotRecents.ts` | Referenced by `dobius/src/renderer/src/components/communications/features/agents/lib/useBotRecents.test.mjs` |

All remaining production modules have importers or preserved source references; all test modules remain discoverable by the test runner. No source file outside `communications/features/` was modified in TASK-02.

## Step 0.6: whole-chain reachability audit (2026-11-21)

The earlier section records the original single-file check. This follow-up replaces that retention rule with reachability from the actual application entry points: an import from another dead file does not make a module live.

### Method

Parsed the source files with the installed TypeScript compiler API, then walked the dependency graph from every main-process input in `dobius/electron.vite.config.ts`, the preload input, and the desktop renderer entry `src/renderer/src/main.tsx`. Also included the web renderer entry `src/renderer/src/web/main.tsx` from `vite.web.config.ts` / `web-index.html`, the CLI entry `src/cli/index.ts`, and the separately bundled relay entry `src/relay/relay.ts`.

The walk follows static imports (including type imports), side-effect imports, re-exports, literal dynamic `import()` calls (including React lazy loaders), `require()`, and source URLs relative to `import.meta.url`. Resolution covers `@comms`, `@renderer`, `@/`, the communications/Tauri aliases, relative paths, directory index files, query suffixes, and JavaScript-to-TypeScript extensions. A live `.mjs` module also keeps its `.d.mts` type declaration. No reachable renderer module uses a computed import or `import.meta.glob`; the only computed loader found among the build entries loads the native speech package in `src/main/speech/stt-worker.ts`, outside this feature tree.

Tests are runner entries, not application roots. Removed a test only when all its feature subjects were dead; checked imports and source-file references as well as the graph. The five tests below cover only the deleted modules. Kept the effort-table JSON fixture because `agents/ui/effortTable.fixture.test.mjs` reads it and tests the live `buzzAgentConfig.ts` module. Kept the four `.d.mts` declarations for live message/project modules and both imported image assets. There were no mixed live/dead test subjects to rewrite.

### Deleted feature modules (23)

All paths below are relative to `dobius/src/renderer/src/components/communications/features/`. All 23 are unreachable from every entry point above. The last column names any production importer found; each named importer is also unreachable.

| File | Unreachable production importer(s) |
| --- | --- |
| `agents/lib/liveSwitchOutcome.ts` | `agents/ui/ModelPicker.tsx` |
| `agents/lib/useBotRecents.ts` | None |
| `agents/ui/ManagedAgentRow.tsx` | None |
| `agents/ui/ModelPicker.tsx` | None |
| `channels/ui/AddChannelBotGenericSection.tsx` | None |
| `channels/ui/AddChannelBotReuseGuard.tsx` | None |
| `channels/ui/ChannelMemberInviteCard.tsx` | None |
| `channels/ui/MembersSidebarAgentControls.tsx` | None |
| `channels/ui/QuickBotBar.tsx` | None |
| `channels/ui/useQuickBotDrop.ts` | None |
| `communities/legacyCommunityStorage.ts` | `communications/main.tsx` |
| `community-members/ui/CommunityMembersCard.tsx` | None |
| `community-members/ui/ConfirmRemoveDialog.tsx` | `community-members/ui/CommunityMembersCard.tsx` |
| `home/ui/FeedSection.tsx` | None |
| `home/ui/RecentNotesSection.tsx` | None |
| `profile/lib/nostrBindCallback.ts` | `profile/ui/NostrBindConsentDialog.tsx` |
| `profile/lib/nostrIdentityBinding.ts` | `profile/ui/NostrBindConsentDialog.tsx` |
| `profile/ui/AvatarUpload.tsx` | None |
| `profile/ui/NostrBindConsentDialog.tsx` | `communications/main.tsx` |
| `projects/lib/projectAgentConversation.ts` | `projects/ui/ProjectsAgentPromptPage.tsx` |
| `projects/lib/projectAgentConversationStorage.ts` | `projects/lib/projectAgentConversation.ts`, `projects/ui/ProjectsAgentPromptPage.tsx` |
| `projects/ui/ProjectsAgentPromptPage.tsx` | None |
| `sidebar/data/sidebarData.ts` | None |

### Deleted tests (5)

- `agents/lib/liveSwitchOutcome.test.mjs`
- `agents/lib/useBotRecents.test.mjs`
- `communities/legacyCommunityStorage.test.mjs`
- `profile/lib/nostrBindCallback.test.mjs`
- `projects/lib/projectAgentConversation.test.mjs`

### Previously kept candidates

`agents/lib/useBotRecents.ts` and `agents/lib/useBotRecents.test.mjs` are now removed together: no application entry reaches the module, and the test covers only that module. The live hosted-community chain stays: `AddCommunityDialog.tsx` / `WelcomeSetup.tsx` → `HostedCommunityCreateFlow.tsx` → `hostedCommunityApi.ts` and its Builderlab wrappers. All modules reached by the application graph stay, even when the importing screen is lazy or rarely opened.

The before/after graph, audit script, and raw verification logs are saved locally under `dobius/out/deadchains-verification/` (ignored build artifacts).

### Supporting deletion outside the feature tree

Also deleted `dobius/src/renderer/src/components/communications/main.tsx`, the obsolete standalone communications entry (192 lines). It is not an Electron/Vite input, neither renderer HTML file loads it, and no application module imports it. It still imported the dead legacy-storage and identity-binding chains, so leaving it would cause two missing-module typecheck errors. The coordinator explicitly approved this supporting deletion in orchestration message `msg_992b73940b78`. The current desktop and web builds continue using `CommunicationsPage.tsx`.

The repeated graph walk after deletion found zero remaining dead feature modules and retained the same 5,827 reachable source/data files. The four live `.d.mts` declarations and the effort-table fixture remain.
