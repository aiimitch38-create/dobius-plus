import { ipcRenderer } from 'electron'
import type { CloudBackupApi } from '../shared/cloud-backup'

export const cloudBackupApi: CloudBackupApi = {
  getStatus: () => ipcRenderer.invoke('cloudBackup:getStatus'),
  connect: (input) => ipcRenderer.invoke('cloudBackup:connect', input),
  runNow: () => ipcRenderer.invoke('cloudBackup:runNow'),
  setEnabled: (enabled) => ipcRenderer.invoke('cloudBackup:setEnabled', enabled),
  exportRecoveryKey: () => ipcRenderer.invoke('cloudBackup:exportRecoveryKey')
}
