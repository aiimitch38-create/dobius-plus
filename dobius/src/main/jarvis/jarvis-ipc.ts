import { BrowserWindow, app, globalShortcut, ipcMain } from 'electron'
import { getDefaultVoiceSettings } from '../../shared/constants'
import type { VoiceSettings } from '../../shared/speech-types'
import type { Store } from '../persistence'
import { getSpeechSttService } from '../speech/speech-runtime-service'
import { jarvisTrace } from './jarvis-trace'
import {
  JARVIS_PTT_PRESSED_CHANNEL,
  JARVIS_PTT_RELEASED_CHANNEL,
  JARVIS_SHORTCUT_ACCELERATOR,
  getJarvisService,
  isWakeSessionOwner,
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

// Why track focus: ⌘T works system-wide, so at press time the focused window
// may belong to another app. The PTT signal must reach exactly ONE Dobius
// window (focused now, else the last one that was focused); broadcasting to
// all windows made every mounted voice controller start a competing mic
// session — N-1 of which failed with error flashes.
let lastFocusedJarvisWindowId: number | null = null

function electPttWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && !focused.isDestroyed()) {
    lastFocusedJarvisWindowId = focused.id
    return focused
  }
  if (lastFocusedJarvisWindowId !== null) {
    const remembered = BrowserWindow.getAllWindows().find(
      (win) => win.id === lastFocusedJarvisWindowId && !win.isDestroyed()
    )
    if (remembered) {
      return remembered
    }
  }
  return BrowserWindow.getAllWindows().find((win) => !win.isDestroyed()) ?? null
}

function createBroadcastPort(): JarvisBroadcastPort {
  // State broadcasts go to ALL windows so every orb mirrors the phase; PTT
  // presses go to exactly one elected window so only one controller reacts.
  return (channel, payload) => {
    const targets =
      channel === JARVIS_PTT_PRESSED_CHANNEL || channel === JARVIS_PTT_RELEASED_CHANNEL
        ? [electPttWindow()]
        : BrowserWindow.getAllWindows()
    for (const win of targets) {
      if (win && !win.isDestroyed()) {
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
  // Why: focus tracking must span the app lifetime, not one registration pass
  // (macOS recreates the main window on re-activation).
  app.on('browser-window-focus', (_event, win) => {
    lastFocusedJarvisWindowId = win.id
  })
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
    jarvisTrace('setMode', { on, ok })
    // Why only-on-success: persisting jarvisEnabled=true when the shortcut was
    // refused would retry a broken grab on every relaunch.
    if (ok) {
      persistVoicePatch(store, { jarvisEnabled: on })
    }
    return { ok }
  })

  ipcMain.removeHandler('jarvis:ask')
  ipcMain.handle('jarvis:ask', async (_event, utterance: string) => {
    jarvisTrace('ask-ipc-received', { chars: typeof utterance === 'string' ? utterance.length : 0 })
    console.log('[jarvis:main] ask received', typeof utterance === 'string' ? utterance.slice(0, 60) : typeof utterance)
    const result = await service.ask(utterance)
    console.log('[jarvis:main] ask result', result.kind)
    return result
  })

  ipcMain.removeHandler('jarvis:speak')
  ipcMain.handle('jarvis:speak', (_event, text: string) => service.speak(text))

  ipcMain.removeHandler('jarvis:cancelSpeak')
  ipcMain.handle('jarvis:cancelSpeak', () => {
    service.cancelSpeaking()
    return { ok: true }
  })

}

function wireWakeWordObservation(store: Store, service: JarvisService): void {
  // The matcher inside the service no-ops unless voice.jarvisWakeWord is on,
  // so the tap stays permanently installed and cheap while dictation is idle.
  // The owner filter keeps ordinary ⌘E dictation text from arming it.
  tapSttFinalTranscripts(
    getSpeechSttService(store),
    (text) => service.handleAmbientTranscript(text),
    { ownerFilter: isWakeSessionOwner }
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
