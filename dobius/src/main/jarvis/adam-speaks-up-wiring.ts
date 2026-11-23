// Starts "ADAM speaks up" in main (build plan 7.16): ADAM's own taps
// (`dobius adam notify`), the stale alerts and the daily morning brief.
import { app, BrowserWindow, Notification, powerMonitor } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { resolveSpeaksUpSettings } from '../../shared/adam-speaks-up'
import type { JarvisAskResult } from '../../shared/speech-types'
import { getAsanaSnapshot, refreshAsanaTasks } from '../asana/asana-queue-service'
import { hasAsanaToken } from '../asana/asana-token-store'
import { getImessageBridgeConfig } from '../imessage-bridge/bridge-config'
import type { Store } from '../persistence'
import { SafeJsonFile } from '../storage/safe-json-file'
import { getUserDataRoot } from '../storage/user-data-root'
import { conductorImessageHandle } from '../voice-conductor/conductor-settings'
import { createIMessageBridge } from '../voice-conductor/imessage-bridge'
import { adamConductor } from './adam-conductor'
import { createRuntimeConductorDeps, type ConductorRuntime } from './adam-conductor-runtime'
import type { AdamAskOptions } from './adam-conversation'
import {
  asanaDueTasks,
  localDateKey,
  OvernightLog,
  type BriefFacts
} from './adam-morning-brief-facts'
import { AdamMorningBrief, type MorningBriefImessage } from './adam-morning-brief'
import { AdamNotifier, setAdamNotifier } from './adam-notify'
import { AdamStaleWatch, type StaleAlert } from './adam-stale-watch'
import type { AdamThreadStore } from './adam-thread-store'
import { sendLiveReport } from './live-voice-ipc'

const STALE_CHECK_MS = 30_000
const BRIEF_CHECK_MS = 60_000
// Why a pause after waking: Wi-Fi and Hermes need a moment before ADAM can answer.
const AFTER_WAKE_MS = 20_000
const ASANA_TIMEOUT_MS = 20_000
const OVERNIGHT_MS = 16 * 60 * 60_000

export type SpeaksUpAdam = {
  ask: (text: string, options: AdamAskOptions) => Promise<JarvisAskResult>
  isBusy: () => boolean
}

/** A Mac notification that brings Dobius+ forward when clicked. */
export function showAdamNotification(title: string, body: string): void {
  if (!Notification.isSupported()) {
    return
  }
  const notification = new Notification({ title, body })
  notification.on('click', () => {
    const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
    if (process.platform === 'darwin') {
      app.focus({ steal: true })
    }
    if (win) {
      if (win.isMinimized()) {
        win.restore()
      }
      win.show()
      win.focus()
    }
  })
  notification.show()
}

function unref(timer: ReturnType<typeof setInterval>): void {
  ;(timer as { unref?: () => void }).unref?.()
}

/** Stale alerts reach Carson like conductor notices, plus a notification when no call is open. */
function staleToCarson(alert: StaleAlert, thread: () => AdamThreadStore): void {
  const row = { id: `conductor:${randomUUID()}`, role: 'assistant' as const, text: alert.display }
  void thread()
    .append({ ...row, conductor: true, stale: alert.condition })
    .catch((error) => console.warn('ADAM stale alert row could not be saved:', error))
  const spoken = sendLiveReport({
    kind: 'report',
    text: alert.spoken,
    event: alert.event,
    name: alert.name,
    minutes: alert.minutes
  })
  if (!spoken) {
    showAdamNotification('ADAM', alert.spoken)
  }
}

const lastRunFile = new SafeJsonFile<{ lastRunDate: string | null }>({
  filePath: () => join(getUserDataRoot(), 'adam-morning-brief.json'),
  parse: (raw) => {
    const date = (raw as { lastRunDate?: unknown } | null)?.lastRunDate
    return date === null || (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))
      ? { lastRunDate: date }
      : undefined
  },
  fallback: () => ({ lastRunDate: null }),
  label: '[adam] adam-morning-brief.json'
})

