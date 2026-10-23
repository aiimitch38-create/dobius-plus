import { execFile } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import type { JobStore } from '../jobs/store.js'

export type HeartbeatChannel = 'imessage' | 'tts'

export const HEARTBEAT_CHANNELS: readonly HeartbeatChannel[] = ['imessage', 'tts']

export type HeartbeatThresholds = { warnMs: number; alertMs: number }

export const DEFAULT_HEARTBEAT_THRESHOLDS: HeartbeatThresholds = {
  warnMs: 6 * 3_600_000,
  alertMs: 12 * 3_600_000
}

export type Severity = 'ok' | 'unproven' | 'suppressed' | 'warn' | 'alert'

export type HeartbeatFinding = {
  channel: HeartbeatChannel
  lastSentAt: string | null
  silentMs: number | null
  severity: Severity
}

export function isQuietHour(at: Date, quietStartHour = 23, quietEndHour = 8): boolean {
  const hour = at.getHours()
  return hour >= quietStartHour || hour < quietEndHour
}

export function classifySilence(input: {
  silentMs: number | null
  at: Date
  thresholds?: HeartbeatThresholds
}): Severity {
  if (input.silentMs === null) return 'unproven'
  const thresholds = input.thresholds ?? DEFAULT_HEARTBEAT_THRESHOLDS
  if (input.silentMs >= thresholds.alertMs) return 'alert'
  if (input.silentMs >= thresholds.warnMs && !isQuietHour(input.at)) return 'warn'
  if (input.silentMs >= thresholds.warnMs) return 'suppressed'
  return 'ok'
}

export type EscalationInput = {
  dedupeKey: string
  channel: HeartbeatChannel
  recipient: string
  text: string
}

export type NotifyFn = (text: string) => void

function osascriptNotify(text: string): void {
  execFile('/usr/bin/osascript', ['-e', `display notification ${JSON.stringify(text)} with title "ADAM"`], () => undefined)
}

export class ChannelHeartbeat {
  private readonly thresholds: HeartbeatThresholds
  private readonly recipient: string
  private readonly notify: NotifyFn
  private readonly heartbeatFile: string
  private lastDitchBucket: string | undefined

  constructor(
    private readonly store: Pick<JobStore, 'enqueueOutbox'>,
    private readonly queryLastSent: (channel: HeartbeatChannel) => string | null,
    options: {
      recipient: string
      thresholds?: HeartbeatThresholds
      notify?: NotifyFn
      heartbeatFile?: string
    }
  ) {
    this.thresholds = options.thresholds ?? DEFAULT_HEARTBEAT_THRESHOLDS
    this.recipient = options.recipient
    this.notify = options.notify ?? osascriptNotify
    this.heartbeatFile = options.heartbeatFile ?? 'HEARTBEAT.md'
  }

  findings(at: Date = new Date()): HeartbeatFinding[] {
    return HEARTBEAT_CHANNELS.map((channel) => {
      const lastSentAt = this.queryLastSent(channel)
      let silentMs: number | null = null
      if (lastSentAt !== null) {
        const lastMs = Date.parse(lastSentAt)
        silentMs = Number.isFinite(lastMs) ? Math.max(0, at.getTime() - lastMs) : null
      }
      return {
        channel,
        lastSentAt,
        silentMs,
        severity: classifySilence({ silentMs, at, thresholds: this.thresholds })
      }
    })
  }

  runPass(at: Date = new Date()): { escalated: HeartbeatChannel[]; allDead: boolean } {
    const results = this.findings(at)
    const breached = results.filter((finding) => finding.severity === 'alert' || finding.severity === 'warn')
    const escalated: HeartbeatChannel[] = []
    for (const finding of breached) escalated.push(...this.escalate(finding, at))
    const allDead = breached.length === HEARTBEAT_CHANNELS.length
    if (allDead) {
      const bucket = at.toISOString().slice(0, 13)
      if (bucket !== this.lastDitchBucket) {
        this.lastDitchBucket = bucket
        this.recordLastDitch(results, at)
      }
    }
    return { escalated, allDead }
  }

  private escalate(finding: HeartbeatFinding, at: Date): HeartbeatChannel[] {
    const viaChannel: HeartbeatChannel = finding.channel === 'imessage' ? 'tts' : 'imessage'
    const bucket = at.toISOString().slice(0, 13)
    const text = `${finding.channel} alerts silent ${Math.round((finding.silentMs ?? 0) / 3_600_000)}h since ${finding.lastSentAt ?? 'never'}`
    const enqueued = this.store.enqueueOutbox({
      dedupeKey: `heartbeat:${finding.channel}:${bucket}`,
      channel: viaChannel,
      recipient: this.recipient,
      payload: { text }
    })
    return enqueued.created ? [finding.channel] : []
  }

  private recordLastDitch(findings: HeartbeatFinding[], at: Date): void {
    const lines = findings
      .map((finding) => `${finding.channel}: ${finding.severity}, silent ${Math.round((finding.silentMs ?? 0) / 3_600_000)}h`)
      .join('; ')
    const line = `- ${at.toISOString()} ALL ALERT CHANNELS DEAD — ${lines}`
    console.error(line)
    try {
      appendFileSync(this.heartbeatFile, `${line}\n`, 'utf8')
    } catch (error) {
      console.error(`heartbeat file append failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    this.notify('ADAM: all alert channels are dead. Check the service log and HEARTBEAT.md.')
  }
}
