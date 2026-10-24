import { translate } from '@/i18n/i18n'

export const DISPLAY_NAME_MAX_CHARS = 40

/** A typed display name, trimmed and capped; undefined when blank (unset). */
export function normalizeDisplayName(raw: string | null | undefined): string | undefined {
  const name = (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, DISPLAY_NAME_MAX_CHARS).trim()
  return name.length > 0 ? name : undefined
}

/** Home's name: the chosen display name, else the git username, else none. */
export function homeGreetingName(
  displayName: string | null | undefined,
  gitUsername: string | null | undefined
): string | null {
  return normalizeDisplayName(displayName) ?? normalizeDisplayName(gitUsername) ?? null
}

export type HomeTimeBucket = 'morning' | 'afternoon' | 'evening' | 'lateNight'

export type HomeGreeting = {
  /** The opening phrase, without punctuation (the view adds the name and the period). */
  line: string
  /** Trimmed display name, or null when Dobius has none for the user. */
  name: string | null
  tagline: string
}

/** 5:00–11:59 morning, 12:00–16:59 afternoon, 17:00–21:59 evening, else late night. */
export function homeTimeBucket(hour: number): HomeTimeBucket {
  if (hour >= 5 && hour < 12) {
    return 'morning'
  }
  if (hour >= 12 && hour < 17) {
    return 'afternoon'
  }
  if (hour >= 17 && hour < 22) {
    return 'evening'
  }
  return 'lateNight'
}

// Why: built per call so the lines follow the current UI language.
function bucketLines(bucket: HomeTimeBucket): string[] {
  switch (bucket) {
    case 'morning':
      return [
        translate('board.home.greeting.morning1', 'Good morning'),
        translate('board.home.greeting.morning2', 'Morning'),
        translate('board.home.greeting.morning3', 'Fresh start'),
        translate('board.home.greeting.morning4', 'Rise and build')
      ]
    case 'afternoon':
      return [
        translate('board.home.greeting.afternoon1', 'Good afternoon'),
        translate('board.home.greeting.afternoon2', 'Afternoon'),
        translate('board.home.greeting.afternoon3', 'Back at it'),
        translate('board.home.greeting.afternoon4', 'Keep it rolling')
      ]
    case 'evening':
      return [
        translate('board.home.greeting.evening1', 'Good evening'),
        translate('board.home.greeting.evening2', 'Evening'),
        translate('board.home.greeting.evening3', 'One more push'),
        translate('board.home.greeting.evening4', 'Golden hour')
      ]
    case 'lateNight':
      return [
        translate('board.home.greeting.late1', 'Still up'),
        translate('board.home.greeting.late2', 'Night shift'),
        translate('board.home.greeting.late3', 'Quiet hours'),
        translate('board.home.greeting.late4', 'Midnight oil')
      ]
  }
}

function bucketTagline(bucket: HomeTimeBucket): string {
  switch (bucket) {
    case 'morning':
      return translate('board.home.tagline.morning', 'Pick a project and set your agents loose.')
    case 'afternoon':
      return translate('board.home.tagline.afternoon', 'Your boards are where you left them.')
    case 'evening':
      return translate('board.home.tagline.evening', 'Check in on your agents, or start one more.')
    case 'lateNight':
      return translate(
        'board.home.tagline.lateNight',
        'The agents do not sleep. Neither, it seems, do you.'
      )
  }
}

function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getFullYear(), 0, 0)
  const today = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  return Math.floor((today - start) / 86_400_000)
}

/**
 * The greeting for a moment in time. The line rotates by calendar day, not per
 * render, so it stays put while the screen is open and changes tomorrow.
 */
export function pickHomeGreeting(date: Date, name: string | null | undefined): HomeGreeting {
  const bucket = homeTimeBucket(date.getHours())
  const lines = bucketLines(bucket)
  const trimmed = name?.trim()
  return {
    line: lines[dayOfYear(date) % lines.length] ?? lines[0],
    name: trimmed ? trimmed : null,
    tagline: bucketTagline(bucket)
  }
}
