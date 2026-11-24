// Quick hands: simple spoken requests on a live call that main answers on its
// own, in milliseconds, instead of a full ADAM (Hermes) turn. Why strict
// patterns: a request that only looks simple must still reach ADAM, so every
// doubt (odd phrasing, no terminal or several terminals by that name) returns
// null and the request goes to him unchanged. Nothing here closes, switches
// or changes settings, and nothing is ever submitted: the only write is typing
// text the request spelled out, and Enter is never pressed. Looking something
// up reads the local library only.

import type { LibraryHit } from '../library/library-types'
import { libraryAnswer, matchLibraryLookup, type LibraryLookup } from './live-voice-library-hand'
import { matchTerminals, whichOneQuestion, type QuickTerminal } from './live-voice-terminal-target'
import { lastOutputLine, looksSecret, shortForSpeech } from './live-voice-terminal-text'

export type { QuickTerminal } from './live-voice-terminal-target'
export { lastSpokenLine, looksSecret } from './live-voice-terminal-text'
export type QuickTerminalList = { terminals: QuickTerminal[]; truncated: boolean }

/** Thrown when nothing reached the terminal: ADAM may take the request instead. */
export class QuickHandRefused extends Error {}
/** Thrown when the call ended before anything reached the terminal. */
export class QuickHandCancelled extends Error {}

export type QuickHandsDeps = {
  listTerminals: () => Promise<QuickTerminalList>
  /**
   * Types the text and never presses Enter. Throws QuickHandRefused or
   * QuickHandCancelled when nothing was written; any other error means part
   * of the text may have been written.
   */
  typeInto: (handle: string, text: string, isCurrent: () => boolean) => Promise<void>
  /** The terminal's most recent output lines, oldest first. */
  readTail: (handle: string) => Promise<string[]>
  /** Claude's estimated spend over the last 7 days from the local usage scan; null when unknown. */
  weekUsage?: () => Promise<{ costUsd: number; sessions: number } | null>
  /**
   * The local library's best hits (the search `dobius library search` runs);
   * null when the library is off, not indexed yet, or cannot be read.
   */
  searchLibrary?: (query: string, everyWord: boolean) => Promise<LibraryHit[] | null>
}

export type QuickIntent =
  | { hand: 'list-terminals' }
  | { hand: 'type'; text: string; target: string }
  | { hand: 'read-terminal'; target: string; exact: boolean }
  | { hand: 'usage'; today: boolean }
  | LibraryLookup

export type TerminalIntent = Extract<QuickIntent, { hand: 'type' | 'read-terminal' }>

/** A "which one?" asked instead of acting: the intent waits for the answer. */
export type QuickAsk = { intent: TerminalIntent; candidates: QuickTerminal[] }

export type QuickHandResult =
  | { name: string; speak: string; cancelled?: false; ask?: QuickAsk }
  | { name: string; speak: ''; cancelled: true }

const MAX_NAMED = 5
const MAX_TYPED_CHARS = 500
const MAX_TARGET_WORDS = 7

// Words that point at something, not name a terminal ("what's it doing").
const NOT_A_NAME = new Set([
  'it',
  'that',
  'this',
  'he',
  'she',
  'they',
  'them',
  'everything',
  'everyone',
  'anything',
  'something',
  'you',
  'adam',
  'the terminal',
  'my terminal',
  'the tab'
])

const LEAD =
  /^(?:(?:hey|ok|okay)\s+adam|adam|hey|ok|okay|so|please|can you|could you|would you|will you)\s*,?\s+/i
const TRAIL = /(?:,?\s+(?:please|for me|thanks|thank you))?[.!?]*$/i

/**
 * The request without a leading wake word or politeness and without end
 * punctuation, as a slice of the original (casing and spacing kept), so a
 * typed payload can be cut from it by offsets.
 */
export function coreOfRequest(request: string): string {
  let text = request.trim()
  for (let i = 0; i < 4; i += 1) {
    const lead = LEAD.exec(text)
    if (!lead) {
      break
    }
    text = text.slice(lead[0].length)
  }
  const trail = TRAIL.exec(text)
  return (trail ? text.slice(0, trail.index) : text).trim()
}

