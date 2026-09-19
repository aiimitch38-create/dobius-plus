import { ipcMain } from 'electron'
import type { HostingerDnsRecordInput } from '../../shared/hostinger'
import {
  clearHostingerToken,
  hasHostingerToken,
  setHostingerToken
} from '../hostinger/hostinger-token-store'
import {
  getHostingerStatus,
  listHostingerDns,
  listHostingerDomains,
  listHostingerVps,
  upsertHostingerDnsRecord
} from '../hostinger/hostinger-client'

export function registerHostingerHandlers(): void {
  ipcMain.removeHandler('hostinger:setToken')
  ipcMain.handle('hostinger:setToken', (_event, token: string) => {
    setHostingerToken(token)
  })

  ipcMain.removeHandler('hostinger:hasToken')
  ipcMain.handle('hostinger:hasToken', () => hasHostingerToken())

  ipcMain.removeHandler('hostinger:clearToken')
  ipcMain.handle('hostinger:clearToken', () => {
    clearHostingerToken()
  })

  ipcMain.removeHandler('hostinger:status')
  ipcMain.handle('hostinger:status', () => getHostingerStatus())

  ipcMain.removeHandler('hostinger:listVps')
  ipcMain.handle('hostinger:listVps', () => listHostingerVps())

  ipcMain.removeHandler('hostinger:listDomains')
  ipcMain.handle('hostinger:listDomains', () => listHostingerDomains())

  ipcMain.removeHandler('hostinger:listDns')
  ipcMain.handle('hostinger:listDns', (_event, domain: string) => listHostingerDns(domain))

  // The single Hostinger write. Reachable only from an explicit user click.
  ipcMain.removeHandler('hostinger:upsertDns')
  ipcMain.handle('hostinger:upsertDns', (_event, input: HostingerDnsRecordInput) =>
    upsertHostingerDnsRecord(input)
  )
}
