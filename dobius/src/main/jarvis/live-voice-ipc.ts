import { ipcMain } from 'electron'
import { join } from 'node:path'
import { OPENAI_LIVE_CALL_READY, resolveLiveVoiceSettings } from '../../shared/live-voice-settings'
import type { AdamLookingAt, OpenAiLiveFailure } from '../../shared/speech-types'
import type { Store } from '../persistence'
import { getUserDataRoot } from '../storage/user-data-root'
import type { AdamConversation } from './adam-conversation'
import type { AdamThreadStore } from './adam-thread-store'
import { LiveVoiceCalls } from './live-voice-calls'
import { LiveVoiceMeter } from './live-voice-meter'
import { buildLiveVoiceInstructions } from './live-voice-prompt'
import { createOpenAiLiveSession, liveVoiceFailure } from './openai-live-session'
import type { OpenAiLiveSessionOptions } from './openai-live-session'

type LiveSender = Electron.WebContents

/** What the live call needs from the rest of the Jarvis IPC module. */
export type LiveVoiceIpcDeps = {
  /** The main window's top frame, or null for any other sender. */
  trustedSender: (event: Electron.IpcMainInvokeEvent) => LiveSender | null
  askAdam: AdamConversation['ask']
  isAdamBusy: () => boolean
  cancelAdam: () => void
  lookingAt: () => AdamLookingAt | null
  thread: () => AdamThreadStore
}

async function liveSessionOptions(
  store: Store,
  deps: LiveVoiceIpcDeps
): Promise<OpenAiLiveSessionOptions> {
  // Why from the store, not the window: the window supplies only the offer, so
  // a compromised renderer cannot pick the voice or switch standby off.
  const live = resolveLiveVoiceSettings(store.getSettings().voice)
  // Why the thread: every new session, including a reconnect or a planned
  // recycle, starts already knowing what was just said.
  const recentThread = await deps
    .thread()
    .get()
    .catch(() => [])
  return {
    voice: live.voice,
    idleTimeoutSec: live.idleTimeoutSec,
    instructions: buildLiveVoiceInstructions({ recentThread, lookingAt: deps.lookingAt() })
  }
}

export const LIVE_NOTICE_CHANNEL = 'jarvis:live-notice'

let liveCalls: LiveVoiceCalls | null = null

function getLiveCalls(store: Store, deps: LiveVoiceIpcDeps): LiveVoiceCalls {
  liveCalls ??= new LiveVoiceCalls({
    // Why beside adam-voice-session.json: the same user-data folder, so the
    // dev build and the installed app each keep their own day total.
    meter: new LiveVoiceMeter(join(getUserDataRoot(), 'live-voice-meter.json')),
    capUsd: () => resolveLiveVoiceSettings(store.getSettings().voice).dailyCapUsd,
    notify: (notice) => {
      const owner = activeLiveSession?.owner
      if (owner && !owner.isDestroyed()) {
        owner.send(LIVE_NOTICE_CHANNEL, notice)
      }
    },
    ask: deps.askAdam,
    isAdamBusy: deps.isAdamBusy,
    cancelAdam: deps.cancelAdam,
    lookingAt: deps.lookingAt,
    appendThread: (row) => deps.thread().append(row)
  })
  return liveCalls
}

// Why one at a time: every created session starts billing, so a double click
// or a retry loop in the window must not open several at once.
let liveSessionInFlight = false

/**
 * The live session a window currently owns. Holds the one 'destroyed' listener
 * on the owner so a new owner or a repeat connect replaces it, never stacks it.
 */
let activeLiveSession: {
  owner: LiveSender
  ownerId: number
  sessionId: string | null
  onOwnerDestroyed: () => void
} | null = null

function clearActiveLiveSession(): void {
  const current = activeLiveSession
  activeLiveSession = null
  current?.owner.removeListener('destroyed', current.onOwnerDestroyed)
  // Why here: every way a call ends (hang-up, a new call, the window
  // closing) stops the meter and drops ADAM's work for it.
  if (current) {
    liveCalls?.callEnded(current.ownerId)
  }
}

function setActiveLiveSession(owner: LiveSender, sessionId: string | null): void {
  clearActiveLiveSession()
  const onOwnerDestroyed = (): void => {
    if (activeLiveSession?.owner === owner) {
      clearActiveLiveSession()
    }
  }
  owner.once('destroyed', onOwnerDestroyed)
  activeLiveSession = { owner, ownerId: owner.id, sessionId, onOwnerDestroyed }
}

