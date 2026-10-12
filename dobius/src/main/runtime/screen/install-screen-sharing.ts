import { execFile } from 'node:child_process'
import { app, BrowserWindow, dialog, ipcMain, powerMonitor } from 'electron'
import type { DobiusRuntimeService } from '../dobius-runtime'
import type { DeviceEntry } from '../device-registry'
import { isRegisteredRendererWebContents } from '../../window/renderer-window-registry'
import { resolveMacOSComputerUseAppPath } from '../../computer/macos-native-provider-paths'
import { DesktopScreenError } from '../../../shared/desktop-screen-errors'
import { createNativeScreenCaptureBackend } from './native-screen-capture'
import { ScreenSessionService } from './screen-session-service'
import { showScreenViewingBanner } from './screen-viewing-banner'

export function installDesktopScreenSharing(
  runtime: DobiusRuntimeService,
  device: (id: string) => DeviceEntry | null
): void {
  if (process.platform !== 'darwin') {
    return
  }
  const service = new ScreenSessionService(createNativeScreenCaptureBackend(), device)
  service.setConsentUi({
    indicatorVisible: () => !app.isHidden(),
    approve: async (name, signal) => {
      const parent = BrowserWindow.getAllWindows().find(
        (win) => !win.isDestroyed() && isRegisteredRendererWebContents(win.webContents)
      )
      if (!parent || signal.aborted) {
        return false
      }
      parent.show()
      const result = await dialog.showMessageBox(parent, {
        type: 'question',
        title: 'View your Mac screen',
        message: `Allow “${name}” to view your main screen?`,
        detail:
          'Your phone will see everything visible, including private messages and passwords. Approval lasts for this viewing session. Use Stop on the Mac to end it.',
        buttons: ['Cancel', 'Allow'],
        defaultId: 0,
        cancelId: 0,
        signal
      })
      return !signal.aborted && result.response === 1
    },
    show: showScreenViewingBanner
  })
  runtime.desktopScreen = service
  // A hidden application loses its visible indicator, so hiding ends the session too.
  app.on('before-quit', () => service.stop('shutdown'))
  powerMonitor.on('suspend', () => service.stop('sleep'))
  powerMonitor.on('lock-screen', () => service.stop('sleep'))
  ipcMain.handle('screenSharing:enable', (event) => {
    if (!isRegisteredRendererWebContents(event.sender) || event.senderFrame?.parent !== null) {
      throw new DesktopScreenError('screen_not_authorized')
    }
    const helper = resolveMacOSComputerUseAppPath()
    if (!helper) {
      throw new DesktopScreenError('screen_unsupported')
    }
    // Launch the helper's own explicit screen-only setup mode; this is never a phone RPC.
    return new Promise<{ opened: true }>((resolve, reject) => {
      execFile(
        '/usr/bin/open',
        ['-n', helper, '--args', '--screen-enable'],
        { timeout: 15000 },
        (error) => {
          if (error) {
            reject(new DesktopScreenError('screen_unsupported'))
          } else {
            resolve({ opened: true })
          }
        }
      )
    })
  })
}
