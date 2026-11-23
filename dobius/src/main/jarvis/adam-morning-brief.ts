// The morning brief (build plan 7.16): once a day at Carson's chosen time
// (default 7:00), Dobius+ asks ADAM for a short brief and texts it to Carson's
// own iMessage handle. Also always a thread row and a Mac notification.
// Scheduling: due from the brief time until MORNING_BRIEF_CATCH_UP_MINUTES
// later (a Mac asleep at 7:00 gets it on wake before 11:00), at most once per
// local day; the day is saved before ADAM is asked, so a restart never repeats it.
import {
  MORNING_BRIEF_CATCH_UP_MINUTES,
  clockTimeText,
  type ClockTime
} from '../../shared/adam-speaks-up'
import type { AdamThreadRow, JarvisAskResult } from '../../shared/speech-types'
import {
  ADAM_BUSY_TEXT,
  ADAM_COMPACTING_TEXT,
  type AdamAskOptions
} from './adam-conversation'
import { clip } from './adam-conductor-text'
import {
  briefText,
  localDateKey,
  morningBriefPrompt,
  type BriefFacts
} from './adam-morning-brief-facts'
import { looksSecret } from './live-voice-terminal-text'

export type MorningBriefImessage = {
  /** Null when a text can be sent; else why not (not set up, turned off). */
  unavailableReason: () => string | null
  send: (text: string) => Promise<void>
}

export type MorningBriefDeps = {
  settings: () => { enabled: boolean; time: ClockTime }
  lastRunDate: () => string | null
  /** Saves the day; false when it could not be saved (then the brief waits). */
  setLastRunDate: (date: string | null) => boolean
  isBusy: () => boolean
  ask: (prompt: string, options: AdamAskOptions) => Promise<JarvisAskResult>
  facts: (now: Date) => Promise<BriefFacts>
  imessage: () => MorningBriefImessage
  appendThread: (row: AdamThreadRow) => Promise<void>
  showNotification: (title: string, body: string) => void
  now?: () => Date
}

/** True when the brief should run now: in its window today and not yet run today. */
export function morningBriefDue(now: Date, time: ClockTime, lastRunDate: string | null): boolean {
  if (lastRunDate === localDateKey(now)) {
    return false
  }
  const minute = now.getHours() * 60 + now.getMinutes()
  const start = time.hour * 60 + time.minute
  return minute >= start && minute < Math.min(start + MORNING_BRIEF_CATCH_UP_MINUTES, 24 * 60)
}

const NOTIFY_BODY_MAX_CHARS = 240
const ERROR_MAX_CHARS = 160

export type MorningBriefOutcome = 'not-due' | 'busy' | 'sent' | 'not-texted' | 'failed'

export class AdamMorningBrief {
  private running = false
  private readonly now: () => Date

  constructor(private readonly deps: MorningBriefDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  /** Runs the brief if it is due; safe to call as often as wanted (timer, wake, start). */
  async tick(): Promise<MorningBriefOutcome> {
    const now = this.now()
    const settings = this.deps.settings()
    if (
      this.running ||
      !settings.enabled ||
      !morningBriefDue(now, settings.time, this.deps.lastRunDate())
    ) {
      return 'not-due'
    }
    // Why wait instead of claiming: a turn in progress would refuse the ask.
    if (this.deps.isBusy()) {
      return 'busy'
    }
    const previous = this.deps.lastRunDate()
    const today = localDateKey(now)
    if (!this.deps.setLastRunDate(today)) {
      return 'not-due'
    }
    this.running = true
    try {
      return await this.run(now, today, previous)
    } finally {
      this.running = false
    }
  }

  private async run(now: Date, today: string, previous: string | null): Promise<MorningBriefOutcome> {
    const facts = await this.deps.facts(now)
    const result = await this.deps
      .ask(morningBriefPrompt(facts), {
        source: 'schedule',
        said: `Morning brief (scheduled for ${clockTimeText(this.deps.settings().time)})`
      })
      .catch((): JarvisAskResult => ({ kind: 'error', text: 'ADAM is unreachable' }))
    if (result.kind === 'error' && (result.text === ADAM_BUSY_TEXT || result.text === ADAM_COMPACTING_TEXT)) {
      // ADAM became busy after the check: give the day back so the next tick tries again.
      this.deps.setLastRunDate(previous)
      return 'busy'
    }
    const reply = result.kind === 'answer' || result.kind === 'job' ? briefText(result.text) : ''
    if (!reply) {
      await this.row(today, 'The morning brief could not be written: ADAM did not answer.', true)
      this.deps.showNotification('ADAM', 'The morning brief could not be written. Open Dobius+ for details.')
      return 'failed'
    }
    const texted = await this.text(reply)
    const left = leftOut(facts)
    await this.row(today, [`Morning brief: ${texted.status}`, ...left].join(' '), !texted.ok)
    this.deps.showNotification('ADAM', clip(reply.replace(/\n/g, ' · '), NOTIFY_BODY_MAX_CHARS))
    return texted.ok ? 'sent' : 'not-texted'
  }

  private async text(brief: string): Promise<{ ok: boolean; status: string }> {
    if (looksSecret(brief)) {
      return { ok: false, status: 'not texted, because it looked like it held a secret.' }
    }
    const imessage = this.deps.imessage()
    const unavailable = imessage.unavailableReason()
    if (unavailable) {
      return { ok: false, status: `not texted (${clip(unavailable, ERROR_MAX_CHARS)}).` }
    }
    try {
      await imessage.send(brief)
      return { ok: true, status: 'texted to your phone.' }
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error)
      return { ok: false, status: `the text could not be sent (${clip(why, ERROR_MAX_CHARS)}).` }
    }
  }

  private async row(today: string, text: string, problem: boolean): Promise<void> {
    await this.deps
      .appendThread({
        id: `morning-brief:${today}`,
        role: 'system',
        text,
        morningBrief: true,
        ...(problem ? { tone: 'error' } : {})
      })
      .catch((error: unknown) => console.warn('Morning brief row could not be saved:', error))
  }
}

/** One short sentence per source that was left out of the brief. */
function leftOut(facts: BriefFacts): string[] {
  return [
    ...(facts.calendar.available ? [] : [`Calendar left out: ${facts.calendar.reason}.`]),
    ...(facts.asana.available ? [] : [`Asana left out: ${facts.asana.reason}.`])
  ]
}
