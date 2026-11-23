// Settings' "Send test text" / "Confirm code" for the morning brief's handle.
// Only the main window's top frame may call them (same check as the live voice).
import { ipcMain } from 'electron'
import type { BriefHandleResult, BriefHandleStatus } from '../../shared/adam-speaks-up'
import { briefHandleVerifier } from './adam-speaks-up-wiring'

const UNTRUSTED = 'Only the Dobius+ window can do this.'

export function registerBriefHandleIpc(trusted: (event: Electron.IpcMainInvokeEvent) => boolean): void {
  ipcMain.removeHandler('jarvis:briefHandleStatus')
  ipcMain.handle('jarvis:briefHandleStatus', (event): BriefHandleStatus | null =>
    trusted(event) ? briefHandleVerifier().status() : null
  )
  ipcMain.removeHandler('jarvis:briefHandleSendCode')
  ipcMain.handle('jarvis:briefHandleSendCode', (event): Promise<BriefHandleResult> | BriefHandleResult =>
    trusted(event)
      ? briefHandleVerifier().sendCode()
      : { ok: false, error: UNTRUSTED, status: briefHandleVerifier().status() }
  )
  ipcMain.removeHandler('jarvis:briefHandleConfirm')
  ipcMain.handle('jarvis:briefHandleConfirm', (event, code: unknown): BriefHandleResult =>
    trusted(event)
      ? briefHandleVerifier().confirm(code)
      : { ok: false, error: UNTRUSTED, status: briefHandleVerifier().status() }
  )
}
