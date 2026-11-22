import { app, BrowserWindow, dialog, globalShortcut, ipcMain } from 'electron'
import { join } from 'node:path'
import { getDefaultVoiceSettings } from '../../shared/constants'
import type { AdamLookingAt, JarvisAskResult, VoiceSettings } from '../../shared/speech-types'
import { ADAM_THREAD_CHANNEL, AdamThreadStore, adamThreadRowOf } from './adam-thread-store'
import type { Store } from '../persistence'
import { getSpeechSttService } from '../speech/speech-runtime-service'
import { adamProjectDirectory } from '../adam-connection'
import {
  ADAM_TURN_CHANNEL,
  AdamConversation,
  lookingAtOf,
  voiceMessage,
  type AdamAskOptions
} from './adam-conversation'
import { AdamHermesVoice } from './adam-hermes-voice'
import { buildAgentContext, buildOpeningLine, runDobiusCommand } from './agent-context'
import { fetchAgentSignedUrl } from './elevenlabs-agent'
import { registerLiveVoiceIpc } from './live-voice-ipc'

export { getActiveLiveSessionForTest } from './live-voice-ipc'
import { migrateElevenLabsKeyOutOfSettings, resolveElevenLabsApiKey } from './elevenlabs-key-store'
import { registerElevenLabsKeyHandlers } from './elevenlabs-key-ipc'
import { registerSelfEditHandlers } from './self-edit-ipc'
import { fetchRecentConversationSummaries, formatConversationMemory } from './conversation-memory'
import { pickJarvisTargetWindow } from './jarvis-target-window'
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
import { getUserDataRoot } from '../storage/user-data-root'

function createGlobalShortcutPort(): JarvisShortcutPort {
  return {
    register: (handler) => globalShortcut.register(JARVIS_SHORTCUT_ACCELERATOR, handler),
    unregister: () => globalShortcut.unregister(JARVIS_SHORTCUT_ACCELERATOR)
  }
}

// Why module state: the service is a singleton built on the first register,
// but the main window is recreated on macOS re-activation.
let jarvisHostWindow: BrowserWindow | null = null

function createBroadcastPort(): JarvisBroadcastPort {
  return (channel, payload) => {
    const target = pickJarvisTargetWindow(
      BrowserWindow.getFocusedWindow(),
      jarvisHostWindow ? [jarvisHostWindow] : []
    )
    target?.webContents.send(channel, payload)
  }
}

let adamVoice: AdamHermesVoice | null = null
// What the main window last said was on screen. Wake-word turns start in main and use it.
let lastLookingAt: AdamLookingAt | null = null
let adamThread: AdamThreadStore | null = null

function getAdamThread(): AdamThreadStore {
  adamThread ??= new AdamThreadStore(join(getUserDataRoot(), 'adam-thread.json'), (rows) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(ADAM_THREAD_CHANNEL, rows)
      }
    }
  })
  return adamThread
}

function getAdamVoice(): AdamHermesVoice {
  if (!adamVoice) {
    adamVoice = new AdamHermesVoice({
      sessionFile: join(getUserDataRoot(), 'adam-voice-session.json'),
      approve: async (command, description) => {
        app.focus({ steal: true })
        const { response } = await dialog.showMessageBox({
          type: 'question',
          title: 'ADAM — allow command?',
          message: description || 'Adam is requesting permission to run a command.',
          detail: command,
          buttons: ['Cancel', 'Allow once'],
          defaultId: 0,
          cancelId: 0
        })
        return response === 1
      }
    })
    app.once('will-quit', () => {
      void adamVoice?.close()
    })
  }
  return adamVoice
}

let adamConversation: AdamConversation | null = null

/**
 * The single entry point to ADAM for every caller in main (voice turns, the
 * Board thread, a future live voice engine). One Hermes session, one turn at a
 * time, and every turn is sent to the window so it lands in the Board thread.
 */
export function askAdam(text: string, options: AdamAskOptions): ReturnType<AdamConversation['ask']> {
  if (!adamConversation) {
    const broadcast = createBroadcastPort()
    adamConversation = new AdamConversation(
      { ask: (prompt) => getAdamVoice().ask(prompt) },
      (event) => broadcast(ADAM_TURN_CHANNEL, event)
    )
  }
  return adamConversation.ask(text, options)
}

