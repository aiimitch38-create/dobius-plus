// Saved state of text intake (7.17), one private JSON file under userData:
// the tracked contacts, the last 500 intake records, the suggestions and the
// drafts. Why private (0600): it holds phone numbers and message text.
import {
  TEXT_INTAKE_MAX_CONTACTS,
  TEXT_INTAKE_MAX_RECORDS,
  TRACKED_CONTACT_NAME_MAX,
  type IntakeRecord,
  type IntakeSuggestion,
  type TextDraft,
  type TrackedContact
} from '../../shared/text-intake'
import { isValidImessageHandle } from '../imessage-bridge/imessage-send'
import { SafeJsonFile } from '../storage/safe-json-file'

const MAX_SUGGESTIONS = 500
const MAX_DRAFTS = 200

export type IntakeState = {
  contacts: TrackedContact[]
  records: IntakeRecord[]
  suggestions: IntakeSuggestion[]
  drafts: TextDraft[]
}

const empty = (): IntakeState => ({ contacts: [], records: [], suggestions: [], drafts: [] })

/** A contact as typed in Settings, or null when the handle or name is not usable. */
export function cleanContact(raw: unknown): TrackedContact | null {
  const record = (raw ?? {}) as { handle?: unknown; name?: unknown }
  if (typeof record.handle !== 'string' || typeof record.name !== 'string') {
    return null
  }
  const handle = record.handle.trim()
  // oxlint-disable-next-line no-control-regex -- removing control characters is the point
  const name = record.name.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!isValidImessageHandle(handle) || !name || name.length > TRACKED_CONTACT_NAME_MAX) {
    return null
  }
  return { handle, name }
}

/** Valid contacts only, each handle once (case-insensitive), at most 100. */
export function cleanContacts(raw: unknown): TrackedContact[] {
  const seen = new Set<string>()
  const contacts: TrackedContact[] = []
  for (const entry of Array.isArray(raw) ? raw : []) {
    const contact = cleanContact(entry)
    const key = contact?.handle.toLowerCase()
    if (contact && key && !seen.has(key)) {
      seen.add(key)
      contacts.push(contact)
    }
  }
  return contacts.slice(0, TEXT_INTAKE_MAX_CONTACTS)
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function listOf<T>(raw: unknown, keep: (entry: Record<string, unknown>) => boolean): T[] {
  return Array.isArray(raw) ? (raw.filter((entry) => isObject(entry) && keep(entry)) as T[]) : []
}

const hasStrings = (entry: Record<string, unknown>, keys: string[]): boolean =>
  keys.every((key) => typeof entry[key] === 'string')

function parseState(raw: unknown): IntakeState | undefined {
  if (!isObject(raw)) {
    return undefined
  }
  return {
    contacts: cleanContacts(raw.contacts),
    records: listOf<IntakeRecord>(raw.records, (e) => hasStrings(e, ['id', 'contactHandle', 'text'])),
    suggestions: listOf<IntakeSuggestion>(raw.suggestions, (e) => hasStrings(e, ['id', 'messageId', 'status'])),
    // Why: a draft caught mid-send by a quit is not known to have gone out; it shows as failed.
    drafts: listOf<TextDraft>(raw.drafts, (e) => hasStrings(e, ['id', 'toHandle', 'text', 'status'])).map(
      (draft) => (draft.status === 'sending' ? { ...draft, status: 'failed', error: 'Dobius+ quit while sending; it may not have gone out.' } : draft)
    )
  }
}

/** Keeps each list to its cap, newest last. */
export function trimState(state: IntakeState): IntakeState {
  return {
    contacts: state.contacts,
    records: state.records.slice(-TEXT_INTAKE_MAX_RECORDS),
    suggestions: state.suggestions.slice(-MAX_SUGGESTIONS),
    drafts: state.drafts.slice(-MAX_DRAFTS)
  }
}

export type IntakeStore = {
  get: () => IntakeState
  /** Throws when the file could not be written; the old state stays. */
  save: (next: IntakeState) => void
}

export function createIntakeStore(filePath: () => string): IntakeStore {
  const file = new SafeJsonFile<IntakeState>({
    filePath,
    parse: parseState,
    fallback: empty,
    mode: 0o600,
    label: '[text-intake] text-intake.json'
  })
  return {
    get: () => file.get(),
    save: (next) => file.save(trimState(next))
  }
}

/** An in-memory store for tests. */
export function memoryIntakeStore(initial: Partial<IntakeState> = {}): IntakeStore {
  let state: IntakeState = { ...empty(), ...initial }
  return {
    get: () => state,
    save: (next) => {
      state = trimState(next)
    }
  }
}
