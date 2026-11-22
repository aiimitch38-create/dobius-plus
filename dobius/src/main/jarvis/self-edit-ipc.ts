import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { getUserDataRoot } from '../storage/user-data-root'
import {
  closeSelfEditWindow,
  getSelfEditWindow,
  showSelfEditProposal
} from '../window/self-edit-window'
import { SelfEditStore, selfEditRoots } from './self-edit'
import { resolveSelfEditRepoRoot } from './self-edit-repo-root'

type TrustCheck = (event: Electron.IpcMainInvokeEvent) => boolean

const NOT_ALLOWED = { ok: false as const, error: 'Self-edit is not allowed from this window.' }

/** The review window's top frame, which shows the proposal Carson approves. */
function isReviewFrame(event: Electron.IpcMainInvokeEvent): boolean {
  const review = getSelfEditWindow()?.webContents
  return Boolean(review && event?.sender === review && event.senderFrame === review.mainFrame)
}

/**
 * ADAM's self-edit flow: propose (shown for review), apply, undo, discard.
 * Why checked: these write files in the app's own code. Only the main window's
 * top frame (the voice agent) may propose or undo; it or the review window
 * may apply or discard.
 */
export function registerSelfEditHandlers(isMainFrame: TrustCheck): void {
  const mayDecide: TrustCheck = (event) => isMainFrame(event) || isReviewFrame(event)
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
    (event, path: string, content: string, description: string) => {
      if (!isMainFrame(event)) {
        return NOT_ALLOWED
      }
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
  ipcMain.handle('jarvis:applySelfEdit', (event, id: string) => {
    if (!mayDecide(event)) {
      return NOT_ALLOWED
    }
    const result = selfEdits.apply(String(id ?? ''), selfEditBackups)
    if (result.ok) {
      closeSelfEditWindow()
    }
    return result
  })

  // Why no window: undo is asked for by voice after the review window closed.
  ipcMain.removeHandler('jarvis:undoSelfEdit')
  ipcMain.handle('jarvis:undoSelfEdit', (event, id: string) =>
    isMainFrame(event) ? selfEdits.undo(String(id ?? '')) : NOT_ALLOWED
  )

  ipcMain.removeHandler('jarvis:discardSelfEdit')
  ipcMain.handle('jarvis:discardSelfEdit', (event, id: string) => {
    if (!mayDecide(event)) {
      return { ok: false }
    }
    const discarded = selfEdits.discard(String(id ?? ''))
    closeSelfEditWindow()
    return { ok: discarded }
  })
}
