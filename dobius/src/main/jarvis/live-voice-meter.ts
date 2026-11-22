import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

// Why these rates: gpt-live-1.1 bills per second at $0.05 per active minute
// and $0.02 per standby minute (design doc section 1.7, checked on two pages).
// The meter is an ESTIMATE until compared with the OpenAI usage page.
export const LIVE_ACTIVE_USD_PER_MIN = 0.05
export const LIVE_STANDBY_USD_PER_MIN = 0.02
export const LIVE_CAP_WARN_FRACTION = 0.8
export const LIVE_METER_TICK_MS = 15_000
// Why a ceiling per slice: a Mac that slept with a call open would otherwise
// bill hours of sleep as one slice. The call cannot survive sleep anyway.
export const LIVE_METER_MAX_SLICE_SEC = 120
const KEPT_DAYS = 31

export type LiveVoiceDayUsage = { activeSec: number; standbySec: number }

export type LiveVoiceMeterStatus = {
  day: string
  activeSec: number
  standbySec: number
  usdToday: number
  capUsd: number
  nearCap: boolean
  overCap: boolean
}

type MeterFile = { version: 1; days: Record<string, LiveVoiceDayUsage> }

/** Carson's local calendar day, so the cap resets at his midnight. */
export function localDayKey(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function estimateLiveUsd(usage: LiveVoiceDayUsage): number {
  return (
    (usage.activeSec / 60) * LIVE_ACTIVE_USD_PER_MIN +
    (usage.standbySec / 60) * LIVE_STANDBY_USD_PER_MIN
  )
}

const isSeconds = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

/** The saved days, or null when the file is not exactly what this meter writes. */
function parseDays(text: string): Record<string, LiveVoiceDayUsage> | null {
  const parsed = JSON.parse(text) as Partial<MeterFile> | null
  const days = parsed?.days
  if (parsed?.version !== 1 || !days || typeof days !== 'object' || Array.isArray(days)) {
    return null
  }
  const out: Record<string, LiveVoiceDayUsage> = {}
  for (const [key, value] of Object.entries(days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !isSeconds(value?.activeSec) || !isSeconds(value?.standbySec)) {
      return null
    }
    out[key] = { activeSec: value.activeSec, standbySec: value.standbySec }
  }
  return out
}

/**
 * Counts connected OpenAI Live seconds per day, split into active and
 * standby, and saves them beside adam-voice-session.json. Main owns it: the
 * window only reports standby changes, and main's own clock does the counting.
 */
export class LiveVoiceMeter {
  private days: Record<string, LiveVoiceDayUsage> | null = null
  // prepaidSec: seconds already counted for this call (the setup reserve).
  private running: { standby: boolean; since: number; prepaidSec: number } | null = null
  // Why fail closed: a record that cannot be read or saved would otherwise
  // reset today's total to zero and reopen the budget. A missing file is a
  // first run and is fine.
  private problem: 'damaged' | 'unsaved' | null = null

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now
  ) {}

  get isRunning(): boolean {
    return this.running !== null
  }

  /** True when today's total is known and saved, so the cap can be trusted. */
  get available(): boolean {
    // Why reload: Carson may have fixed or deleted a damaged file since.
    if (this.problem === 'damaged') {
      this.problem = null
      this.days = null
    }
    this.load()
    if (this.problem === 'unsaved') {
      this.save()
    }
    return this.problem === null
  }

  /**
   * Counts seconds now, before a session exists. Returns the day they were
   * counted on, or null (and nothing kept) when they could not be saved.
   */
  reserve(seconds: number): string | null {
    const day = localDayKey(this.now())
    this.addActive(seconds, day)
    this.save()
    if (this.problem === null) {
      return day
    }
    this.addActive(-seconds, day)
    return null
  }

  /** Gives back reserved seconds that were never billed, on the day they were taken. */
  release(seconds: number, day: string): void {
    this.addActive(-seconds, day)
    this.save()
  }

  /**
   * A call connected: count it at the active rate until told otherwise.
   * `prepaidSec` were reserved for it already and are its first seconds.
   */
  start(prepaidSec = 0): void {
    this.accrue()
    this.running = { standby: false, since: this.now(), prepaidSec }
  }

  setStandby(standby: boolean): void {
    if (!this.running || this.running.standby === standby) {
      return
    }
    this.accrue()
    if (this.running) {
      this.running.standby = standby
    }
  }

  stop(): void {
    this.accrue()
    this.running = null
  }

  /** Adds the time since the last count to today's total and saves it. */
  accrue(): void {
    const running = this.running
    if (!running) {
      return
    }
    const now = this.now()
    const slice = Math.min(Math.max(0, (now - running.since) / 1000), LIVE_METER_MAX_SLICE_SEC)
    running.since = now
    // Prepaid seconds are the first of the slice, and are used up once.
    const prepaid = Math.min(slice, running.prepaidSec)
    running.prepaidSec -= prepaid
    if (slice - prepaid <= 0) {
      return
    }
    const days = this.load()
    // Why split at midnight: each day's total is what its cap is checked against.
    let from = now - (slice - prepaid) * 1000
    while (from < now) {
      const date = new Date(from)
      const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()
      const to = Math.min(midnight, now)
      const seconds = (to - from) / 1000
      const key = localDayKey(from)
      const day = days[key] ?? { activeSec: 0, standbySec: 0 }
      days[key] = running.standby
        ? { ...day, standbySec: day.standbySec + seconds }
        : { ...day, activeSec: day.activeSec + seconds }
      from = to
    }
    this.save()
  }

  private addActive(seconds: number, key: string): void {
    const days = this.load()
    const day = days[key] ?? { activeSec: 0, standbySec: 0 }
    days[key] = { ...day, activeSec: Math.max(0, day.activeSec + seconds) }
  }

  status(capUsd: number): LiveVoiceMeterStatus {
    this.accrue()
    const day = localDayKey(this.now())
    const usage = this.load()[day] ?? { activeSec: 0, standbySec: 0 }
    const usdToday = estimateLiveUsd(usage)
    return {
      day,
      activeSec: usage.activeSec,
      standbySec: usage.standbySec,
      usdToday,
      capUsd,
      nearCap: usdToday >= capUsd * LIVE_CAP_WARN_FRACTION,
      overCap: usdToday >= capUsd
    }
  }

  private load(): Record<string, LiveVoiceDayUsage> {
    if (this.days) {
      return this.days
    }
    let days: Record<string, LiveVoiceDayUsage> | null = {}
    try {
      days = parseDays(readFileSync(this.file, 'utf8'))
    } catch (error) {
      days = (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? {} : null
    }
    if (!days) {
      this.problem = 'damaged'
      console.warn('[jarvis-live] spend meter file is damaged; live calls are refused')
    }
    this.days = days ?? {}
    return this.days
  }

  private save(): void {
    const days = this.load()
    const kept = Object.keys(days).sort().slice(-KEPT_DAYS)
    const trimmed: Record<string, LiveVoiceDayUsage> = {}
    for (const key of kept) {
      trimmed[key] = days[key]
    }
    this.days = trimmed
    // Why not overwrite a damaged file: it is the only record of today's
    // spend; Carson fixes or deletes it (Settings says where).
    if (this.problem === 'damaged') {
      return
    }
    const temp = `${this.file}.${randomUUID()}.tmp`
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const body: MeterFile = { version: 1, days: trimmed }
      writeFileSync(temp, JSON.stringify(body), { mode: 0o600, flag: 'wx' })
      renameSync(temp, this.file)
      this.problem = null
    } catch (error) {
      this.problem = 'unsaved'
      // Why keep going: the in-memory total still enforces the cap this run.
      console.warn('[jarvis-live] spend meter could not be saved:', error)
      try {
        rmSync(temp, { force: true })
      } catch {
        // Best effort: a stray temp file is harmless, a throw here is not.
      }
    }
  }
}