/** Lowercased core with single spaces, for matching only. */
export function normalizeRequest(request: string): string {
  return coreOfRequest(request).replace(/\s+/g, ' ').toLowerCase()
}

const LIST_PATTERNS = [
  /^(?:how many|what|which)\s+(?:terminals|terminal tabs|consoles)\s+(?:are|do i have|have i got|do we have|have we got)\s+(?:open|running|up)(?:\s+(?:right now|now))?$/,
  /^how many\s+(?:terminals|terminal tabs|consoles)\s+(?:are there|do i have|have i got|are open)$/,
  /^(?:list|name)\s+(?:all\s+)?(?:my|the)?\s*(?:open\s+)?(?:terminals|terminal tabs|consoles)$/
]

const USAGE_PATTERNS = [
  /^how much\s+(?:have|did|has)\s+(?:i|we)\s+(?:spent|spend|used)(?:\s+(?:today|so far|this week|on claude|on ai))*$/,
  /^how much\s+(?:money\s+)?(?:have|did)\s+(?:i|we)\s+(?:spent|spend)\s+(?:on claude|on ai)(?:\s+(?:today|so far|this week))?$/,
  /^(?:what(?:'s| is)\s+)?(?:my|our)\s+(?:claude\s+)?(?:usage|spend|spending)(?:\s+(?:today|so far|this week))?$/,
  /^(?:check|tell me)\s+(?:my|our)\s+(?:claude\s+)?(?:usage|spend|spending)(?:\s+(?:today|so far|this week))?$/
]

// Why only these: "how much have I spent" alone may mean money anywhere; the
// local scan only knows Claude.
const USAGE_WORDS = /\b(?:claude|ai|tokens?|usage)\b/

// An ask to submit what was typed, after the terminal name: quick hands never
// press Enter, so ADAM takes it. Why only at the end: inside the payload the
// words are just text to type, and a terminal may be called "Submit SMIDs".
const SUBMIT_SUFFIX = /[\s,]+(?:and|then)\s+(?:send it|send that|press (?:enter|return)|hit (?:enter|return)|submit(?: it)?|run it|run that|execute it)$/i

/** The spoken name of a terminal, without "the" and a trailing "terminal" or "tab". */
function cleanTarget(raw: string): string | null {
  const target = raw
    .trim()
    .replace(/^(?:the|my)\s+/, '')
    .replace(/\s+(?:terminal|tab|console)$/, '')
    .trim()
  if (target.length < 2 || NOT_A_NAME.has(target)) {
    return null
  }
  if (target.split(' ').length > MAX_TARGET_WORDS) {
    return null
  }
  return target
}

const QUOTES: Record<string, string> = { '"': '"', "'": "'", '“': '”', '‘': '’' }

/** Drops one pair of quotes around the whole payload; everything else is kept as said. */
function unquote(text: string): string {
  const close = QUOTES[text[0] ?? '']
  return close && text.length >= 2 && text.endsWith(close) ? text.slice(1, -1) : text
}

/**
 * "type <text> into|in <terminal>", cut from the original request by offsets
 * so the typed text is exactly what was said.
 */
function matchType(request: string): Extract<QuickIntent, { hand: 'type' }> | null {
  const core = coreOfRequest(request)
  const lowered = core.replace(/\s+/g, ' ').toLowerCase()
  if (!/^type\s/i.test(core) || SUBMIT_SUFFIX.test(core)) {
    return null
  }
  // "type up a plan", "type out the steps": writing, not typing into a terminal.
  if (/^type (?:up|out|in|something|a (?:plan|summary|note|message|list|description))\b/.test(lowered)) {
    return null
  }
  // Why the LAST " into ": the typed text may itself say "in". Without
  // "into", only one " in " is clear: "type ls in terminal 1 in smid" could
  // split two ways (a project may follow the name), so ADAM takes it.
  const split =
    /^type\s+([\s\S]*\S)\s+into\s+(\S[\s\S]*)$/i.exec(core) ??
    ((core.match(/\sin\s/gi) ?? []).length === 1
      ? /^type\s+([\s\S]*\S)\s+in\s+(\S[\s\S]*)$/i.exec(core)
      : null)
  if (!split) {
    return null
  }
  const typed = unquote(split[1])
  const target = cleanTarget(split[2].replace(/\s+/g, ' ').toLowerCase())
  if (
    !typed.trim() ||
    // oxlint-disable-next-line no-control-regex -- a control character could submit or escape; refuse it
    /[\u0000-\u001F\u007F]/.test(typed) ||
    !target ||
    typed.length > MAX_TYPED_CHARS
  ) {
    return null
  }
  return { hand: 'type', text: typed, target }
}

function matchRead(text: string): QuickIntent | null {
  const doing =
    /^what(?:'s| is)\s+(.+?)\s+(?:doing|up to|saying|showing)(?:\s+(?:right now|now))?$/.exec(text)
  if (doing) {
    const target = cleanTarget(doing[1])
    return target ? { hand: 'read-terminal', target, exact: false } : null
  }
  const read = /^read(?:\s+me)?\s+(?:the\s+)?((?:last line|output)\s+(?:of|from|in)\s+)?(.+)$/.exec(
    text
  )
  if (!read) {
    return null
  }
  const raw = read[2].trim()
  const named =
    Boolean(read[1]) || /\s(?:terminal|tab|console)$/.test(raw) || raw.endsWith("'s output")
  const target = cleanTarget(raw.replace(/'s output$/, ''))
  if (!target) {
    return null
  }
  // Why exact for a bare "read X": "read the readme" must not read a terminal
  // whose title merely contains "readme".
  return { hand: 'read-terminal', target, exact: !named }
}

/** Which quick hand a request asks for, or null when ADAM should handle it. */
export function matchQuickHand(request: string): QuickIntent | null {
  const text = normalizeRequest(request)
  if (!text || text.length > MAX_TYPED_CHARS + 80) {
    return null
  }
  if (LIST_PATTERNS.some((pattern) => pattern.test(text))) {
    return { hand: 'list-terminals' }
  }
  if (USAGE_WORDS.test(text) && USAGE_PATTERNS.some((pattern) => pattern.test(text))) {
    return { hand: 'usage', today: /\btoday\b/.test(text) }
  }
  if (/^type\s/.test(text)) {
    return matchType(request)
  }
  return matchLibraryLookup(text) ?? matchRead(text)
}

function money(usd: number): string {
  return usd >= 100 ? `$${Math.round(usd)}` : `$${usd.toFixed(2)}`
}

const CANCELLED = Symbol('cancelled')
type Said = string | typeof CANCELLED

/** Does what a terminal intent asks, on the one terminal it means. */
async function actOn(
  intent: TerminalIntent,
  terminal: QuickTerminal,
  deps: QuickHandsDeps,
  isCurrent: () => boolean
): Promise<Said> {
  if (intent.hand === 'type') {
    try {
      await deps.typeInto(terminal.handle, intent.text, isCurrent)
    } catch (error) {
      if (error instanceof QuickHandCancelled) {
        return CANCELLED
      }
      if (error instanceof QuickHandRefused) {
        throw error
      }
      // Why not ADAM: some text may already be in the terminal, and a retry
      // would type it twice.
      return `I may have typed part of that into ${terminal.name}; check it.`
    }
    return `Typed it into ${terminal.name}.`
  }
  const line = lastOutputLine(await deps.readTail(terminal.handle))
  if (!isCurrent()) {
    return CANCELLED
  }
  if (!line) {
    return `${terminal.name} has no output yet.`
  }
  // Why the whole line: a key past the cut would still be read in part.
  return looksSecret(line)
    ? `${terminal.name}'s last line looks like it has a secret, so I won't read it out.`
    : `${terminal.name} last showed: ${shortForSpeech(line)}`
}

async function runIntent(
  intent: QuickIntent,
  deps: QuickHandsDeps,
  isCurrent: () => boolean
): Promise<Said | { speak: string; ask: QuickAsk } | null> {
  switch (intent.hand) {
    case 'list-terminals': {
      const { terminals, truncated } = await deps.listTerminals()
      if (!isCurrent()) {
        return CANCELLED
      }
      if (terminals.length === 0) {
        return 'No terminals are open.'
      }
      const names = terminals.slice(0, MAX_NAMED).map((terminal) => terminal.name)
      const extra = terminals.length - names.length
      const more = extra > 0 ? `, and ${extra} more` : ''
      const total = truncated ? `At least ${terminals.length}` : `${terminals.length}`
      const count =
        terminals.length === 1 && !truncated ? 'One terminal is open' : `${total} terminals are open`
      return `${count}: ${names.join(', ')}${more}.`
    }
    case 'type':
    case 'read-terminal': {
      const list = await deps.listTerminals()
      if (!isCurrent()) {
        return CANCELLED
      }
      // Why exact and complete for typing: it goes to one terminal only, so
      // the spoken name must be that terminal's whole label, and a cut-off
      // list could hide a second terminal with the same label.
      if (intent.hand === 'type' && list.truncated) {
        return null
      }
      const exact = intent.hand === 'type' || intent.exact
      const hits = matchTerminals(list.terminals, intent.target, exact ? 'exact' : 'words')
      if (hits.length === 1) {
        return actOn(intent, hits[0], deps, isCurrent)
      }
      const question = whichOneQuestion(hits)
      return question ? { speak: question, ask: { intent, candidates: hits } } : null
    }
    case 'usage': {
      const usage = deps.weekUsage ? await deps.weekUsage() : null
      if (!isCurrent()) {
        return CANCELLED
      }
      if (!usage) {
        return null
      }
      const sessions = usage.sessions === 1 ? '1 session' : `${usage.sessions} sessions`
      const today = intent.today ? ' There is no separate total for today.' : ''
      return `About ${money(usage.costUsd)} on Claude over the last 7 days, across ${sessions}.${today}`
    }
    case 'look-up': {
      if (!deps.searchLibrary) {
        return null
      }
      const hits = await deps.searchLibrary(intent.query, !intent.explicit)
      return isCurrent() ? libraryAnswer(intent, hits) : CANCELLED
    }
  }
}

function resultOf(name: string, said: Awaited<ReturnType<typeof runIntent>>): QuickHandResult | null {
  if (said === CANCELLED) {
    return { name, speak: '', cancelled: true }
  }
  if (said && typeof said === 'object') {
    return { name, speak: said.speak, ask: said.ask }
  }
  return said ? { name, speak: said } : null
}

/**
 * Answers the request with a quick hand, or null so ADAM handles it.
 * `isCurrent` is false once the call that asked has ended: then nothing is
 * written and the result is `cancelled`, never a hand-off to ADAM. A result
 * with `ask` is a "which one?" question; nothing was done yet.
 */
export async function runQuickHand(
  request: string,
  deps: QuickHandsDeps,
  isCurrent: () => boolean = () => true
): Promise<QuickHandResult | null> {
  const intent = matchQuickHand(request)
  return intent ? resultOf(intent.hand, await runIntent(intent, deps, isCurrent)) : null
}

/**
 * Finishes an intent after "which one?" was answered with `handle`. Null
 * (ADAM takes it) when that terminal is no longer listed.
 */
export async function runQuickHandOn(
  intent: TerminalIntent,
  handle: string,
  deps: QuickHandsDeps,
  isCurrent: () => boolean
): Promise<QuickHandResult | null> {
  const { terminals } = await deps.listTerminals()
  if (!isCurrent()) {
    return resultOf(intent.hand, CANCELLED)
  }
  const terminal = terminals.find((candidate) => candidate.handle === handle)
  return terminal ? resultOf(intent.hand, await actOn(intent, terminal, deps, isCurrent)) : null
}
