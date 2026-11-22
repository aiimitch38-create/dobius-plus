// Quick hands: simple spoken requests on a live call that main answers on its
// own, in milliseconds, instead of a full ADAM (Hermes) turn. Why strict
// patterns: a request that only looks simple must still reach ADAM, so every
// doubt (odd phrasing, no terminal or several terminals by that name) returns
// null and the request goes to him unchanged. Nothing here closes, switches
// or changes settings; the only write is typing text the request spelled out.
import { checkExecutionAdmission } from '../agents/execution-gate'
import type { RuntimeTerminalRead, RuntimeTerminalSummary } from '../../shared/runtime-types'
import { usageSummaryForRuntime } from '../ipc/usage-access'

export type QuickTerminal = { handle: string; name: string }

export type QuickHandsDeps = {
  listTerminals: () => Promise<QuickTerminal[]>
  /** Types the text; presses Enter only when `enter` is true. */
  typeInto: (handle: string, text: string, enter: boolean) => Promise<void>
  /** The terminal's most recent output lines, oldest first. */
  readTail: (handle: string) => Promise<string[]>
  /** Claude's estimated spend over the last 7 days from the local usage scan; null when unknown. */
  weekUsage?: () => Promise<{ costUsd: number; sessions: number } | null>
}

export type QuickHandResult = { name: string; speak: string }

export type QuickIntent =
  | { hand: 'list-terminals' }
  | { hand: 'type'; text: string; target: string; enter: boolean }
  | { hand: 'read-terminal'; target: string; exact: boolean }
  | { hand: 'usage'; today: boolean }

const MAX_NAMED = 5
const MAX_READ_CHARS = 150
const MAX_TYPED_CHARS = 500
const MAX_TARGET_WORDS = 5

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