/** True while ADAM is answering any turn (voice, live call or Board). */
function isAdamBusy(): boolean {
  return adamConversation?.busy ?? false
}

function createJarvisDeps(store: Store): JarvisServiceDeps {
  return {
    store,
    broadcast: createBroadcastPort(),
    shortcut: createGlobalShortcutPort(),
    askAgent: (utterance, lookingAt) =>
      askAdam(lookingAt ? voiceMessage(utterance, lookingAt) : utterance, {
        source: 'voice',
        said: utterance
      }),
    cancelAgent: () => adamVoice?.cancel(),
    lookingAt: () => lastLookingAt
  }
}

function persistVoicePatch(store: Store, patch: Partial<VoiceSettings>): void {
  const current = store.getSettings().voice ?? getDefaultVoiceSettings()
  store.updateSettings({ voice: { ...current, ...patch } }, { notifyListeners: true })
}

export function registerJarvisIpcHandlers(store: Store, mainWindow: BrowserWindow): void {
  jarvisHostWindow = mainWindow
  // Why (#24): move a plaintext settings key into the protected store before
  // any handler reads it. Failure leaves it in settings, so it still works.
  migrateElevenLabsKeyOutOfSettings(store)
  const service = getJarvisService(createJarvisDeps(store))
  registerHandlers(store, service)
  registerElevenLabsKeyHandlers(store)
  registerLiveVoiceIpc(store, {
    trustedSender: trustedLiveSender,
    askAdam,
    isAdamBusy,
    cancelAdam: () => adamVoice?.cancel(),
    lookingAt: () => lastLookingAt,
    thread: getAdamThread
  })
  wireWakeWordObservation(store, service)
  restorePersistedMode(store, service)
}

// Why checked in main: any frame that can reach ipcRenderer could otherwise
// start a billed call. Only the main window's top frame may.
function trustedLiveSender(event: Electron.IpcMainInvokeEvent): Electron.WebContents | null {
  const host = jarvisHostWindow
  if (!host || host.isDestroyed()) {
    return null
  }
  const sender = event?.sender
  if (!sender || sender !== host.webContents || sender.isDestroyed()) {
    return null
  }
  return event.senderFrame && event.senderFrame === sender.mainFrame ? sender : null
}


