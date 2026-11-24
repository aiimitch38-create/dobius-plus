import { ipcMain, shell } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { ImessageBridgeConfig } from '../../shared/imessage-bridge'
import {
  getImessageBridgeConfig,
  getImessageBridgeStatus,
  restartImessageBridge,
  testImessageSend,
  updateImessageBridgeSettings
} from '../imessage-bridge/bridge-service'
import { approveImessageHandle } from '../imessage-bridge/approved-handles'
import { trustedLiveSender } from '../jarvis/jarvis-host-window'

// Deep link to the Full Disk Access pane; reading chat.db requires the grant.
const MACOS_FULL_DISK_ACCESS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'

type Trusted = (event: IpcMainInvokeEvent) => boolean

export const IMESSAGE_BRIDGE_UNTRUSTED = 'Only the Dobius+ window can change the iMessage bridge.'

// Why gated: these hold Carson's handle and can turn the bridge on or send a
// text, so only the main window's top frame (where Settings runs) may call them.
export function registerImessageBridgeHandlers(
  trusted: Trusted = (event) => trustedLiveSender(event) !== null
): void {
  ipcMain.removeHandler('imessageBridge:getConfig')
  ipcMain.handle('imessageBridge:getConfig', (event) => (trusted(event) ? getImessageBridgeConfig() : null))

  ipcMain.removeHandler('imessageBridge:updateConfig')
  ipcMain.handle(
    'imessageBridge:updateConfig',
    (event, updates: Partial<Omit<ImessageBridgeConfig, 'lastSeenRowid'>>) => {
      if (!trusted(event)) {
        throw new Error(IMESSAGE_BRIDGE_UNTRUSTED)
      }
      // Why: lastSeenRowid is bridge-owned dispatch state; a renderer must not
      // be able to rewind it and replay old messages as commands.
      const { enabled, triggerPrefix, selfHandle } = updates
      return (async () => {
        // Why: the bridge, conductor and brief text this handle with no click, so it needs Touch ID once.
        if (typeof selfHandle === 'string') {
          const refused = await approveImessageHandle(selfHandle)
          if (refused) {
            throw new Error(refused)
          }
        }
        // Throws while imessage-bridge.json is unreadable (BUILD-009C review F1).
        const next = updateImessageBridgeSettings({ enabled, triggerPrefix, selfHandle })
        restartImessageBridge()
        return next
      })()
    }
  )

  ipcMain.removeHandler('imessageBridge:status')
  ipcMain.handle('imessageBridge:status', (event) => (trusted(event) ? getImessageBridgeStatus() : null))

  ipcMain.removeHandler('imessageBridge:openFullDiskAccess')
  ipcMain.handle('imessageBridge:openFullDiskAccess', (event) =>
    trusted(event) ? shell.openExternal(MACOS_FULL_DISK_ACCESS_URL) : undefined
  )

  ipcMain.removeHandler('imessageBridge:testSend')
  ipcMain.handle('imessageBridge:testSend', (event) =>
    trusted(event) ? testImessageSend() : { ok: false, error: IMESSAGE_BRIDGE_UNTRUSTED }
  )
}
