import { ipcMain } from 'electron'
import type { AsanaConfig, AsanaRequeueResult } from '../../shared/asana'
import { ASANA_GID_RE } from '../../shared/asana'
import { listBlockedTaskGids, requeueTask } from '../agents/asana-dispatch-ledger'
import { getAsanaConfig, updateAsanaConfig } from '../asana/asana-config'
import { clearAsanaToken, hasAsanaToken, setAsanaToken } from '../asana/asana-token-store'
import {
  clearLocalDone,
  completeAsanaTask,
  getAsanaSnapshot,
  markLocalDone,
  refreshAsanaTasks
} from '../asana/asana-queue-service'

export function registerAsanaHandlers(): void {
  ipcMain.removeHandler('asana:getConfig')
  ipcMain.handle('asana:getConfig', () => getAsanaConfig())

  ipcMain.removeHandler('asana:updateConfig')
  ipcMain.handle('asana:updateConfig', (_event, updates: Partial<AsanaConfig>) =>
    updateAsanaConfig(updates)
  )

  ipcMain.removeHandler('asana:setToken')
  ipcMain.handle('asana:setToken', (_event, pat: string) => {
    setAsanaToken(pat)
  })

  ipcMain.removeHandler('asana:hasToken')
  ipcMain.handle('asana:hasToken', () => hasAsanaToken())

  ipcMain.removeHandler('asana:clearToken')
  ipcMain.handle('asana:clearToken', () => {
    clearAsanaToken()
  })

  ipcMain.removeHandler('asana:listTasks')
  ipcMain.handle('asana:listTasks', () => getAsanaSnapshot())

  ipcMain.removeHandler('asana:refresh')
  ipcMain.handle('asana:refresh', () => refreshAsanaTasks())

  ipcMain.removeHandler('asana:markLocalDone')
  ipcMain.handle('asana:markLocalDone', (_event, gid: string) => markLocalDone(gid))

  ipcMain.removeHandler('asana:clearLocalDone')
  ipcMain.handle('asana:clearLocalDone', (_event, gid: string) => clearLocalDone(gid))

  ipcMain.removeHandler('asana:listBlockedTasks')
  ipcMain.handle('asana:listBlockedTasks', () => listBlockedTaskGids())

  // Local ledger reset only (never writes to Asana). Renderer-only on purpose:
  // re-queueing can start a new paid build, so agents get no RPC for it.
  ipcMain.removeHandler('asana:requeueTask')
  ipcMain.handle('asana:requeueTask', (_event, gid: unknown): AsanaRequeueResult => {
    if (typeof gid !== 'string' || !ASANA_GID_RE.test(gid)) {
      return { ok: false, error: 'Invalid Asana task id.', blockedGids: listBlockedTaskGids() }
    }
    const result = requeueTask(gid)
    return {
      ok: result.ok,
      error: result.ok ? null : result.error,
      blockedGids: listBlockedTaskGids()
    }
  })

  // The single Asana write. Reachable only from an explicit user click.
  ipcMain.removeHandler('asana:completeTask')
  ipcMain.handle('asana:completeTask', (_event, gid: string) => completeAsanaTask(gid))
}