// Why: a turn with ADAM can run commands and is written into Carson's thread,
// so only the main window's top frame may start one (never a web tile or embedded page).
const ADAM_UNTRUSTED_SENDER: JarvisAskResult = {
  kind: 'error',
  text: 'ADAM only takes messages from the main Dobius+ window.'
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
  ipcMain.handle('jarvis:ask', (event, utterance: string, lookingAt?: unknown) =>
    trustedLiveSender(event) ? service.ask(utterance, lookingAtOf(lookingAt)) : ADAM_UNTRUSTED_SENDER
  )

  // ADAM's thread lives in main so every window shows the same rows and none can overwrite another's.
  ipcMain.removeHandler('jarvis:adamThreadGet')
  ipcMain.handle('jarvis:adamThreadGet', () => getAdamThread().get())
  ipcMain.removeHandler('jarvis:adamThreadAppend')
  ipcMain.handle('jarvis:adamThreadAppend', async (event, raw: unknown) => {
    const row = trustedLiveSender(event) ? adamThreadRowOf(raw) : null
    if (row) {
      await getAdamThread().append(row)
    }
    return { ok: row !== null }
  })
  ipcMain.removeHandler('jarvis:adamThreadClear')
  ipcMain.handle('jarvis:adamThreadClear', async (event) => {
    if (!trustedLiveSender(event)) {
      return { ok: false }
    }
    await getAdamThread().clear()
    return { ok: true }
  })
  ipcMain.removeHandler('jarvis:lookingAt')
  ipcMain.handle('jarvis:lookingAt', (event, raw: unknown) => {
    if (trustedLiveSender(event)) {
      lastLookingAt = lookingAtOf(raw)
    }
  })

  ipcMain.removeHandler('jarvis:cancelAsk')
  ipcMain.handle('jarvis:cancelAsk', () => {
    service.cancelAsk()
    return { ok: true }
  })

  ipcMain.removeHandler('jarvis:speak')
  ipcMain.handle('jarvis:speak', (_event, text: string) => service.speak(text))

  // Why not openFloatingOrbWindow: that path shows a second, separate orb
  // window — the app's one canonical orb lives in DictationIndicator
  // (mounted app-wide) and already reacts to this same PTT broadcast. Kept
  // as an alias (not removed) in case an older client still calls openOrb.
  ipcMain.removeHandler('jarvis:openOrb')
  ipcMain.handle('jarvis:openOrb', () => {
    service.pressPtt()
    return { ok: true }
  })

  ipcMain.removeHandler('jarvis:pressPtt')
  ipcMain.handle('jarvis:pressPtt', () => {
    service.pressPtt()
  })

  ipcMain.removeHandler('jarvis:getAdamProjectDirectory')
  ipcMain.handle('jarvis:getAdamProjectDirectory', () => adamProjectDirectory())

  // Live agent: the renderer owns the websocket (it has the mic and speakers),
  // main only mints the signed URL so the API key never leaves this process.
  // Why exposed: a refused ⌘T grab is otherwise invisible — the setting still
  // reads "on" while the shortcut belongs to another app.
  ipcMain.removeHandler('jarvis:agentContext')
  ipcMain.handle('jarvis:agentContext', () =>
    buildAgentContext(join(getUserDataRoot(), 'terminal-history'))
  )

  registerSelfEditHandlers()

  // Why a separate call from agentContext: this hits the ElevenLabs API, so it
  // is fetched after the call connects rather than delaying the connection.
  ipcMain.removeHandler('jarvis:conversationMemory')
  ipcMain.handle('jarvis:conversationMemory', async () => {
    const voice = store.getSettings().voice
    const summaries = await fetchRecentConversationSummaries(
      resolveElevenLabsApiKey(voice),
      voice?.elevenlabsAgentId ?? ''
    )
    return formatConversationMemory(summaries)
  })

  ipcMain.removeHandler('jarvis:agentOpening')
  ipcMain.handle('jarvis:agentOpening', () =>
    buildOpeningLine(join(getUserDataRoot(), 'terminal-history'))
  )

  ipcMain.removeHandler('jarvis:runDobius')
  ipcMain.handle('jarvis:runDobius', (_event, command: string) =>
    runDobiusCommand(typeof command === 'string' ? command : '')
  )

  ipcMain.removeHandler('jarvis:status')
  ipcMain.handle('jarvis:status', () => ({
    shortcutActive: service.isShortcutActive(),
    phase: service.getPhase()
  }))

  ipcMain.removeHandler('jarvis:agentSignedUrl')
  ipcMain.handle('jarvis:agentSignedUrl', () => {
    const voice = store.getSettings().voice
    return fetchAgentSignedUrl(resolveElevenLabsApiKey(voice), voice?.elevenlabsAgentId ?? '')
  })

  // Why a text-only ask: during a live conversation the AGENT speaks, so
  // service.ask() would talk over it with a second voice.
  ipcMain.removeHandler('jarvis:askAdamText')
  ipcMain.handle(
    'jarvis:askAdamText',
    (event, utterance: string, source?: unknown) =>
      trustedLiveSender(event)
        ? // Why voice by default: the only caller without a source is the live voice agent's tool.
          askAdam(typeof utterance === 'string' ? utterance : '', {
            source: source === 'thread' ? 'thread' : 'voice'
          })
        : ADAM_UNTRUSTED_SENDER
  )
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
  // Why the stored flag is left on (#122-F9): writing false here silently
  // turned the user's switch off whenever another app held ⌘T at launch.
  // The error state toggle() broadcasts here is sent before the renderer
  // listens, so it is not what surfaces this: the renderer asks jarvis:status
  // on mount and toasts (use-jarvis-turn), Settings shows it too, and toggling
  // off and on retries.
  if (!service.toggle(true)) {
    console.warn('[jarvis] Cmd+T is held by another app; Jarvis stays on without the shortcut')
  }
}
