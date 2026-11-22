import { ipcMain } from 'electron'
import { join } from 'node:path'
import { OPENAI_LIVE_CALL_READY, resolveLiveVoiceSettings } from '../../shared/live-voice-settings'
import type { AdamLookingAt, OpenAiLiveSessionResult } from '../../shared/speech-types'
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
    appendThread: (row) => deps.thread().append(row),
    forceEnd: forceEndLiveCall
  })
  return liveCalls
}

// Why one at a time: every created session starts billing, so a double click
// or a retry loop in the window must not open several at once. Taken before
// the first await of a connect, released when it settles.
let liveSessionInFlight = false

/**
 * Ends the owning window's call without its help (it ignored the cap).
 * Why reload: there is no documented call to close a Live session, and the
 * WebRTC peer lives in the page, so ending the page ends the peer. A page
 * too stuck to reload is crashed on the next try. The watchers below then
 * clear the call and stop the meter.
 */
function forceEndLiveCall(attempt: number): void {
  const owner = activeLiveSession?.owner
  if (!owner || owner.isDestroyed()) {
    return
  }
  if (attempt === 1) {
    owner.reload()
  } else {
    owner.forcefullyCrashRenderer()
  }
}

export function forceEndLiveCallForTest(attempt: number): void {
  forceEndLiveCall(attempt)
}

/**
 * Calls `onGone` once when the window's page goes away: closed, crashed, or
 * reloaded / navigated (a reload keeps the same WebContents, so 'destroyed'
 * alone would leave a paid call owned by a page that no longer exists).
 * Returns the unsubscribe.
 */
function watchOwnerGone(owner: LiveSender, onGone: () => void): () => void {
  const onNavigate = (details: { isMainFrame?: boolean; isSameDocument?: boolean }): void => {
    if (details?.isMainFrame !== false && details?.isSameDocument !== true) {
      onGone()
    }
  }
  const navigate = onNavigate as unknown as (...args: unknown[]) => void
  owner.once('destroyed', onGone)
  owner.once('render-process-gone', onGone)
  owner.on('did-start-navigation', navigate)
  return () => {
    owner.removeListener('destroyed', onGone)
    owner.removeListener('render-process-gone', onGone)
    owner.removeListener('did-start-navigation', navigate)
  }
}

/**
 * The live session a window currently owns, with the one set of owner
 * listeners, so a new owner replaces them and never stacks them.
 */
let activeLiveSession: {
  owner: LiveSender
  ownerId: number
  sessionId: string | null
  callToken: string
  unwatch: () => void
} | null = null

function clearActiveLiveSession(): void {
  const current = activeLiveSession
  activeLiveSession = null
  current?.unwatch()
  // Why here: every way a call ends (hang-up, a new call, the window
  // closing) stops the meter and drops ADAM's work for it.
  if (current) {
    liveCalls?.callEnded(current.ownerId)
  }
}

function setActiveLiveSession(owner: LiveSender, sessionId: string | null, callToken: string): void {
  clearActiveLiveSession()
  const unwatch = watchOwnerGone(owner, () => {
    if (activeLiveSession?.owner === owner) {
      clearActiveLiveSession()
    }
  })
  activeLiveSession = { owner, ownerId: owner.id, sessionId, callToken, unwatch }
}

export function getActiveLiveSessionForTest(): {
  ownerId: number
  sessionId: string | null
} | null {
  return activeLiveSession
    ? { ownerId: activeLiveSession.ownerId, sessionId: activeLiveSession.sessionId }
    : null
}

/**
 * Creates the session for a connect that holds the lock. The setup charge
 * is saved first; a page that goes away meanwhile aborts the create.
 */
async function connectLiveSession(
  store: Store,
  deps: LiveVoiceIpcDeps,
  calls: LiveVoiceCalls,
  sender: LiveSender,
  offerSdp: unknown
): Promise<OpenAiLiveSessionResult> {
  const refused = calls.reserveStart()
  if (refused) {
    return refused
  }
  const controller = new AbortController()
  const unwatch = watchOwnerGone(sender, () => controller.abort())
  try {
    const options = await liveSessionOptions(store, deps)
    // Why re-check: the page may have closed or reloaded while the thread was read.
    if (controller.signal.aborted || sender.isDestroyed()) {
      calls.setupFailed('not-allowed')
      return liveVoiceFailure('cancelled')
    }
    // createOpenAiLiveSession validates the offer itself and reads the key.
    const result = await createOpenAiLiveSession(offerSdp, options, { signal: controller.signal })
    if (!result.ok) {
      calls.setupFailed(result.kind)
      return result
    }
    if (controller.signal.aborted || sender.isDestroyed()) {
      // A session exists, but its page is gone; its peer cannot connect. The
      // setup charge stays counted.
      calls.setupFailed('cancelled')
      return liveVoiceFailure('cancelled')
    }
    const callToken = calls.callStarted(sender.id)
    setActiveLiveSession(sender, result.sessionId, callToken)
    calls.tick()
    return { ...result, callToken }
  } catch (error) {
    calls.setupFailed('network')
    throw error
  } finally {
    unwatch()
  }
}

/**
 * The live call's owner id when this sender is the trusted window that owns
 * it AND the message carries the token of the current call, so a late
 * message from an earlier call never touches the one that replaced it.
 */
function liveOwnerId(
  deps: LiveVoiceIpcDeps,
  event: Electron.IpcMainInvokeEvent,
  payload: unknown
): number | null {
  const sender = deps.trustedSender(event)
  const token =
    payload && typeof payload === 'object' ? (payload as { callToken?: unknown }).callToken : null
  return sender &&
    activeLiveSession?.owner === sender &&
    typeof token === 'string' &&
    token === activeLiveSession.callToken
    ? activeLiveSession.ownerId
    : null
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
    // Why refuse while any call is open, even the owner's: replacing it here
    // would stop its meter while its session may still bill. The window
    // reports 'closed' before it reconnects; a page that went away is
    // cleared by the watchers.
    if (liveSessionInFlight || activeLiveSession) {
      return liveVoiceFailure('busy')
    }
    const offerSdp =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as { offerSdp?: unknown }).offerSdp
        : undefined
    liveSessionInFlight = true
    try {
      return await connectLiveSession(store, deps, calls, sender, offerSdp)
    } finally {
      liveSessionInFlight = false
    }
  })

  ipcMain.removeHandler('jarvis:liveSessionReport')
  ipcMain.handle('jarvis:liveSessionReport', (event, report: unknown) => {
    const ownerId = liveOwnerId(deps, event, report)
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
    const ownerId = liveOwnerId(deps, event, payload)
    return ownerId === null
      ? { ok: false, error: 'No live call is open in this window.' }
      : calls.delegate(ownerId, payload)
  })

  ipcMain.removeHandler('jarvis:liveCancel')
  ipcMain.handle('jarvis:liveCancel', (event, payload: unknown) => {
    const ownerId = liveOwnerId(deps, event, payload)
    return { ok: ownerId !== null && calls.cancelDelegation(ownerId) }
  })

  ipcMain.removeHandler('jarvis:liveTranscript')
  ipcMain.handle('jarvis:liveTranscript', async (event, payload: unknown) => {
    const ownerId = liveOwnerId(deps, event, payload)
    return { ok: ownerId !== null && (await calls.recordTranscript(ownerId, payload)) }
  })

  // Why no connection-test handler: the only way to test the Live API is to
  // create a session, which bills, and the design doc documents no call to
  // close one. Settings keeps its test button disabled until that exists.
  ipcMain.removeHandler('jarvis:liveSessionTest')
}
