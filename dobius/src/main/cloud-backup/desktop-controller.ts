// The one desktop CloudBackupController, built from the app's settings and
// shared by the window's `cloudBackup:*` IPC and the runtime RPC
// (`dobius backup status|run`), so both see the same pending/failed state.
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { Store } from '../persistence'
import { CloudBackupController } from './controller'

export function cloudBackupBase(): string {
  return process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'Dobius Cloud Backup')
    : '/opt/dobius-cloud-backup'
}

function createDesktopCloudBackupController(store: Store): CloudBackupController {
  const mac = process.platform === 'darwin'
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
  return new CloudBackupController({
    base: cloudBackupBase(),
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
}

let current: CloudBackupController | null = null

/** Builds the controller once (when the IPC handlers register) and keeps it. */
export function installDesktopCloudBackupController(store: Store): CloudBackupController {
  current ??= createDesktopCloudBackupController(store)
  return current
}

/** The controller for the runtime RPC; throws before the app window set it up. */
export function desktopCloudBackupController(): CloudBackupController {
  if (!current) {
    throw new Error('Backups are not ready yet. Open the Dobius+ window and try again.')
  }
  return current
}
