// Starts ADAM's conductor in main: its notices go to his thread (no Hermes
// turn) and, on a live call, to the window to be said out loud.
import { randomUUID } from 'node:crypto'
import { agentHookServer } from '../agent-hooks/server'
import type { Store } from '../persistence'
import { conductorSpeech } from '../../shared/conductor-speech'
import { AdamConductor, adamConductor, setAdamConductor } from './adam-conductor'
import type { ConductorNotice, ConductorProgress } from './adam-conductor-types'
import { createRuntimeConductorDeps, type ConductorRuntime } from './adam-conductor-runtime'
import type { AdamThreadStore } from './adam-thread-store'
import { sendLiveReport } from './live-voice-ipc'

/** The settings; each on unless Carson turned it off. */
function conductorEnabled(store: Store): boolean {
  return store.getSettings().voice?.adamReportsFinishedWork !== false
}

function progressEnabled(store: Store): boolean {
  return store.getSettings().voice?.adamProgressUpdates !== false
}

/**
 * A conductor notice: always a row in ADAM's thread (no Hermes turn), and
 * said out loud when a live call is open. The row may quote the agent for
 * Carson to read; it is marked `conductor` and kept out of every model's
 * input (live-voice-prompt.ts). Only the template line goes to the voice.
 */
function reportToCarson(notice: ConductorNotice, thread: () => AdamThreadStore): void {
  const row = { id: `conductor:${randomUUID()}`, role: 'assistant' as const, text: notice.display }
  void thread()
    .append({ ...row, conductor: true })
    .catch((error) => console.warn('ADAM conductor row could not be saved:', error))
  sendLiveReport({ kind: 'report', text: notice.spoken, event: notice.event, name: notice.name })
}

/** A progress line: voice only (a live call), never a thread row. */
function progressToCarson(update: ConductorProgress): void {
  sendLiveReport({
    kind: 'report',
    text: conductorSpeech([update]),
    event: update.event,
    name: update.name,
    ...(update.minutes === undefined ? {} : { minutes: update.minutes })
  })
}

export function startAdamConductor(
  store: Store,
  runtime: ConductorRuntime,
  thread: () => AdamThreadStore
): void {
  setAdamConductor(
    new AdamConductor({
      ...createRuntimeConductorDeps(() => runtime),
      report: (notice) => reportToCarson(notice, thread),
      progress: progressToCarson,
      progressEnabled: () => progressEnabled(store),
      cleared: () => void sendLiveReport({ kind: 'reports-cleared', text: '' }),
      enabled: () => conductorEnabled(store)
    })
  )
  // Why at once: switched off mid-call, nothing queued may still be said or handed to ADAM.
  store.onSettingsChanged((_updates, settings) => {
    if (settings.voice?.adamReportsFinishedWork === false) {
      adamConductor()?.clear()
    } else if (settings.voice?.adamProgressUpdates === false) {
      sendLiveReport({ kind: 'reports-cleared', text: '', only: 'progress' })
    }
  })
  // Why: a hook fires the moment an agent starts or stops, so a short task
  // between two polls is still seen.
  agentHookServer.subscribeStatusChanges(() => adamConductor()?.poke())
}
