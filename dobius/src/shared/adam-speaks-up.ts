// "ADAM speaks up" settings (build plan 7.16): ADAM's own taps on Carson's
// shoulder, the stale alerts and the morning brief. Shared so main and the
// Settings pane read the same defaults and bounds.
import type { VoiceSettings } from './speech-types'

/** Longest `dobius adam notify` text. */
export const ADAM_NOTIFY_MAX_CHARS = 300

export type MinutesBound = { fallback: number; min: number; max: number }

export const STALE_WAITING_MINUTES: MinutesBound = { fallback: 10, min: 2, max: 240 }
export const STALE_REMINDER_MINUTES: MinutesBound = { fallback: 30, min: 5, max: 480 }
export const STALE_WORKING_MINUTES: MinutesBound = { fallback: 45, min: 10, max: 720 }

export const MORNING_BRIEF_DEFAULT_TIME = '07:00'
// Why a hard stop at 11:00: a Mac asleep at 7:00 still gets the brief on wake,
// but never a "morning" brief at noon. A time set at 11:00 or later gets 1 hour.
export const MORNING_BRIEF_LAST_MINUTE = 11 * 60
const LATE_BRIEF_WINDOW_MINUTES = 60

/** The first minute of the day (0-1440) after the brief's window starting at `start`. */
export function morningBriefWindowEnd(start: number): number {
  return start < MORNING_BRIEF_LAST_MINUTE
    ? MORNING_BRIEF_LAST_MINUTE
    : Math.min(start + LATE_BRIEF_WINDOW_MINUTES, 24 * 60)
}

export function normalizeMinutes(value: unknown, bound: MinutesBound): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : NaN
  return Number.isNaN(number) ? bound.fallback : Math.min(bound.max, Math.max(bound.min, number))
}

export type ClockTime = { hour: number; minute: number }

/** "07:00" style 24-hour time, or null. */
export function parseClockTime(value: unknown): ClockTime | null {
  const match = typeof value === 'string' ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim()) : null
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null
}

export function clockTimeText(time: ClockTime): string {
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`
}

export type SpeaksUpSettings = {
  /** "ADAM can tap me on the shoulder" (dobius adam notify). On unless false. */
  tapOnShoulder: boolean
  waitingMinutes: number
  reminderMinutes: number
  workingMinutes: number
  morningBrief: boolean
  morningBriefTime: ClockTime
}

export function resolveSpeaksUpSettings(voice: VoiceSettings | undefined): SpeaksUpSettings {
  return {
    tapOnShoulder: voice?.adamCanTapShoulder !== false,
    waitingMinutes: normalizeMinutes(voice?.adamStaleWaitingMinutes, STALE_WAITING_MINUTES),
    reminderMinutes: normalizeMinutes(voice?.adamStaleReminderMinutes, STALE_REMINDER_MINUTES),
    workingMinutes: normalizeMinutes(voice?.adamStaleWorkingMinutes, STALE_WORKING_MINUTES),
    morningBrief: voice?.adamMorningBrief !== false,
    morningBriefTime:
      parseClockTime(voice?.adamMorningBriefTime) ??
      (parseClockTime(MORNING_BRIEF_DEFAULT_TIME) as ClockTime)
  }
}

/** Whether the morning brief may text Carson's iMessage handle (verified by a code he typed back). */
export type BriefHandleStatus = {
  /** The handle set in Settings, iMessage bridge; null when none is set. */
  handle: string | null
  verified: boolean
  /** A code was texted and is waiting to be typed in. */
  codeSent: boolean
}

export type BriefHandleResult = { ok: true; status: BriefHandleStatus } | { ok: false; error: string; status: BriefHandleStatus }

export const BRIEF_HANDLE_UNVERIFIED = 'verify your iMessage number in Settings'
