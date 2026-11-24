import { app, BrowserWindow, dialog, globalShortcut, ipcMain } from 'electron'
import { join } from 'node:path'
import type { AdamLookingAt, JarvisAskResult } from '../../shared/speech-types'
import {
  ADAM_THREAD_CHANNEL,
  ADAM_THREAD_UNSAVED_CHANNEL,
  AdamThreadStore,
  adamThreadRowOf
} from './adam-thread-store'
import type { Store } from '../persistence'
import { adamProjectDirectory } from '../adam-connection'
import {
  ADAM_STATUS_CHANNEL,
  ADAM_TURN_CHANNEL,
  AdamConversation,
  lookingAtOf,
  voiceMessage,
  voiceTurnRow,
  type AdamAskOptions
} from './adam-conversation'
import { AdamHermesVoice } from './adam-hermes-voice'
import { registerElevenLabsAgentHandlers } from './elevenlabs-agent-ipc'
import { isLiveCallOpen, registerLiveVoiceIpc, sendLiveProgress } from './live-voice-ipc'
import { startAdamIdleTidy, withAdamActivity } from './adam-idle-tidy'
import { createRuntimeQuickHands, type QuickHandsRuntime } from './live-voice-quick-hands-runtime'
import { adamConductor } from './adam-conductor'
import { trackedQuickHands, type ConductorRuntime } from './adam-conductor-runtime'
import { startAdamConductor } from './adam-conductor-wiring'
import { startAdamSpeaksUp } from './adam-speaks-up-wiring'
import { registerBriefHandleIpc } from './adam-brief-handle-ipc'
import { setJarvisHostWindow, trustedLiveSender } from './jarvis-host-window'

export { forceEndLiveCallForTest, getActiveLiveSessionForTest } from './live-voice-ipc'
import { migrateElevenLabsKeyOutOfSettings } from './elevenlabs-key-store'
import { registerElevenLabsKeyHandlers } from './elevenlabs-key-ipc'
import { registerSelfEditHandlers } from './self-edit-ipc'
import { pickJarvisTargetWindow } from './jarvis-target-window'
import { JARVIS_SHORTCUT_ACCELERATOR, getJarvisService } from './jarvis-service'
import { applyJarvisMode, restorePersistedMode, wireWakeWordObservation } from './jarvis-mode'
import type {
  JarvisBroadcastPort,
  JarvisService,
  JarvisServiceDeps,
  JarvisShortcutPort
} from './jarvis-service'
import { getUserDataRoot } from '../storage/user-data-root'
import { setAdamRuntimeAccess, type JarvisVoiceStatus } from './adam-runtime-access'

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
  // Why only the main window: the thread holds Carson's conversation, so it is never
  // sent to a web tile, a preview or any other window this app happens to have open.
  adamThread ??= new AdamThreadStore(join(getUserDataRoot(), 'adam-thread.json'), (rows) => {
    const host = jarvisHostWindow
    if (host && !host.isDestroyed()) {
      host.webContents.send(ADAM_THREAD_CHANNEL, rows)
    }
  })
  return adamThread
}

// Why kept here as well as sent: a window that opens mid-compaction asks for it.
let adamCompacting = false

