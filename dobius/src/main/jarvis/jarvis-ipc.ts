import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { join, resolve } from 'node:path'
import { getDefaultVoiceSettings } from '../../shared/constants'
import type { VoiceSettings } from '../../shared/speech-types'
import type { Store } from '../persistence'
import { getSpeechSttService } from '../speech/speech-runtime-service'
import { converseWithAdam, loadAdamServiceToken } from './adam-client'
import { buildAgentContext, buildOpeningLine, runDobiusCommand } from './agent-context'
import { SelfEditStore, selfEditRoots } from './self-edit'
import {
  closeSelfEditWindow,
  getSelfEditWindow,
  showSelfEditProposal
} from '../window/self-edit-window'
import { ShellCommandStore } from './shell-command-store'
import { adamPluginDir } from './shell-tool'
import { fetchAgentSignedUrl } from './elevenlabs-agent'
import {
  fetchRecentConversationSummaries,
  formatConversationMemory
} from './conversation-memory'
import { openFloatingOrbWindow } from '../window/floating-orb-window'
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

function createBroadcastPort(): JarvisBroadcastPort {
  return (channel, payload) => {
    const target = pickJarvisTargetWindow(
      BrowserWindow.getFocusedWindow(),
      BrowserWindow.getAllWindows()
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

  ipcMain.removeHandler('jarvis:openOrb')
  ipcMain.handle('jarvis:openOrb', () => openFloatingOrbWindow())

  // Live agent: the renderer owns the websocket (it has the mic and speakers),
  // main only mints the signed URL so the API key never leaves this process.
  // Why exposed: a refused ⌘T grab is otherwise invisible — the setting still
  // reads "on" while the shortcut belongs to another app.
  ipcMain.removeHandler('jarvis:agentContext')
  ipcMain.handle('jarvis:agentContext', () =>
    buildAgentContext(join(app.getPath('userData'), 'terminal-history'))
  )

  // Why app.getAppPath()/../..: the repo root is two levels above out/main in
  // dev and the asar root when packaged; resolving from the app path keeps the
  // editable root tied to THIS checkout rather than a hardcoded machine path.
  const selfEdits = new SelfEditStore(
    selfEditRoots(app.getPath('home'), resolve(app.getAppPath(), '..', '..'))
  )
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

  // Adam's shell tool. The agent's half (jarvis:proposeShell) is registered in
  // TASK-ADAM-1.3; these two are the REVIEW WINDOW's half and nothing else may
  // call them.
  const shellCommands = new ShellCommandStore({
    pluginDir: adamPluginDir(app.getPath('userData'))
  })

  /**
   * Invariant A: execution is never authorised by the model.
   *
   * The agent's client tools run in the main window's renderer. The Run button
   * lives in the review window, which is a different webContents. Comparing the
   * sender means that even if a client tool were added by mistake, and even if
   * it somehow learned a pending id, the call is refused — the guarantee does
   * not rest on remembering not to expose a tool.
   */
  const isReviewWindow = (event: IpcMainInvokeEvent): boolean => {
    const review = getSelfEditWindow()
    return review !== null && event.sender.id === review.webContents.id
  }

  ipcMain.removeHandler('jarvis:runApprovedShell')
  ipcMain.handle('jarvis:runApprovedShell', (event, id: string) => {
    if (!isReviewWindow(event)) {
      return { ok: false, error: 'Only the review window can run a command.' }
    }
    return shellCommands.runApproved(String(id ?? ''))
  })

  ipcMain.removeHandler('jarvis:discardShellCommand')
  ipcMain.handle('jarvis:discardShellCommand', (event, id: string) => {
    if (!isReviewWindow(event)) {
      return { ok: false }
    }
    const discarded = shellCommands.discard(String(id ?? ''))
    closeSelfEditWindow()
    return { ok: discarded }
  })

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
      voice?.elevenlabsApiKey ?? '',
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
    return fetchAgentSignedUrl(voice?.elevenlabsApiKey ?? '', voice?.elevenlabsAgentId ?? '')
  })

  // Why a text-only ask: during a live conversation the AGENT speaks, so
  // service.ask() would talk over it with a second voice.
  ipcMain.removeHandler('jarvis:askAdamText')
  ipcMain.handle('jarvis:askAdamText', async (_event, utterance: string) => {
    const result = await converseWithAdam({
      endpoint: store.getSettings().voice?.adamEndpoint,
      token: loadAdamServiceToken(),
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
  // If the grab now conflicts with another app, fall back to off so the stored
  // flag matches what the user actually gets after relaunch.
  if (!service.toggle(true)) {
    persistVoicePatch(store, { jarvisEnabled: false })
  }
}
