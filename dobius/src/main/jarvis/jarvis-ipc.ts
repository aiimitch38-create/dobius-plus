import { BrowserWindow, globalShortcut, ipcMain } from 'electron'
import { getDefaultVoiceSettings } from '../../shared/constants'
import type { VoiceSettings } from '../../shared/speech-types'
import type { Store } from '../persistence'
import { getSpeechSttService } from '../speech/speech-runtime-service'
import {
  JARVIS_SHORTCUT_ACCELERATOR,
  getJarvisService,
  tapSttFinalTranscripts
} from './jarvis-service'
import type {
  JarvisBroadcastPort,
  JarvisService,
  JarvisServiceDeps,
  JarvisShortcutPort
} from './jarvis-service'

function createGlobalShortcutPort(): JarvisShortcutPort {
  return {
    register: (handler) => globalShortcut.register(JARVIS_SHORTCUT_ACCELERATOR, handler),
    unregister: () => globalShortcut.unregister(JARVIS_SHORTCUT_ACCELERATOR)
  }
}

function createBroadcastPort(): JarvisBroadcastPort {
  // Why all windows: ⌘T is global, so the main window can be unfocused when a
  // press lands — the renderer voice controller must hear it regardless.
  return (channel, payload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload)
      }
    }
  }
}

function createJarvisDeps(store: Store): JarvisServiceDeps {
  return {
    store,
    broadcast: createBroadcastPort(),
    shortcut: createGlobalShortcutPort()
  }
}

function persistVoicePatch(store: Store, patch: Partial<VoiceSettings>): void {
  const current = store.getSettings().voice ?? getDefaultVoiceSettings()
  store.updateSettings({ voice: { ...current, ...patch } }, { notifyListeners: true })
}

export function registerJarvisIpcHandlers(store: Store): void {
  const service = getJarvisService(createJarvisDeps(store))
  registerHandlers(store, service)
  wireWakeWordObservation(store, service)
  restorePersistedMode(store, service)
}

function registerHandlers(store: Store, service: JarvisService): void {
  ipcMain.removeHandler('jarvis:setMode')
  ipcMain.handle('jarvis:setMode', (_event, active: unknown) => {
    const on = active === true
    const ok = service.toggle(on)
    // Why only-on-success: persisting jarvisEnabled=true when the shortcut was
    // refused would retry a broken grab on every relaunch.
    if (ok) {
      persistVoicePatch(store, { jarvisEnabled: on })
    }
    return { ok }
  })

  ipcMain.removeHandler('jarvis:ask')
  ipcMain.handle('jarvis:ask', (_event, utterance: string) => service.ask(utterance))

  ipcMain.removeHandler('jarvis:speak')
  ipcMain.handle('jarvis:speak', (_event, text: string) => service.speak(text))

}

function wireWakeWordObservation(store: Store, service: JarvisService): void {
  // The matcher inside the service no-ops unless voice.jarvisWakeWord is on,
  // so the tap stays permanently installed and cheap while dictation is idle.
  tapSttFinalTranscripts(getSpeechSttService(store), (text) =>
    service.handleAmbientTranscript(text)
  )
}

function restorePersistedMode(store: Store, service: JarvisService): void {
  if (store.getSettings().voice?.jarvisEnabled !== true) {
    return
  }
  // If the grab now conflicts with another app, fall back to off so the stored
  // flag matches what the user actually gets after relaunch.
  if (!service.toggle(true)) {
    persistVoicePatch(store, { jarvisEnabled: false })
  }
}
