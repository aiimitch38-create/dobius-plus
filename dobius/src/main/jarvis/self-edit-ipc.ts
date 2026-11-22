import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { getUserDataRoot } from '../storage/user-data-root'
import { closeSelfEditWindow, showSelfEditProposal } from '../window/self-edit-window'
import { SelfEditStore, selfEditRoots } from './self-edit'
import { resolveSelfEditRepoRoot } from './self-edit-repo-root'

/** ADAM's self-edit flow: propose (shown for review), apply, undo, discard. */
export function registerSelfEditHandlers(): void {
  const repoRoot = resolveSelfEditRepoRoot({
    isPackaged: app.isPackaged,
    env: process.env,
    home: app.getPath('home'),
    resourcesPath: process.resourcesPath
  })
  const selfEdits = repoRoot.ok
    ? new SelfEditStore(selfEditRoots(app.getPath('home'), repoRoot.root))
    : new SelfEditStore([], Date.now, repoRoot.error)
  const selfEditBackups = join(getUserDataRoot(), 'self-edit-backups')

  ipcMain.removeHandler('jarvis:proposeSelfEdit')
  ipcMain.handle(
    'jarvis:proposeSelfEdit',
    (_event, path: string, content: string, description: string) => {
      const result = selfEdits.propose(
        String(path ?? ''),
        String(content ?? ''),
        String(description ?? '')
      )
      if (!result.ok) {
        return result
      }
      showSelfEditProposal(result.proposal)
      return { ok: true, id: result.proposal.id, displayPath: result.proposal.displayPath }
    }
  )

  ipcMain.removeHandler('jarvis:applySelfEdit')
  ipcMain.handle('jarvis:applySelfEdit', (_event, id: string) => {
    const result = selfEdits.apply(String(id ?? ''), selfEditBackups)
    if (result.ok) {
      closeSelfEditWindow()
    }
    return result
  })

  // Why no window: undo is asked for by voice after the review window closed.
  ipcMain.removeHandler('jarvis:undoSelfEdit')
  ipcMain.handle('jarvis:undoSelfEdit', (_event, id: string) => selfEdits.undo(String(id ?? '')))

  ipcMain.removeHandler('jarvis:discardSelfEdit')
  ipcMain.handle('jarvis:discardSelfEdit', (_event, id: string) => {
    const discarded = selfEdits.discard(String(id ?? ''))
    closeSelfEditWindow()
    return { ok: discarded }
  })
}
