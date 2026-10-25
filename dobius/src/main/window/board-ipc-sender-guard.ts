import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'

/**
 * Only the Board window's top frame counts as the human for co-presence IPC.
 * A web tile guest, a sub-frame of the Board, a paired client or any other
 * webContents must not be able to pause/resume/approve agents or claim that
 * the human is working inside a tile (`agents:yield`).
 */
export function assertBoardWindowSender(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  mainWindow: Pick<BrowserWindow, 'webContents'>,
  channel: string
): void {
  if (
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame
  ) {
    throw new Error(`forbidden: ${channel} is only accepted from the Board window`)
  }
}
