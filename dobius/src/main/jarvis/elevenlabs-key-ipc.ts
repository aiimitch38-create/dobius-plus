import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import {
  clearElevenLabsApiKey,
  dropLegacyElevenLabsKeyFromSettings,
  getElevenLabsApiKeyStatus,
  saveElevenLabsApiKey,
  type ElevenLabsApiKeyStatus
} from './elevenlabs-key-store'

function elevenLabsKeyStatus(store: Store): ElevenLabsApiKeyStatus {
  const status = getElevenLabsApiKeyStatus()
  // A legacy settings key that could not be migrated still counts as configured.
  const legacy = store.getSettings().voice?.elevenlabsApiKey?.trim()
  return {
    ...status,
    configured: status.configured || Boolean(legacy),
    // The legacy key still works, so an unreadable file is not a dead end.
    unreadable: status.unreadable && !legacy
  }
}

// Why separate channels: the key is written to the protected store only and is
// never sent back to the renderer (#24); Settings learns only whether one exists.
export function registerElevenLabsKeyHandlers(store: Store): void {
  ipcMain.removeHandler('jarvis:getElevenLabsKeyStatus')
  ipcMain.handle('jarvis:getElevenLabsKeyStatus', () => elevenLabsKeyStatus(store))

  ipcMain.removeHandler('jarvis:saveElevenLabsKey')
  ipcMain.handle('jarvis:saveElevenLabsKey', (_event, apiKey: unknown) => {
    const status = saveElevenLabsApiKey(typeof apiKey === 'string' ? apiKey : '')
    if (!status.sessionOnly) {
      dropLegacyElevenLabsKeyFromSettings(store)
    }
    return elevenLabsKeyStatus(store)
  })

  ipcMain.removeHandler('jarvis:clearElevenLabsKey')
  ipcMain.handle('jarvis:clearElevenLabsKey', () => {
    clearElevenLabsApiKey()
    dropLegacyElevenLabsKeyFromSettings(store)
    return elevenLabsKeyStatus(store)
  })
}
