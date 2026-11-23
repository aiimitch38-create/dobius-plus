// `dobius adam notify` (build plan 7.16): ADAM taps Carson on the shoulder in
// his own words. ADAM is trusted (Carson wrote his rules), so the text is his,
// checked only for size and secrets. Always a row in ADAM's thread; said out
// loud through the live call's quiet gate when a call is open, else a Mac
// notification. Rate limited so a loop in ADAM can never nag.
import { randomUUID } from 'node:crypto'
import { ADAM_NOTIFY_MAX_CHARS } from '../../shared/adam-speaks-up'
import type { AdamThreadRow } from '../../shared/speech-types'
import { looksSecret } from './live-voice-terminal-text'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
export const ADAM_NOTIFY_PER_HOUR = 4
export const ADAM_NOTIFY_URGENT_PER_HOUR = 2
export const ADAM_NOTIFY_GAP_MS = 5 * MINUTE

export type AdamNotifyDeps = {
  /** "ADAM can tap me on the shoulder". */
  enabled: () => boolean
  appendThread: (row: AdamThreadRow) => Promise<void>
  /** Hands the text to the live call's quiet gate; false when no call is open. */
  sayLive: (text: string, urgent: boolean) => boolean
  showNotification: (title: string, body: string) => void
  now?: () => number
}

export type AdamNotifyResult = {
  delivered: 'spoken' | 'notification'
  savedInThread: boolean
}

/** A refused tap, with words ADAM can act on. */
export class AdamNotifyRefused extends Error {}

/** One line of plain text, or why not. */
export function adamNotifyText(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new AdamNotifyRefused('Missing --text')
  }
  // oxlint-disable-next-line no-control-regex -- removing control characters is the point
  const text = raw.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!text) {
    throw new AdamNotifyRefused('Missing --text')
  }
  if (text.length > ADAM_NOTIFY_MAX_CHARS) {
    throw new AdamNotifyRefused(`Text is too long (over ${ADAM_NOTIFY_MAX_CHARS} characters)`)
  }
  if (looksSecret(text)) {
    throw new AdamNotifyRefused('Text looks like it holds a secret (a key or token), so it was not sent')
  }
  return text
}

export class AdamNotifier {
  private sent: { at: number; urgent: boolean }[] = []
  private readonly now: () => number

  constructor(private readonly deps: AdamNotifyDeps) {
    this.now = deps.now ?? Date.now
  }

  /** Why refused, or null when a tap may go now. */
  private refusal(urgent: boolean, now: number): string | null {
    this.sent = this.sent.filter((tap) => now - tap.at < HOUR)
    if (this.sent.length >= ADAM_NOTIFY_PER_HOUR) {
      return `Carson was already tapped ${ADAM_NOTIFY_PER_HOUR} times in the last hour. Put it in your reply instead.`
    }
    if (urgent) {
      return this.sent.filter((tap) => tap.urgent).length >= ADAM_NOTIFY_URGENT_PER_HOUR
        ? `Only ${ADAM_NOTIFY_URGENT_PER_HOUR} urgent taps an hour.`
        : null
    }
    const last = this.sent.at(-1)
    return last && now - last.at < ADAM_NOTIFY_GAP_MS
      ? 'One tap every 5 minutes unless it is urgent.'
      : null
  }

  async notify(raw: unknown, urgent: boolean): Promise<AdamNotifyResult> {
    if (!this.deps.enabled()) {
      throw new AdamNotifyRefused('Carson turned off "ADAM can tap me on the shoulder" in Settings.')
    }
    const text = adamNotifyText(raw)
    const now = this.now()
    const refused = this.refusal(urgent, now)
    if (refused) {
      throw new AdamNotifyRefused(refused)
    }
    this.sent.push({ at: now, urgent })
    const row: AdamThreadRow = {
      id: `adam-notify:${randomUUID()}`,
      role: 'assistant',
      text,
      adamNotify: true,
      ...(urgent ? { urgent: true } : {})
    }
    const savedInThread = await this.deps.appendThread(row).then(
      () => true,
      (error: unknown) => {
        console.warn('ADAM notify row could not be saved:', error)
        return false
      }
    )
    if (this.deps.sayLive(text, urgent)) {
      return { delivered: 'spoken', savedInThread }
    }
    this.deps.showNotification('ADAM', text)
    return { delivered: 'notification', savedInThread }
  }
}

let current: AdamNotifier | null = null

export function setAdamNotifier(next: AdamNotifier | null): void {
  current = next
}

export function adamNotifier(): AdamNotifier | null {
  return current
}
