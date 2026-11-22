// "What's new" notes: one short Markdown file per release
// (resources/whats-new/<version>.md), a few "- " lines in plain words.
// Why pure (no Electron, no fs): the same rules decide what the app shows and
// what the tests check, with no window or disk needed.

export type WhatsNewSection = {
  version: string
  bullets: string[]
}

export type WhatsNewPayload = {
  sections: WhatsNewSection[]
}

/** Persisted under `whatsNew`. Main-owned; never part of the renderer UI state. */
export type WhatsNewState = {
  /** Highest version whose notes were shown (or skipped on a fresh install). */
  seen: string
}

export const WHATS_NEW_MAX_BYTES = 4096
export const WHATS_NEW_MAX_BULLETS = 5
export const WHATS_NEW_MAX_LINE = 280
/** Every skipped release up to ten, newest first (the popup body scrolls). */
export const WHATS_NEW_MAX_SECTIONS = 10

const VERSION_RE = /^(\d{1,4})\.(\d{1,4})\.(\d{1,6})$/
// Why built from codes: house rule keeps en and em dashes out of user-facing
// text, including this source file.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`)
// C0 controls, DEL, line/paragraph separators, bidi overrides and isolates.
const CONTROLS = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(0x1f)}${String.fromCharCode(0x7f)}` +
    `${String.fromCharCode(0x2028, 0x2029)}${String.fromCharCode(0x202a)}-${String.fromCharCode(0x202e)}` +
    `${String.fromCharCode(0x2066)}-${String.fromCharCode(0x2069)}]`
)

/** Plain `major.minor.patch` only. Prerelease builds take no part in the popup. */
export function isWhatsNewVersion(value: unknown): value is string {
  return typeof value === 'string' && VERSION_RE.test(value)
}

/** -1, 0 or 1. Callers validate both sides with isWhatsNewVersion first. */
export function compareWhatsNewVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] < rightParts[index] ? -1 : 1
    }
  }
  return 0
}

export type ParsedWhatsNewNotes = { ok: true; bullets: string[] } | { ok: false; error: string }

/**
 * Every non-blank line must be a "- " bullet. Anything else (a heading, a
 * stray paragraph) is refused rather than silently dropped, so what the author
 * wrote is exactly what people see.
 */
export function parseWhatsNewNotes(text: unknown): ParsedWhatsNewNotes {
  if (typeof text !== 'string') {
    return { ok: false, error: 'not text' }
  }
  if (new TextEncoder().encode(text).length > WHATS_NEW_MAX_BYTES) {
    return { ok: false, error: `longer than ${WHATS_NEW_MAX_BYTES} bytes` }
  }
  const bullets: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) {
      continue
    }
    if (!line.startsWith('- ')) {
      return { ok: false, error: `not a "- " line: ${line.slice(0, 60)}` }
    }
    const bullet = line.slice(2).trim()
    if (!bullet) {
      return { ok: false, error: 'an empty bullet' }
    }
    if (bullet.length > WHATS_NEW_MAX_LINE) {
      return { ok: false, error: `a line longer than ${WHATS_NEW_MAX_LINE} characters` }
    }
    if (DASHES.test(bullet)) {
      return { ok: false, error: 'a dash character (use a comma, colon or period)' }
    }
    if (CONTROLS.test(bullet)) {
      return { ok: false, error: 'a control character' }
    }
    bullets.push(bullet)
  }
  if (bullets.length === 0) {
    return { ok: false, error: 'no "- " lines' }
  }
  if (bullets.length > WHATS_NEW_MAX_BULLETS) {
    return { ok: false, error: `more than ${WHATS_NEW_MAX_BULLETS} lines` }
  }
  return { ok: true, bullets }
}

/** Reads the persisted record defensively: disk input is never trusted. */
export function readWhatsNewSeen(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const seen = (value as { seen?: unknown }).seen
  return isWhatsNewVersion(seen) ? seen : null
}

/** A malformed record becomes undefined, so the profile reads as "seen nothing". */
export function normalizeWhatsNewState(value: unknown): WhatsNewState | undefined {
  const seen = readWhatsNewSeen(value)
  return seen === null ? undefined : { seen }
}

/**
 * The value to store when `version` has been shown. Never goes down: a
 * downgrade and back must not show notes that were already read.
 */
export function raiseWhatsNewSeen(seen: string | null, version: string): string | null {
  if (!isWhatsNewVersion(version)) {
    return seen
  }
  if (seen !== null && compareWhatsNewVersions(seen, version) >= 0) {
    return seen
  }
  return version
}

export type WhatsNewPlan = {
  /** What to show, newest first. Empty means show nothing. */
  sections: WhatsNewSection[]
  /** A version to record as seen right now, without showing anything. */
  newSeen: string | null
}

/**
 * What to show and what to record, from the saved state alone.
 *   seen: the highest version whose notes were dismissed (or null)
 *   existingProfile: the app's data file was there before this launch
 */
export function planWhatsNew(args: {
  current: string
  seen: string | null
  existingProfile: boolean
  notes: ReadonlyMap<string, string[]>
}): WhatsNewPlan {
  const { current, existingProfile, notes } = args
  if (!isWhatsNewVersion(current)) {
    return { sections: [], newSeen: null }
  }
  const seen = isWhatsNewVersion(args.seen) ? args.seen : null
  if (seen !== null && compareWhatsNewVersions(seen, current) >= 0) {
    return { sections: [], newSeen: null }
  }
  // Fresh install: nothing to tell them about, start counting from here.
  if (seen === null && !existingProfile) {
    return { sections: [], newSeen: current }
  }
  // Why: no `seen` on a profile that ran before means it last ran a version
  // older than the popup itself, so every notes file up to this one was missed.
  const versions = [...notes.keys()]
    .filter(
      (version) =>
        isWhatsNewVersion(version) &&
        compareWhatsNewVersions(version, current) <= 0 &&
        (seen === null || compareWhatsNewVersions(version, seen) > 0)
    )
    .sort((left, right) => compareWhatsNewVersions(right, left))
    .slice(0, WHATS_NEW_MAX_SECTIONS)
  if (versions.length === 0) {
    // Nothing written for these releases: move the marker so we stop looking.
    return { sections: [], newSeen: current }
  }
  return {
    sections: versions.map((version) => ({ version, bullets: notes.get(version) ?? [] })),
    newSeen: null
  }
}

/** Checks one section that crossed the IPC boundary. Null when unusable. */
export function readWhatsNewSection(value: unknown): WhatsNewSection | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const { version, bullets } = value as { version?: unknown; bullets?: unknown }
  if (!isWhatsNewVersion(version) || !Array.isArray(bullets)) {
    return null
  }
  const lines = bullets.filter(
    (bullet): bullet is string => typeof bullet === 'string' && bullet !== ''
  )
  return lines.length > 0 ? { version, bullets: lines } : null
}

/** Checks a payload that crossed the IPC boundary. Null means show nothing. */
export function readWhatsNewPayload(value: unknown): WhatsNewPayload | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const raw = (value as { sections?: unknown }).sections
  if (!Array.isArray(raw)) {
    return null
  }
  const sections = raw
    .map(readWhatsNewSection)
    .filter((section): section is WhatsNewSection => section !== null)
  return sections.length > 0 ? { sections } : null
}
