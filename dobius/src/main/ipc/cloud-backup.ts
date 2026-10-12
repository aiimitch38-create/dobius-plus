import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { Store } from '../persistence'
import { writeSecureFile } from '../../shared/secure-file'
import { CloudBackupController } from '../cloud-backup/controller'

let trustedRendererId: number | null = null
export function setTrustedCloudBackupRenderer(id: number | null): void {
  trustedRendererId = id
}

export function registerCloudBackupHandlers(store: Store): void {
  const mac = process.platform === 'darwin'
  const base = mac
    ? join(homedir(), 'Library', 'Application Support', 'Dobius Cloud Backup')
    : '/opt/dobius-cloud-backup'
  const scripts = app.isPackaged
    ? join(process.resourcesPath, 'cloud-backup')
    : join(app.getAppPath(), 'config', 'scripts', 'cloud-backup')
  const python =
    [
      join(homedir(), 'homebrew', 'bin', 'python3'),
      '/opt/homebrew/bin/python3',
      '/usr/local/bin/python3',
      '/usr/bin/python3'
    ].find(existsSync) ?? 'python3'
  const controller = new CloudBackupController({
    base,
    scripts,
    python,
    supported: mac || (process.platform === 'linux' && process.getuid?.() === 0),
    sourcePaths: () =>
      store
        .getRepos()
        .filter(
          (repo) =>
            !repo.connectionId && (!repo.executionHostId || repo.executionHostId === 'local')
        )
        .map((repo) => repo.path)
        .filter(isAbsolute),
    applicationDataPath: app.getPath('userData')
  })
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