function briefImessage(): MorningBriefImessage {
  const bridge = createIMessageBridge({ resolveHandle: conductorImessageHandle })
  return {
    unavailableReason: () =>
      getImessageBridgeConfig().enabled
        ? bridge.unavailableReason()
        : 'the iMessage bridge is turned off in Settings',
    send: (text) => bridge.send(text)
  }
}

async function asanaFacts(today: string): Promise<BriefFacts['asana']> {
  if (!hasAsanaToken()) {
    return { available: false, reason: 'Asana is not connected in Dobius+' }
  }
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), ASANA_TIMEOUT_MS))
  const snapshot =
    (await Promise.race([refreshAsanaTasks().catch(() => null), timeout])) ?? getAsanaSnapshot()
  if (snapshot.lastSync === null) {
    return { available: false, reason: 'Asana could not be read this morning' }
  }
  return { available: true, items: asanaDueTasks(snapshot.build, snapshot.localDone, today) }
}

export function startAdamSpeaksUp(
  store: Store,
  thread: () => AdamThreadStore,
  adam: SpeaksUpAdam,
  runtime?: ConductorRuntime
): { overnight: OvernightLog } {
  const settings = (): ReturnType<typeof resolveSpeaksUpSettings> =>
    resolveSpeaksUpSettings(store.getSettings().voice)
  setAdamNotifier(
    new AdamNotifier({
      enabled: () => settings().tapOnShoulder,
      appendThread: (row) => thread().append(row),
      sayLive: (text, urgent) =>
        sendLiveReport({ kind: 'adam-says', text, ...(urgent ? { urgent: true } : {}) }),
      showNotification: showAdamNotification
    })
  )
  const conductorOn = (): boolean => store.getSettings().voice?.adamReportsFinishedWork !== false
  const runtimeDeps = runtime ? createRuntimeConductorDeps(() => runtime) : null
  const stale = runtimeDeps
    ? new AdamStaleWatch({
        jobs: () => adamConductor()?.staleJobs() ?? [],
        identify: runtimeDeps.identify,
        read: runtimeDeps.read,
        thresholds: settings,
        enabled: conductorOn,
        alert: (alert) => staleToCarson(alert, thread)
      })
    : null
  if (stale) {
    unref(setInterval(() => void stale.check().catch(() => undefined), STALE_CHECK_MS))
  }
  const overnight = new OvernightLog()
  const brief = new AdamMorningBrief({
    settings: () => ({ enabled: settings().morningBrief, time: settings().morningBriefTime }),
    lastRunDate: () => lastRunFile.get().lastRunDate,
    setLastRunDate: (date) => lastRunFile.set({ lastRunDate: date }),
    isBusy: adam.isBusy,
    ask: adam.ask,
    facts: async (now) => ({
      now,
      jobs: (await adamConductor()?.jobs().catch(() => [])) ?? [],
      stale: (await stale?.current().catch(() => [])) ?? [],
      overnight: overnight.since(now.getTime() - OVERNIGHT_MS),
      asana: await asanaFacts(localDateKey(now)).catch(() => ({
        available: false as const,
        reason: 'Asana could not be read this morning'
      })),
      calendar: { available: false, reason: 'Dobius+ has no calendar access' }
    }),
    imessage: briefImessage,
    appendThread: (row) => thread().append(row),
    showNotification: showAdamNotification
  })
  const tick = (): void =>
    void brief.tick().catch((error) => console.warn('Morning brief failed:', error))
  unref(setInterval(tick, BRIEF_CHECK_MS))
  // Why on wake too: an interval can lag after sleep; this catches up within seconds.
  for (const event of ['resume', 'unlock-screen'] as const) {
    powerMonitor.on(event as 'resume', () => setTimeout(tick, AFTER_WAKE_MS))
  }
  return { overnight }
}
