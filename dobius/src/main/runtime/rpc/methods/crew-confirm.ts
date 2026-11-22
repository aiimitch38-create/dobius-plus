// The native dialog behind confirm-gate.ts, same pattern as Adam voice's
// "allow command?" (main/jarvis/jarvis-ipc.ts). Cancel is the default button.
import { app, BrowserWindow, dialog } from 'electron'
import { createConfirmationGate, type ConfirmDialog, type ConfirmationGate } from './confirm-gate'

function pickWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && !focused.isDestroyed()) {
    return focused
  }
  return BrowserWindow.getAllWindows().find((win) => !win.isDestroyed()) ?? null
}

export const showConfirmDialog: ConfirmDialog = async (request, signal) => {
  const win = pickWindow()
  // No window means no human can see the question, so the answer is no. A
  // parent window is also what lets `signal` close the dialog on macOS.
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
    cancelId: 0,
    signal
  })
  return response === 1
}

// One gate for every RPC path that approves, so they share the one-dialog-at-
// a-time rule and the cooldown after a decline.
export const appConfirmationGate: ConfirmationGate = createConfirmationGate(showConfirmDialog)
