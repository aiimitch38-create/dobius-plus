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
