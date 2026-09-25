import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron'
import { join } from 'node:path'
import { getDefaultVoiceSettings } from '../../shared/constants'
import type { VoiceSettings } from '../../shared/speech-types'
import type { Store } from '../persistence'
import { getSpeechSttService } from '../speech/speech-runtime-service'
import { adamProjectDirectory } from '../adam-connection'
import { askAdam } from './adam-client'
import { buildAgentContext, buildOpeningLine, runDobiusCommand } from './agent-context'
import { SelfEditStore, selfEditRoots } from './self-edit'
import { resolveSelfEditRepoRoot } from './self-edit-repo-root'
import { closeSelfEditWindow, showSelfEditProposal } from '../window/self-edit-window'
import { fetchAgentSignedUrl } from './elevenlabs-agent'
import {
  clearElevenLabsApiKey,
  dropLegacyElevenLabsKeyFromSettings,
  getElevenLabsApiKeyStatus,
  migrateElevenLabsKeyOutOfSettings,
  resolveElevenLabsApiKey,
  saveElevenLabsApiKey,
  type ElevenLabsApiKeyStatus
} from './elevenlabs-key-store'
import {
  fetchRecentConversationSummaries,
  formatConversationMemory
} from './conversation-memory'
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

export function registerJarvisIpcHandlers(store: Store, mainWindow: BrowserWindow): void {
  jarvisHostWindow = mainWindow
  // Why (#24): move a plaintext settings key into the protected store before
  // any handler reads it. Failure leaves it in settings, so it still works.
  migrateElevenLabsKeyOutOfSettings(store)
  const service = getJarvisService(createJarvisDeps(store))
  registerHandlers(store, service)
  registerElevenLabsKeyHandlers(store)
  wireWakeWordObservation(store, service)
  restorePersistedMode(store, service)
}

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
function registerElevenLabsKeyHandlers(store: Store): void {
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
    buildAgentContext(join(app.getPath('userData'), 'terminal-history'))
  )

  const repoRoot = resolveSelfEditRepoRoot({
    isPackaged: app.isPackaged,
    env: process.env,
    home: app.getPath('home'),
    resourcesPath: process.resourcesPath
  })
  const selfEdits = repoRoot.ok
    ? new SelfEditStore(selfEditRoots(app.getPath('home'), repoRoot.root))
    : new SelfEditStore([], Date.now, repoRoot.error)
  const selfEditBackups = join(app.getPath('userData'), 'self-edit-backups')

  ipcMain.removeHandler('jarvis:proposeSelfEdit')
  ipcMain.handle(
    'jarvis:proposeSelfEdit',
    (_event, path: string, content: string, description: string) => {
      const result = selfEdits.propose(String(path ?? ''), String(content ?? ''), String(description ?? ''))
      if (!result.ok) {
        return result
      }
      showSelfEditProposal(result.proposal)
      return { ok: true, id: result.proposal.id, displayPath: result.proposal.displayPath }
    }
  )

  ipcMain.removeHandler('jarvis:applySelfEdit')
  ipcMain.handle('jarvis:applySelfEdit', (_event, id: string) => {
    const result = selfEdits.apply(String(id ?? ''), selfEditBackups)
    if (result.ok) {
      closeSelfEditWindow()
    }
    return result
  })

  // Why no window: undo is asked for by voice after the review window closed.
  ipcMain.removeHandler('jarvis:undoSelfEdit')
  ipcMain.handle('jarvis:undoSelfEdit', (_event, id: string) =>
    selfEdits.undo(String(id ?? ''))
  )

  ipcMain.removeHandler('jarvis:discardSelfEdit')
  ipcMain.handle('jarvis:discardSelfEdit', (_event, id: string) => {
    const discarded = selfEdits.discard(String(id ?? ''))
    closeSelfEditWindow()
    return { ok: discarded }
  })

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
    buildOpeningLine(join(app.getPath('userData'), 'terminal-history'))
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
  ipcMain.handle('jarvis:askAdamText', async (_event, utterance: string) => {
    const result = await askAdam({
      settingsEndpoint: store.getSettings().voice?.adamEndpoint,
      utterance: typeof utterance === 'string' ? utterance : ''
    })
    return result
  })
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
