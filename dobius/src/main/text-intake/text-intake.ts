// Text intake (build plan 7.17): iMessage as ADAM's monitor.
//   - ingest(): a new text from a TRACKED contact becomes an intake record and,
//     when the rules say it asks for something, a SUGGESTED card. Texts from
//     anyone else are dropped before their words are kept anywhere.
//   - accept()/dismiss(): only Carson's click makes a real backlog card.
//   - draftText()/sendDraft(): ADAM drafts a text; it goes out only on Carson's Send.
// Incoming text is untrusted data: stored, shown, quoted on a card. It never
// reaches a model and never triggers anything on its own.
import { randomUUID } from 'node:crypto'
import type { AdamThreadRow } from '../../shared/speech-types'
import {
  TEXT_DRAFT_MAX_CHARS,
  type IntakeRecord,
  type IntakeSource,
  type IntakeSuggestion,
  type TextDraft,
  type TextIntakeResult,
  type TextIntakeView,
  type TrackedContact
} from '../../shared/text-intake'
import type { VertexTaskInput } from '../../shared/vertex-task-types'
import { stripControlChars } from '../imessage-bridge/imessage-send'
import { selfHandleSpellings } from '../imessage-bridge/self-handle-spellings'
import { looksSecret } from '../jarvis/live-voice-terminal-text'
import { cleanContacts, type IntakeState, type IntakeStore } from './intake-store'
import { cleanIntakeText, isActionableText, suggestionTitle } from './intake-text'

export type TextIntakeDeps = {
  store: IntakeStore
  /** Makes the real backlog card through the existing tasks store; returns its id. */
  createCard: (input: VertexTaskInput) => { id: string }
  /** The bridge's sendImessage (its handle checks and outbound rate limit). */
  sendText: (handle: string, text: string) => Promise<void>
  /** Null when a text can go out now, else why not. */
  sendUnavailable: () => string | null
  appendThread: (row: AdamThreadRow) => Promise<void>
  /** Taps Carson with a fixed template (never the message text). */
  tap: (text: string) => void
  now?: () => number
}

export type IncomingText = { messageId: string; handle: string; text: string; source?: IntakeSource }
export type IngestOutcome = 'ignored' | 'duplicate' | 'stored' | 'suggested'

/** A refused draft, in words ADAM can act on. */
export class TextIntakeRefused extends Error {}

/** A draft's text as ADAM or Carson wrote it, or why it cannot be sent. */
export function draftText(raw: unknown): string {
  const text = typeof raw === 'string' ? stripControlChars(raw).trim() : ''
  if (!text) {
    throw new TextIntakeRefused('Missing --text')
  }
  if (text.length > TEXT_DRAFT_MAX_CHARS) {
    throw new TextIntakeRefused(`Text is too long (over ${TEXT_DRAFT_MAX_CHARS} characters)`)
  }
  if (looksSecret(text)) {
    throw new TextIntakeRefused('Text looks like it holds a secret (a key or token), so no draft was made')
  }
  return text
}

const sameHandle = (a: string, b: string): boolean =>
  selfHandleSpellings(a).some((spelling) => selfHandleSpellings(b).includes(spelling))

export class TextIntake {
  private readonly now: () => number

  constructor(private readonly deps: TextIntakeDeps) {
    this.now = deps.now ?? Date.now
  }

  private state(): IntakeState {
    return this.deps.store.get()
  }

  private save(next: IntakeState): void {
    this.deps.store.save(next)
  }

  view(): TextIntakeView {
    const state = this.state()
    return {
      contacts: state.contacts,
      suggestions: state.suggestions.filter((s) => s.status === 'pending'),
      drafts: state.drafts.filter((d) => d.status === 'pending' || d.status === 'sending' || d.status === 'failed')
    }
  }

  private result(error?: string): TextIntakeResult {
    return error ? { ok: false, error, view: this.view() } : { ok: true, view: this.view() }
  }

  /** Every chat.db spelling of every tracked handle (the poller's filter). */
  trackedSpellings(): string[] {
    return [...new Set(this.state().contacts.flatMap((c) => selfHandleSpellings(c.handle)))]
  }

  contactForHandle(handle: string): TrackedContact | null {
    return this.state().contacts.find((c) => sameHandle(c.handle, handle)) ?? null
  }