function getAdamVoice(): AdamHermesVoice {
  if (!adamVoice) {
    adamVoice = new AdamHermesVoice({
      sessionFile: join(getUserDataRoot(), 'adam-voice-session.json'),
      onProgress: sendLiveProgress,
      onCompacting: (compacting) => {
        adamCompacting = compacting
        const host = jarvisHostWindow
        if (host && !host.isDestroyed()) {
          host.webContents.send(ADAM_STATUS_CHANNEL, { compacting })
        }
      },
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
// Why once: the taps, stale alerts and morning brief outlive a recreated main window.
let adamSpeaksUp: ReturnType<typeof startAdamSpeaksUp> | null = null

/**
 * The single entry point to ADAM for every caller in main (voice turns, the
 * Board thread, a future live voice engine). One Hermes session, one turn at a
 * time, and every turn is sent to the window so it lands in the Board thread.
 */
export function askAdam(text: string, options: AdamAskOptions): ReturnType<AdamConversation['ask']> {
  if (!adamConversation) {
    const broadcast = createBroadcastPort()
    adamConversation = new AdamConversation(
      {
        ask: (prompt) => withAdamActivity(() => getAdamVoice().ask(prompt)),
        isCompacting: () => adamCompacting
      },
      async (event) => {
        // Spoken turns are in the thread before any window hears of the turn.
        const row = voiceTurnRow(event)
        if (row) {
          await getAdamThread()
            .append(row)
            .catch((error) => {
              console.warn('ADAM voice turn could not be saved:', error)
              // No window asked for this write, so main tells the window itself.
              const host = jarvisHostWindow
              if (host && !host.isDestroyed()) {
                host.webContents.send(ADAM_THREAD_UNSAVED_CHANNEL)
              }
            })
        }
        broadcast(ADAM_TURN_CHANNEL, event)
      },
      () => adamConductor()?.takeContext() ?? []
    )
  }
  return adamConversation.ask(text, options)
}

/** True while ADAM is answering any turn (voice, live call, Board or CLI). */
export function isAdamBusy(): boolean {
  return adamConversation?.isBusy() ?? false
}

/** What the window's voice indicator reads (`jarvis:status`). */
function jarvisStatusOf(service: JarvisService): JarvisVoiceStatus {
  return { shortcutActive: service.isShortcutActive(), phase: service.getPhase() }
}

/** Hands the runtime RPC (`dobius adam ...`) the very same ADAM and voice service. */
function publishAdamRuntimeAccess(store: Store, service: JarvisService): void {
  setAdamRuntimeAccess({
    ask: askAdam,
    isBusy: isAdamBusy,
    voice: {
      status: () => jarvisStatusOf(service),
      setMode: (active) => applyJarvisMode(store, service, active),
      speak: (text) => service.speak(text)
    }
  })
}

// Conversation first: a turn still saving its asked row has no brain call yet.
const cancelAdamTurn = (): void => void (adamConversation?.cancel(), adamVoice?.cancel())

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
    // Why the whole turn, not only the voice: a stop must also drop a waiting thread message.
    cancelAgent: cancelAdamTurn,
    lookingAt: () => lastLookingAt
  }
}

export function registerJarvisIpcHandlers(
  store: Store,
  mainWindow: BrowserWindow,
  runtime?: QuickHandsRuntime & ConductorRuntime
): void {
  jarvisHostWindow = mainWindow
  setJarvisHostWindow(mainWindow)
  // Why (#24): move a plaintext settings key into the protected store before
  // any handler reads it. Failure leaves it in settings, so it still works.
  migrateElevenLabsKeyOutOfSettings(store)
  const service = getJarvisService(createJarvisDeps(store))
  publishAdamRuntimeAccess(store, service)
  registerHandlers(store, service)
  registerElevenLabsKeyHandlers(store, (event) => trustedLiveSender(event) !== null)
  registerLiveVoiceIpc(store, {
    trustedSender: trustedLiveSender,
    askAdam,
    isAdamBusy,
    cancelAdam: cancelAdamTurn,
    lookingAt: () => lastLookingAt,
    thread: getAdamThread,
    quickHands: runtime ? trackedQuickHands(createRuntimeQuickHands(() => runtime), adamConductor) : undefined,
    conductorJobs: async () => (await adamConductor()?.jobs()) ?? []
  })
  startAdamIdleTidy({
    busy: () => isAdamBusy() || isLiveCallOpen(),
    contextPercent: () => adamVoice?.contextPercent ?? null,
    tidy: () => adamVoice?.tidy() ?? Promise.resolve(false)
  })
  // Why once: the main window is recreated on macOS re-activation, and the
  // terminals ADAM is waiting on must stay tracked across that.
  adamSpeaksUp ??= startAdamSpeaksUp(store, getAdamThread, { ask: askAdam, isBusy: isAdamBusy }, runtime)
  if (runtime && !adamConductor()) {
    startAdamConductor(store, runtime, getAdamThread, (notice) => adamSpeaksUp?.overnight.record(notice))
  }
  wireWakeWordObservation(store, service)
  restorePersistedMode(store, service)
}



/** `not-saved`: the change is shown and kept in memory, but could not be written to disk. */
async function saved(change: Promise<void>): Promise<{ ok: boolean; error?: 'not-saved' }> {
  try {
    await change
    return { ok: true }
  } catch (error) {
    console.warn('ADAM thread could not be saved:', error)
    return { ok: false, error: 'not-saved' }
  }
}

// Why: a turn with ADAM can run commands and is written into Carson's thread,
// so only the main window's top frame may start one (never a web tile or embedded page).
const ADAM_UNTRUSTED_SENDER: JarvisAskResult = {
  kind: 'error',
  text: 'ADAM only takes messages from the main Dobius+ window.'
}

function registerHandlers(store: Store, service: JarvisService): void {
  ipcMain.removeHandler('jarvis:setMode')
  ipcMain.handle('jarvis:setMode', (_event, active: unknown) =>
    applyJarvisMode(store, service, active === true)
  )

  ipcMain.removeHandler('jarvis:ask')
  ipcMain.handle('jarvis:ask', (event, utterance: string, lookingAt?: unknown) =>
    trustedLiveSender(event) ? service.ask(utterance, lookingAtOf(lookingAt)) : ADAM_UNTRUSTED_SENDER
  )

  // ADAM's thread lives in main so every window shows the same rows and none can overwrite another's.
  ipcMain.removeHandler('jarvis:adamThreadGet')
  ipcMain.handle('jarvis:adamThreadGet', (event) =>
    trustedLiveSender(event) ? getAdamThread().get() : []
  )
  ipcMain.removeHandler('jarvis:adamStatusGet')
  ipcMain.handle('jarvis:adamStatusGet', (event) => ({
    compacting: trustedLiveSender(event) ? adamCompacting : false
  }))
  ipcMain.removeHandler('jarvis:adamThreadAppend')
  ipcMain.handle('jarvis:adamThreadAppend', async (event, raw: unknown) => {
    const row = trustedLiveSender(event) ? adamThreadRowOf(raw) : null
    if (!row) {
      return { ok: false }
    }
    return saved(getAdamThread().append(row))
  })
  ipcMain.removeHandler('jarvis:adamThreadClear')
  ipcMain.handle('jarvis:adamThreadClear', async (event) => {
    if (!trustedLiveSender(event)) {
      return { ok: false }
    }
    return saved(getAdamThread().clear())
  })
  ipcMain.removeHandler('jarvis:lookingAt')
  ipcMain.handle('jarvis:lookingAt', (event, raw: unknown) => {
    if (trustedLiveSender(event)) {
      lastLookingAt = lookingAtOf(raw)
    }
  })

  ipcMain.removeHandler('jarvis:cancelAsk')
  ipcMain.handle('jarvis:cancelAsk', (event) => {
    // Why: stopping ADAM mid-turn is the main window's call, never an embedded page's.
    if (trustedLiveSender(event)) {
      service.cancelAsk()
    }
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

  registerElevenLabsAgentHandlers(store)
  registerSelfEditHandlers((event) => trustedLiveSender(event) !== null)
  registerBriefHandleIpc((event) => trustedLiveSender(event) !== null)

  ipcMain.removeHandler('jarvis:status')
  ipcMain.handle('jarvis:status', () => jarvisStatusOf(service))

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
