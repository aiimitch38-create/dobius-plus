// Starts ADAM's conductor in main: its notices go to his thread (no Hermes
// turn) and, on a live call, to the window to be said out loud.
import { randomUUID } from 'node:crypto'
import { agentHookServer } from '../agent-hooks/server'
import type { Store } from '../persistence'
import { AdamConductor, adamConductor, setAdamConductor, type ConductorNotice } from './adam-conductor'
import { createRuntimeConductorDeps, type ConductorRuntime } from './adam-conductor-runtime'
import type { AdamThreadStore } from './adam-thread-store'
import { sendLiveReport } from './live-voice-ipc'

/** The setting; on unless Carson turned it off. */
function conductorEnabled(store: Store): boolean {
  return store.getSettings().voice?.adamReportsFinishedWork !== false
}

/**
 * A conductor notice: always a row in ADAM's thread (no Hermes turn), and
 * said out loud when a live call is open. ADAM's brain hears it on his next turn.
 */
function reportToCarson(notice: ConductorNotice, thread: () => AdamThreadStore): void {
  const row = { id: `conductor:${randomUUID()}`, role: 'assistant' as const, text: notice.text }
  void thread()
    .append({ ...row, conductor: true })
    .catch((error) => console.warn('ADAM conductor row could not be saved:', error))
  sendLiveReport({ kind: 'report', text: notice.text, label: notice.label })
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
      cleared: () => void sendLiveReport({ kind: 'reports-cleared', text: '' }),
      enabled: () => conductorEnabled(store)
    })
  )
  // Why at once: switched off mid-call, nothing queued may still be said or handed to ADAM.
  store.onSettingsChanged((_updates, settings) => {
    if (settings.voice?.adamReportsFinishedWork === false) {
      adamConductor()?.clear()
    }
  })
  // Why: a hook fires the moment an agent starts or stops, so a short task
  // between two polls is still seen.
  agentHookServer.subscribeStatusChanges(() => adamConductor()?.poke())
}