  setContacts(raw: unknown): TextIntakeResult {
    try {
      this.save({ ...this.state(), contacts: cleanContacts(raw) })
      return this.result()
    } catch (error) {
      return this.result(`Contacts could not be saved: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  ingest(incoming: IncomingText): IngestOutcome {
    const contact = this.contactForHandle(incoming.handle)
    // Why first: an untracked sender's words are never kept, not even for dedupe.
    if (!contact) {
      return 'ignored'
    }
    const state = this.state()
    if (state.records.some((r) => r.id === incoming.messageId)) {
      return 'duplicate'
    }
    const text = cleanIntakeText(incoming.text)
    if (!text) {
      return 'ignored'
    }
    const record: IntakeRecord = {
      id: incoming.messageId,
      source: incoming.source ?? 'imessage',
      contactHandle: contact.handle,
      contactName: contact.name,
      receivedAt: this.now(),
      text
    }
    const actionable = isActionableText(text)
    const suggestions = actionable ? [...state.suggestions, this.suggestionFor(record)] : state.suggestions
    this.save({ ...state, records: [...state.records, record], suggestions })
    this.deps.tap(actionable ? `New suggested task from a text by ${contact.name}` : `New text from ${contact.name}`)
    return actionable ? 'suggested' : 'stored'
  }

  private suggestionFor(record: IntakeRecord): IntakeSuggestion {
    return {
      id: `sugg-${randomUUID()}`,
      messageId: record.id,
      source: record.source,
      contactName: record.contactName,
      contactHandle: record.contactHandle,
      title: suggestionTitle(record.contactName, record.text),
      text: record.text,
      createdAt: this.now(),
      status: 'pending'
    }
  }

  /** Carson's Accept: exactly one backlog card, the text quoted as untrusted data. */
  accept(id: string): TextIntakeResult {
    const state = this.state()
    const suggestion = state.suggestions.find((s) => s.id === id)
    if (!suggestion || suggestion.status !== 'pending') {
      return this.result('That suggestion is no longer waiting.')
    }
    let taskId: string
    try {
      taskId = this.deps.createCard({
        title: suggestion.title,
        status: 'backlog',
        description: `From a text by ${suggestion.contactName} (${suggestion.contactHandle}). Message id: ${suggestion.messageId}.`,
        labels: ['from-text'],
        sourceQuote: { origin: 'imessage', sender: suggestion.contactName, receivedAt: suggestion.createdAt, text: suggestion.text },
        origin: { kind: 'user', name: 'Carson', note: 'Accepted from "From texts"' }
      }).id
    } catch (error) {
      return this.result(`The card could not be made: ${error instanceof Error ? error.message : String(error)}`)
    }
    const next = { ...suggestion, status: 'accepted' as const, taskId }
    this.save({ ...state, suggestions: state.suggestions.map((s) => (s.id === id ? next : s)) })
    return this.result()
  }

  dismiss(id: string): TextIntakeResult {
    const state = this.state()
    if (!state.suggestions.some((s) => s.id === id && s.status === 'pending')) {
      return this.result('That suggestion is no longer waiting.')
    }
    const suggestions = state.suggestions.map((s) => (s.id === id ? { ...s, status: 'dismissed' as const } : s))
    this.save({ ...state, suggestions })
    return this.result()
  }

  /** ADAM's `draft-text`: a DRAFT for a tracked contact. Never sends. */
  createDraft(to: unknown, raw: unknown): TextDraft {
    const wanted = typeof to === 'string' ? to.trim().toLowerCase() : ''
    if (!wanted) {
      throw new TextIntakeRefused('Missing --to (a tracked contact name)')
    }
    const state = this.state()
    const matches = state.contacts.filter((c) => c.name.toLowerCase() === wanted)
    if (matches.length !== 1) {
      throw new TextIntakeRefused(
        matches.length === 0
          ? `"${String(to).trim().slice(0, 60)}" is not one of Carson's tracked contacts, so no draft was made.`
          : 'Two tracked contacts share that name; ask Carson to rename one in Settings.'
      )
    }
    const draft: TextDraft = {
      id: `draft-${randomUUID()}`,
      toName: matches[0].name,
      toHandle: matches[0].handle,
      text: draftText(raw),
      createdAt: this.now(),
      status: 'pending'
    }
    this.save({ ...state, drafts: [...state.drafts, draft] })
    this.deps.tap(`ADAM drafted a text to ${draft.toName}. It waits for your Send.`)
    return draft
  }

  private setDraft(id: string, patch: Partial<TextDraft>): void {
    const state = this.state()
    this.save({ ...state, drafts: state.drafts.map((d) => (d.id === id ? { ...d, ...patch } : d)) })
  }

  /** Carson's Send click: the only way a draft goes out. `text` is his edit, if any. */
  async sendDraft(id: string, edited?: unknown): Promise<TextIntakeResult> {
    const draft = this.state().drafts.find((d) => d.id === id)
    if (!draft || (draft.status !== 'pending' && draft.status !== 'failed')) {
      return this.result('That draft is no longer waiting.')
    }
    // Why re-checked: the contact may have been removed since ADAM drafted it.
    const contact = this.contactForHandle(draft.toHandle)
    if (!contact) {
      return this.result(`${draft.toName} is no longer a tracked contact, so it was not sent.`)
    }
    let text: string
    try {
      text = edited === undefined ? draft.text : draftText(edited)
    } catch (error) {
      return this.result(error instanceof Error ? error.message : String(error))
    }
    const unavailable = this.deps.sendUnavailable()
    if (unavailable) {
      return this.result(unavailable)
    }
    this.setDraft(id, { status: 'sending', text })
    try {
      await this.deps.sendText(draft.toHandle, text)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.setDraft(id, { status: 'failed', error: message })
      return this.result(`Not sent: ${message}`)
    }
    this.setDraft(id, { status: 'sent', sentAt: this.now() })
    await this.deps
      .appendThread({ id: `text-sent:${id}`, role: 'assistant', text: `Sent to ${draft.toName}: ${text}`, textSent: true })
      .catch((error: unknown) => console.warn('Sent text could not be saved in ADAM’s thread:', error))
    return this.result()
  }

  discardDraft(id: string): TextIntakeResult {
    const draft = this.state().drafts.find((d) => d.id === id)
    if (!draft || (draft.status !== 'pending' && draft.status !== 'failed')) {
      return this.result('That draft is no longer waiting.')
    }
    this.setDraft(id, { status: 'discarded' })
    return this.result()
  }
}

let current: TextIntake | null = null

export function setTextIntake(next: TextIntake | null): void {
  current = next
}

export function textIntake(): TextIntake | null {
  return current
}