export function getActiveLiveSessionForTest(): {
  ownerId: number
  sessionId: string | null
} | null {
  return activeLiveSession
    ? { ownerId: activeLiveSession.ownerId, sessionId: activeLiveSession.sessionId }
    : null
}

async function runLiveSessionOnce<T>(
  sender: LiveSender,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T | OpenAiLiveFailure> {
  if (liveSessionInFlight) {
    return liveVoiceFailure('busy')
  }
  liveSessionInFlight = true
  // Why: a create still in flight when its window closes would open a session
  // nobody can use or hang up, so the request is aborted with the window.
  const controller = new AbortController()
  const abort = (): void => controller.abort()
  sender.once('destroyed', abort)
  try {
    return await run(controller.signal)
  } finally {
    sender.removeListener('destroyed', abort)
    liveSessionInFlight = false
  }
}

/** The live call's owner id when this sender is the trusted window that owns it. */
function liveOwnerId(deps: LiveVoiceIpcDeps, event: Electron.IpcMainInvokeEvent): number | null {
  const sender = deps.trustedSender(event)
  return sender && activeLiveSession?.owner === sender ? activeLiveSession.ownerId : null
}

/** Registers every OpenAI Live IPC handler; the window owns audio, main owns the rest. */
export function registerLiveVoiceIpc(store: Store, deps: LiveVoiceIpcDeps): void {
  clearActiveLiveSession()
  const calls = getLiveCalls(store, deps)
  ipcMain.removeHandler('jarvis:liveSessionConnect')
  ipcMain.handle('jarvis:liveSessionConnect', async (event, payload: unknown) => {
    const sender = deps.trustedSender(event)
    if (!sender) {
      return liveVoiceFailure('not-allowed')
    }
    const live = resolveLiveVoiceSettings(store.getSettings().voice)
    if (live.engine !== 'openai-live' || !OPENAI_LIVE_CALL_READY) {
      return liveVoiceFailure('not-ready')
    }
    const refused = calls.refuseStart()
    if (refused) {
      return refused
    }
    const offerSdp =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as { offerSdp?: unknown }).offerSdp
        : undefined
    // createOpenAiLiveSession validates the offer itself and reads the key.
    const options = await liveSessionOptions(store, deps)
    // Why re-check: the window may have closed while the thread was read.
    if (sender.isDestroyed()) {
      return liveVoiceFailure('cancelled')
    }
    const result = await runLiveSessionOnce(sender, (signal) =>
      createOpenAiLiveSession(offerSdp, options, { signal })
    )
    if (result.ok && !sender.isDestroyed()) {
      setActiveLiveSession(sender, result.sessionId)
      calls.callStarted(sender.id)
    }
    return result
  })

  ipcMain.removeHandler('jarvis:liveSessionReport')
  ipcMain.handle('jarvis:liveSessionReport', (event, report: unknown) => {
    const ownerId = liveOwnerId(deps, event)
    if (ownerId === null) {
      return { ok: false }
    }
    const ok = calls.report(ownerId, report)
    if (ok && (report as { type?: unknown }).type === 'closed') {
      clearActiveLiveSession()
    }
    return { ok }
  })

  // Why main and not the window: the request reaches ADAM through askAdam,
  // the one path every voice and thread turn takes, so it lands in his
  // thread and his Hermes session like any other turn.
  ipcMain.removeHandler('jarvis:liveDelegate')
  ipcMain.handle('jarvis:liveDelegate', (event, payload: unknown) => {
    const ownerId = liveOwnerId(deps, event)
    return ownerId === null
      ? { ok: false, error: 'No live call is open in this window.' }
      : calls.delegate(ownerId, payload)
  })

  ipcMain.removeHandler('jarvis:liveCancel')
  ipcMain.handle('jarvis:liveCancel', (event) => {
    const ownerId = liveOwnerId(deps, event)
    return { ok: ownerId !== null && calls.cancelDelegation(ownerId) }
  })

  ipcMain.removeHandler('jarvis:liveTranscript')
  ipcMain.handle('jarvis:liveTranscript', async (event, payload: unknown) => {
    const ownerId = liveOwnerId(deps, event)
    return { ok: ownerId !== null && (await calls.recordTranscript(ownerId, payload)) }
  })

  // Why no connection-test handler: the only way to test the Live API is to
  // create a session, which bills, and the design doc documents no call to
  // close one. Settings keeps its test button disabled until that exists.
  ipcMain.removeHandler('jarvis:liveSessionTest')
}
