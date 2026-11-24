// The main window ADAM's voice and Settings run in, and the check that an IPC
// call comes from its top frame. Kept apart from jarvis-ipc.ts so other IPC
// files (the iMessage bridge) can use the same check without loading voice.
import type { BrowserWindow, IpcMainInvokeEvent, WebContents } from 'electron'

let host: BrowserWindow | null = null

export function setJarvisHostWindow(window: BrowserWindow): void {
  host = window
}

// Why checked in main: any frame that can reach ipcRenderer could otherwise
// start a billed call or read private settings. Only the main window's top frame may.
export function trustedLiveSender(event: IpcMainInvokeEvent): WebContents | null {
  if (!host || host.isDestroyed()) {
    return null
  }
  const sender = event?.sender
  if (!sender || sender !== host.webContents || sender.isDestroyed()) {
    return null
  }
  return event.senderFrame && event.senderFrame === sender.mainFrame ? sender : null
}
