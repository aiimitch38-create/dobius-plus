import type {
  RuntimeFileOpenNotification,
  RuntimeDiffOpenNotification
} from '../../../shared/runtime-files'
import type { AppState } from '../store/types'
import { detectLanguage } from '../lib/language-detect'

/** The renderer still owns publication; only explicit foreground opens select it. */
export function openMobileResourceInStore(
  store: AppState,
  data: RuntimeFileOpenNotification | RuntimeDiffOpenNotification
): void {
  const foreground = data.activate !== false
  if (foreground) {
    store.setActiveWorktree(data.worktreeId)
    store.markWorktreeVisited(data.worktreeId)
    store.setActiveView('terminal')
  }
  if ('staged' in data) {
    store.openDiff(
      data.worktreeId,
      data.filePath,
      data.relativePath,
      detectLanguage(data.relativePath),
      data.staged,
      { runtimeEnvironmentId: data.runtimeEnvironmentId, activate: foreground }
    )
  } else {
    store.openFile(
      {
        filePath: data.filePath,
        relativePath: data.relativePath,
        worktreeId: data.worktreeId,
        language: detectLanguage(data.relativePath),
        runtimeEnvironmentId: data.runtimeEnvironmentId,
        mode: 'edit'
      },
      { activate: foreground, suppressActiveRuntimeFallback: !foreground }
    )
  }
  if (foreground) {
    store.setActiveTabType('editor')
    store.revealWorktreeInSidebar(data.worktreeId)
  }
}
