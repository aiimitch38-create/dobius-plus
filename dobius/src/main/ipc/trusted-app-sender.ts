import type { IpcMainInvokeEvent } from 'electron'
import { isRegisteredRendererWebContents } from '../window/renderer-window-registry'

// Why: some IPC handlers are the human's own click (resume the crew, post a
// draft, answer an agent). Only the top frame of a first-party app window may
// call them; webview guests, web tiles and subframes are refused. Same rule as
// runtime:call in runtime.ts.
export function isTrustedAppSender(event: IpcMainInvokeEvent): boolean {
  const sender = event.sender
  if (typeof sender?.isDestroyed !== 'function' || sender.isDestroyed()) {
    return false
  }
  if (!isRegisteredRendererWebContents(sender)) {
    return false
  }
  const frame = event.senderFrame
  return frame != null && frame.parent === null
}

export function assertTrustedAppSender(event: IpcMainInvokeEvent, channel: string): void {
  if (!isTrustedAppSender(event)) {
    throw new Error(`${channel} is only available to the Dobius+ app window`)
  }
}
