// In-app "are you sure?" for crew actions that reach the app over RPC.
// Why: interactive Dobius terminals hold the full runtime key, so an agent in a
// terminal can call the same RPC a human would. Resuming the crew, posting a
// draft and answering an agent's request therefore need a human click in the
// app itself, the same native dialog pattern as Adam voice's "allow command?"
// (main/jarvis/jarvis-ipc.ts). Cancel is the default button.
import { app, BrowserWindow, dialog } from 'electron'

export type CrewConfirmRequest = {
  title: string
  message: string
  detail: string
  confirmLabel: string
}

export type CrewConfirm = (request: CrewConfirmRequest) => Promise<boolean>

function pickWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && !focused.isDestroyed()) {
    return focused
  }
  return BrowserWindow.getAllWindows().find((win) => !win.isDestroyed()) ?? null
}

export const showCrewConfirmDialog: CrewConfirm = async (request) => {
  const win = pickWindow()
  // No window means no human can see the question, so the answer is no.
  if (!win) {
    return false
  }
  app.focus({ steal: true })
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    title: request.title,
    message: request.message,
    detail: request.detail,
    buttons: ['Cancel', request.confirmLabel],
    defaultId: 0,
    cancelId: 0
  })
  return response === 1
}
