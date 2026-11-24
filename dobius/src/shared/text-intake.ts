// Shared contract for text intake (build plan 7.17): texts from tracked
// contacts become SUGGESTED cards, and ADAM's drafted texts wait for Carson's
// Send click. Built source-neutral so Gmail intake (8.18) can reuse it.
// Every incoming text here is UNTRUSTED data: shown and stored, never an
// instruction to a model and never a trigger for any action.

export const TEXT_INTAKE_MAX_TEXT = 1_000
export const TEXT_INTAKE_MAX_RECORDS = 500
export const TEXT_INTAKE_MAX_CONTACTS = 100
export const TRACKED_CONTACT_NAME_MAX = 60
export const TEXT_DRAFT_MAX_CHARS = 1_000

export type IntakeSource = 'imessage'

/** Someone Carson wants watched: their handle (phone or email) and the name he knows them by. */
export type TrackedContact = {
  handle: string
  name: string
  /** chat.db's newest row when tracking began: only texts after it are read. Main sets it. */
  startRowid?: number
}

/** One incoming message from a tracked contact, already secret-filtered and capped. */
export type IntakeRecord = {
  /** The message's own id (chat.db guid, else `rowid:<n>`): the dedupe key. */
  id: string
  source: IntakeSource
  contactHandle: string
  contactName: string
  receivedAt: number
  text: string
}

export type IntakeSuggestionStatus = 'pending' | 'accepted' | 'dismissed'

/** A card the rules think a text asks for. Nothing reaches the board until Accept. */
export type IntakeSuggestion = {
  id: string
  /** Link back: the IntakeRecord id (the message id). */
  messageId: string
  source: IntakeSource
  contactName: string
  contactHandle: string
  title: string
  text: string
  createdAt: number
  status: IntakeSuggestionStatus
  /** The backlog card made on Accept. */
  taskId?: string
}

export type TextDraftStatus = 'pending' | 'sending' | 'sent' | 'discarded' | 'failed'

/** A text ADAM drafted for Carson. It is only sent when Carson clicks Send. */
export type TextDraft = {
  id: string
  toName: string
  toHandle: string
  text: string
  createdAt: number
  status: TextDraftStatus
  sentAt?: number
  error?: string
  /** In the view only: binds Send to this exact id, recipient and text as shown. */
  fingerprint?: string
}

/** What the review list shows: open suggestions and drafts, plus the contact list. */
export type TextIntakeView = {
  contacts: TrackedContact[]
  suggestions: IntakeSuggestion[]
  drafts: TextDraft[]
}

export type TextIntakeResult = { ok: true; view: TextIntakeView } | { ok: false; error: string; view: TextIntakeView }