/** Lowercased, without a leading wake word or politeness and without end punctuation. */
export function normalizeRequest(request: string): string {
  let text = request.trim().replace(/\s+/g, ' ')
  text = text.replace(/[.!?]+$/, '').trim()
  const lead = /^(?:(?:hey|ok|okay)\s+adam|adam|hey|ok|okay|so|please|can you|could you|would you|will you)\s*,?\s+/i
  for (let i = 0; i < 4 && lead.test(text); i += 1) {
    text = text.replace(lead, '')
  }
  text = text.replace(/,?\s+(?:please|for me|thanks|thank you)$/i, '')
  return text
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

const ENTER_SUFFIX = /\s*,?\s+(?:and|then)\s+(?:send it|press enter|hit enter|press return|hit return)$/

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

function unquote(text: string): string {
  const quoted = /^["'“‘](.*)["'”’]$/.exec(text.trim())
  return (quoted ? quoted[1] : text).trim()
}

function matchType(text: string): Extract<QuickIntent, { hand: 'type' }> | null {
  if (!/^type\s/.test(text)) {
    return null
  }
  let body = text.slice(5).trim()
  // "type up a plan", "type out the steps": writing, not typing into a terminal.
  if (/^(?:up|out|in|something|a\s+(?:plan|summary|note|message|list|description))\b/.test(body)) {
    return null
  }
  const enter = ENTER_SUFFIX.test(body)
  body = body.replace(ENTER_SUFFIX, '')
  // Why the LAST " into " (else the last " in "): the typed text may itself say "in".
  let at = body.lastIndexOf(' into ')
  let sepLength = 6
  if (at < 0) {
    at = body.lastIndexOf(' in ')
    sepLength = 4
  }
  if (at <= 0) {
    return null
  }
  const typed = unquote(body.slice(0, at))
  const target = cleanTarget(body.slice(at + sepLength))
  if (!typed || !target || typed.length > MAX_TYPED_CHARS) {
    return null
  }
  return { hand: 'type', text: typed, target, enter }
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
  const text = normalizeRequest(request).toLowerCase()
  if (!text || text.length > MAX_TYPED_CHARS + 80) {
    return null
  }
  if (LIST_PATTERNS.some((pattern) => pattern.test(text))) {
    return { hand: 'list-terminals' }
  }
  if (USAGE_PATTERNS.some((pattern) => pattern.test(text))) {
    return { hand: 'usage', today: /\btoday\b/.test(text) }
  }
  const typed = matchType(text)
  if (typed) {
    // The typed text keeps Carson's casing; only the matching was lowercased.
    return { ...typed, text: originalCase(request, typed.text) }
  }
  return matchRead(text)
}

/** The same span of the original request, so "type ls -A" keeps its capital. */
function originalCase(request: string, lowered: string): string {
  const at = request.toLowerCase().indexOf(lowered)
  return at >= 0 ? request.slice(at, at + lowered.length) : lowered
}

function words(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** The one terminal whose name contains the spoken name as whole words; null for none or several. */
export function findTerminal(
  terminals: QuickTerminal[],
  target: string,
  exact = false
): QuickTerminal | null {
  const wanted = words(target)
  if (!wanted) {
    return null
  }
  const found = terminals.filter((terminal) => {
    const name = words(terminal.name)
    return exact ? name === wanted : ` ${name} `.includes(` ${wanted} `)
  })
  return found.length === 1 ? found[0] : null
}

// oxlint-disable-next-line no-control-regex -- stripping terminal escapes is the point
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-_]/g

/** The last output line with a letter or digit, without escapes, short enough to say. */
export function lastSpokenLine(lines: string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    // oxlint-disable-next-line no-control-regex -- removing control characters is the point
    const line = lines[i].replace(ANSI, '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()
    if (/[A-Za-z0-9]/.test(line)) {
      return line.length > MAX_READ_CHARS ? `${line.slice(0, MAX_READ_CHARS - 1).trimEnd()}…` : line
    }
  }
  return null
}

/**
 * Keeps typed text on one line with no control characters. Why: a newline
 * or carriage return would submit it, and Enter is pressed only when asked.
 */
function typeable(text: string): string {
  // oxlint-disable-next-line no-control-regex -- removing control characters is the point
  return text.replace(/[\u0000-\u001F\u007F]+/g, ' ').trim()
}

function money(usd: number): string {
  return usd >= 100 ? `$${Math.round(usd)}` : `$${usd.toFixed(2)}`
}

async function runIntent(intent: QuickIntent, deps: QuickHandsDeps): Promise<string | null> {
  switch (intent.hand) {
    case 'list-terminals': {
      const terminals = await deps.listTerminals()
      if (terminals.length === 0) {
        return 'No terminals are open.'
      }
      const names = terminals.slice(0, MAX_NAMED).map((terminal) => terminal.name)
      const more = terminals.length > MAX_NAMED ? `, and ${terminals.length - MAX_NAMED} more` : ''
      const count = terminals.length === 1 ? 'One terminal is open' : `${terminals.length} terminals are open`
      return `${count}: ${names.join(', ')}${more}.`
    }
    case 'type': {
      const text = typeable(intent.text)
      const terminal = findTerminal(await deps.listTerminals(), intent.target)
      if (!text || !terminal) {
        return null
      }
      await deps.typeInto(terminal.handle, text, intent.enter)
      return intent.enter ? `Typed it into ${terminal.name} and pressed Enter.` : `Typed it into ${terminal.name}.`
    }
    case 'read-terminal': {
      const terminal = findTerminal(await deps.listTerminals(), intent.target, intent.exact)
      if (!terminal) {
        return null
      }
      const line = lastSpokenLine(await deps.readTail(terminal.handle))
      return line ? `${terminal.name} last showed: ${line}` : `${terminal.name} has no output yet.`
    }
    case 'usage': {
      const usage = deps.weekUsage ? await deps.weekUsage() : null
      if (!usage) {
        return null
      }
      const sessions = usage.sessions === 1 ? '1 session' : `${usage.sessions} sessions`
      const today = intent.today ? ' There is no separate total for today.' : ''
      return `About ${money(usage.costUsd)} on Claude over the last 7 days, across ${sessions}.${today}`
    }
  }
}

/** Answers the request with a quick hand, or null so ADAM handles it. */
export async function runQuickHand(
  request: string,
  deps: QuickHandsDeps
): Promise<QuickHandResult | null> {
  const intent = matchQuickHand(request)
  if (!intent) {
    return null
  }
  const speak = await runIntent(intent, deps)
  return speak ? { name: intent.hand, speak } : null
}

/** The runtime calls the quick hands use; the same ones `dobius terminal list/send/read` serve. */
export type QuickHandsRuntime = {
  listTerminals: () => Promise<{ terminals: RuntimeTerminalSummary[] }>
  readTerminal: (handle: string, opts?: { limit?: number }) => Promise<RuntimeTerminalRead>
  sendTerminal: (
    handle: string,
    action: { text?: string; enter?: boolean },
    options?: { beforeWrite?: (ptyId: string) => void | Promise<void> }
  ) => Promise<unknown>
  getDriver: (ptyId: string) => { kind: string }
  getTerminalAgentStatus: (
    handle: string
  ) => Promise<{ isRunningAgent: boolean; status: string | null }>
}

const READ_TAIL_LINES = 40
// Why a pause: matches the Board loop's paste-then-submit pacing, so a TUI
// sees the text before the Enter.
const SUBMIT_DELAY_MS = 50

/** Quick hands backed by the live runtime and the Claude usage store. */
export function createRuntimeQuickHands(
  getRuntime: () => QuickHandsRuntime | null,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): QuickHandsDeps {
  const runtime = (): QuickHandsRuntime => {
    const current = getRuntime()
    if (!current) {
      throw new Error('runtime not ready')
    }
    return current
  }
  // Why refuse: while a phone drives the terminal, desktop input is locked
  // (the same rule terminal.send applies to desktop callers).
  const notPhoneDriven = (ptyId: string): void => {
    if (runtime().getDriver(ptyId).kind === 'mobile') {
      throw new Error('terminal is driven from the phone')
    }
  }
  return {
    listTerminals: async () =>
      (await runtime().listTerminals()).terminals.map((terminal) => ({
        handle: terminal.handle,
        name: terminal.title?.trim() || terminal.branch || 'terminal'
      })),
    typeInto: async (handle, text, enter) => {
      // Why these guards: a misheard request must never answer a permission
      // prompt, run a shell command, or act while the crew is paused. A throw
      // hands the request to ADAM, whose own gates decide.
      const agent = await runtime().getTerminalAgentStatus(handle)
      if (agent.status === 'permission') {
        throw new Error('terminal is waiting on a permission prompt')
      }
      if (enter) {
        if (!agent.isRunningAgent) {
          throw new Error('Enter is only pressed for agent terminals, never a plain shell')
        }
        if (!checkExecutionAdmission('board-relay').allowed) {
          throw new Error('the crew is paused')
        }
      }
      await runtime().sendTerminal(handle, { text }, { beforeWrite: notPhoneDriven })
      if (enter) {
        await wait(SUBMIT_DELAY_MS)
        await runtime().sendTerminal(handle, { enter: true }, { beforeWrite: notPhoneDriven })
      }
    },
    readTail: async (handle) => (await runtime().readTerminal(handle, { limit: READ_TAIL_LINES })).tail,
    weekUsage: async () => {
      // Why no rescan (fresh = false): the last scan answers at once; a
      // rescan reads every session log and could take seconds.
      const result = await usageSummaryForRuntime('claude', 'all', '7d', false)
      const summary = result.summary as {
        estimatedCostUsd?: number | null
        sessions?: number
        hasAnyClaudeData?: boolean
      }
      if (!summary.hasAnyClaudeData || typeof summary.estimatedCostUsd !== 'number') {
        return null
      }
      return { costUsd: summary.estimatedCostUsd, sessions: summary.sessions ?? 0 }
    }
  }
}
