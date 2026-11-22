import { BrowserWindow, dialog, ipcMain } from 'electron'
import { lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Store } from '../persistence'
import { writeSecureFile } from '../../shared/secure-file'
import {
  cloudBackupBase,
  installDesktopCloudBackupController
} from '../cloud-backup/desktop-controller'

let trustedRendererId: number | null = null
export function setTrustedCloudBackupRenderer(id: number | null): void {
  trustedRendererId = id
}

export function registerCloudBackupHandlers(store: Store): void {
  const base = cloudBackupBase()
  const controller = installDesktopCloudBackupController(store)
  function trust(event: Electron.IpcMainInvokeEvent): void {
    if (
      event.sender.id !== trustedRendererId ||
      !event.senderFrame ||
      event.senderFrame !== event.sender.mainFrame
    ) {
      throw new Error('AWS credentials can only be managed from desktop settings.')
    }
  }
  ipcMain.handle('cloudBackup:getStatus', (event) => {
    trust(event)
    return controller.getStatus()
  })
  ipcMain.handle('cloudBackup:connect', (event, input: unknown) => {
    trust(event)
    return controller.connect(input)
  })
  ipcMain.handle('cloudBackup:runNow', (event) => {
    trust(event)
    return controller.start('run')
  })
  ipcMain.handle('cloudBackup:setEnabled', (event, enabled: unknown) => {
    trust(event)
    if (typeof enabled !== 'boolean') {
      throw new Error('Backup schedule requires a boolean.')
    }
    return controller.start(enabled ? 'resume' : 'pause')
  })
  ipcMain.handle('cloudBackup:exportRecoveryKey', async (event) => {
    trust(event)
    const source = join(base, 'secrets', 'recovery-password')
    const metadata = lstatSync(source)
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.uid !== process.getuid?.() ||
      metadata.mode & 0o077
    ) {
      throw new Error('Recovery key is not a private local file.')
    }
    const parent = BrowserWindow.fromWebContents(event.sender)
    if (!parent) {
      throw new Error('Open desktop settings to export your recovery key.')
    }
    const result = await dialog.showSaveDialog(parent, {
      title: 'Save AWS backup recovery key — keep a copy in your password manager',
      defaultPath: 'Dobius-backup-recovery-key.txt'
    })
    if (result.canceled || !result.filePath) {
      return false
    }
    if (result.filePath.startsWith(base)) {
      throw new Error('Save the recovery key outside the backup runtime folder.')
    }
    writeSecureFile(result.filePath, readFileSync(source, 'utf8'))
    return true
  })
}
