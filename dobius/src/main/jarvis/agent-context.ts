import { execFile } from 'node:child_process'
import { classifyOutcome, matchedMarker } from './proactive-watcher'
import { readRecentTerminalActivity } from './terminal-history-context'

const DOBIUS_CLI = '/usr/local/bin/dobius'
const CLI_TIMEOUT_MS = 12_000
const MAX_OUTPUT_CHARS = 4_000
/** Hard ceiling on the contextual update pushed at connect. */
export const CONTEXT_BUDGET_CHARS = MAX_OUTPUT_CHARS * 2
/** The most of that ceiling the memory block may take. See composeAgentContext. */
export const MAX_MEMORY_CHARS = CONTEXT_BUDGET_CHARS / 2

/**
 * Command groups come from the CLI's own help output, not a hardcoded list.
 *
 * Why: a hand-maintained list drifted badly — it advertised groups that do not
 * exist (so Adam promised capabilities he lacked) while hiding the entire
 * browser-automation set (so he denied capabilities he had).
 */
let cachedGroups: Set<string> | null = null

export function parseCommandGroups(helpText: string): Set<string> {
  const groups = new Set<string>()
  for (const line of helpText.split('\n')) {
    const match = /^ {2}([a-z][a-z0-9-]*)\b.*\s{2,}\S/.exec(line)
    if (match) {
      groups.add(match[1])
    }
  }
  return groups
}

/**
 * Verbs refused regardless of group.
 *
 * Why a deny list on top of the group allow list: a misheard word must never
 * destroy a worktree, kill a running terminal, or wipe orchestration state.
 * Voice is a lossy channel — destructive actions stay a keyboard decision.
 */
const DENIED_VERBS = new Set([
  'rm',
  'remove',
  'delete',
  'reset',
  'stop',
  'close',
  'run-stop',
  'setup-delete',
  'set-base-ref'
])

export type CommandDecision = { allowed: true } | { allowed: false; reason: string }

export function decideDobiusCommand(args: string[], groups: Set<string>): CommandDecision {
  const [group, verb] = args
  if (!group) {
    return { allowed: false, reason: 'No command given.' }
  }
  // Bare flags are help/discovery — the prompt tells Adam to run --help, so
  // refusing it made the documented way to learn the CLI a dead end.
  if (group.startsWith('-')) {
    return { allowed: true }
  }
  if (!groups.has(group)) {
    return { allowed: false, reason: `"${group}" is not a dobius command.` }
  }
  if (verb && DENIED_VERBS.has(verb)) {
    return {
      allowed: false,
      reason: `"${group} ${verb}" is destructive and is keyboard-only. Tell the user to run it themselves.`
    }
  }
  return { allowed: true }
}

/** Splits a command string into argv, honouring simple double-quoted spans. */
export function parseCommandArgs(command: string): string[] {
  const matches = command.trim().match(/"[^"]*"|\S+/g) ?? []
  return matches.map((token) => token.replace(/^"|"$/g, ''))
}

function runCli(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      DOBIUS_CLI,
      args,
      { timeout: CLI_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        const output = `${stdout ?? ''}${stderr ?? ''}`.trim()
        if (error && !output) {
          resolve(`(failed: ${error.message})`)
          return
        }
        resolve(output.slice(0, MAX_OUTPUT_CHARS))
      }
    )
  })
}

async function loadCommandGroups(): Promise<Set<string>> {
  cachedGroups ??= parseCommandGroups(await runCli(['--help']))
  return cachedGroups
}

export async function runDobiusCommand(command: string): Promise<string> {
  const args = parseCommandArgs(command)
  const decision = decideDobiusCommand(args, await loadCommandGroups())
  if (!decision.allowed) {
    return decision.reason
  }
  return runCli(args)
}

/**
 * A compact snapshot of what the user is working on right now, pushed into the
 * conversation so the agent opens the call already knowing rather than having
 * to interrogate the user.
 */
/**
 * Numbers terminals the way the user counts them.
 *
 * Why: the CLI returns handles and titles but no position, so "pull up terminal
 * two" had no answer and the agent guessed. Numbering per worktree, in list
 * order, gives the spoken ordinal something real to resolve against.
 */
export function formatTerminalTabs(listJson: string): string {
  let terminals: {
    handle?: string
    title?: string
    worktreePath?: string
    worktreeId?: string
  }[]
  try {
    const parsed = JSON.parse(listJson) as {
      result?: { terminals?: typeof terminals }
    }
    terminals = parsed.result?.terminals ?? []
  } catch {
    return listJson
  }
  if (terminals.length === 0) {
    return '(no terminals open)'
  }
  const byWorktree = new Map<string, typeof terminals>()
  for (const terminal of terminals) {
    const key = terminal.worktreePath ?? 'unknown'
    const bucket = byWorktree.get(key)
    if (bucket) {
      bucket.push(terminal)
    } else {
      byWorktree.set(key, [terminal])
    }
  }
  const lines: string[] = []
  for (const [worktreePath, group] of byWorktree) {
    const selector = group[0]?.worktreeId ? `id:${group[0].worktreeId}` : `path:${worktreePath}`
    lines.push(`${worktreePath}   (worktree selector: "${selector}")`)
    group.forEach((terminal, index) => {
      lines.push(`  Terminal ${index + 1}: ${terminal.title ?? 'untitled'}   ${terminal.handle ?? ''}`)
    })
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

export async function buildAgentContext(
  historyRoot?: string,
  memoryBlock = ''
): Promise<string> {
  const [worktrees, terminalsJson, agents] = await Promise.all([
    runCli(['worktree', 'ps']),
    runCli(['terminal', 'list', '--json']),
    runCli(['agents', 'list'])
  ])
  const terminals = formatTerminalTabs(terminalsJson)
  const recent = historyRoot ? readRecentTerminalActivity(historyRoot, 3) : []
  const recentBlock = recent.length
    ? recent
        .map(
          (entry, index) =>
            `${index === 0 ? 'MOST RECENT' : 'then'}: ${entry.worktreePath} (last active ${new Date(entry.lastActiveAt).toISOString()})\n${entry.recentOutput || '(no output captured)'}`
        )
        .join('\n\n')
    : '(no terminal history found)'
  const machineState = [
    formatOpeningSection(getLastOpening(), Date.now()),
    '',
    '## What the user was doing most recently (newest first)',
    recentBlock,
    '',
    'Live context from the user\'s machine (Dobius+):',
    '',
    '## Worktrees and orchestration',
    worktrees || '(none)',
    '',
    '## Open terminal tabs (numbered as the user counts them)',
    terminals || '(none)',
    '',
    '## Agents',
    agents || '(none)'
  ].join('\n')

  return composeAgentContext(memoryBlock, machineState)
}

/**
 * Fits the memory block and the machine state into one bounded payload.
 *
 * Why the budget is SPLIT rather than the memory appended after a slice: the
 * agent prompt is already ~8,400 chars against this 8,000 cap, so appending
 * grows the payload without bound. Slicing a joined string with memory first
 * would instead let a full memory push the terminal context out entirely —
 * silently, because nothing errors. Reserving memory's actual size and
 * truncating only the machine state keeps the total bounded AND keeps both
 * blocks present.
 */
export function composeAgentContext(memoryBlock: string, machineState: string): string {
  // Memory may claim at most half the budget, so the machine state is always
  // left room. AdamMemory caps itself well under this, so the slice does not
  // fire in normal use — it is the boundary guard for a hand-edited
  // adam-memory.json, which is a file the user is invited to edit.
  const memory = memoryBlock.trim().slice(0, MAX_MEMORY_CHARS)
  if (!memory) {
    return machineState.slice(0, CONTEXT_BUDGET_CHARS)
  }
  const remaining = Math.max(0, CONTEXT_BUDGET_CHARS - memory.length - 2)
  return `${memory}\n\n${machineState.slice(0, remaining)}`
}

function describeAge(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) {
    return 'just now'
  }
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  }
  const hours = Math.round(minutes / 60)
  return `${hours} hour${hours === 1 ? '' : 's'} ago`
}

/**
 * The line the agent opens a call with.
 *
 * Why not one template with a rotating first word: that was the first version,
 * and every call read as `<greeting>. Last thing I saw was <project>, just
 * now.` Only the first two words moved, and "just now" is true almost always,
 * so six variants collapsed into one sentence the user heard every single time.
 *
 * What varies here is the SHAPE, chosen by which facts are actually true —
 * something broke, something passed, several terminals are live, the machine is
 * idle. Different situations produce different KINDS of sentence, which is what
 * makes it sound like someone looked before speaking.
 */
// Observation phrasing, not verdicts: the classifier is a substring heuristic
// and false-positives (the word "error" in ordinary output). "Looks like" is
// what a person who glanced at a terminal would honestly say.
const OPENERS_FAILED = [
  (p: string, age: string) => `Looks like something went wrong in ${p} ${age}.`,
  (p: string, age: string) => `Seeing failures in ${p} from ${age} — want me to dig in?`,
  (p: string, age: string) => `Heads up, ${p} may have hit an error ${age}.`
]

const OPENERS_PASSED = [
  (p: string, age: string) => `${p} came back clean ${age}.`,
  (p: string, age: string) => `${p} finished green ${age}.`,
  (p: string, age: string) => `That run in ${p} passed ${age}.`
]

const OPENERS_BUSY = [
  (p: string, n: number) => `${n} terminals going. ${p} is the loud one.`,
  (p: string, n: number) => `You've got ${n} running — ${p} most recently.`,
  (p: string, n: number) => `${n} live terminals. Last touch was ${p}.`
]

const OPENERS_RECENT = [
  (p: string, age: string) => `You were in ${p} ${age}.`,
  (p: string, age: string) => `${p}, ${age}. What do you need?`,
  (p: string, age: string) => `Still on ${p} — last move ${age}.`
]

const OPENERS_IDLE = ['Quiet in here.', 'Nothing running.', "Machine's idle.", 'All quiet.']

/** Spreads choices across the fact set rather than the clock. */
function pick<T>(list: T[], seed: number): T {
  return list[Math.abs(seed) % list.length]
}

export type OpeningRecord = {
  line: string
  project: string | null
  marker: string | null
  at: number
}

/**
 * The last opening line handed to the agent, so buildAgentContext can tell
 * the model what IT opened with and why. Without this the opening is a cue
 * card the model never saw itself write: asked "what broke?" it has no
 * evidence, and under pushback it re-attributes its own line to the user
 * (transcript conv_7801m191..., 2026-08-30).
 */
let lastOpening: OpeningRecord | null = null
const OPENING_FRESH_MS = 5 * 60_000

export function getLastOpening(): OpeningRecord | null {
  return lastOpening
}

/**
 * Always states the attribution rule (the opening/context calls race, so the
 * specific line may not be recorded yet); adds the line + evidence when fresh.
 */
export function formatOpeningSection(record: OpeningRecord | null, now: number): string {
  const lines = [
    '## Your opening line',
    'The first message of every call is YOUR opening line, generated from the',
    "terminal evidence below before the call connected. You said it — never",
    'attribute it to the user. If it mentions a failure or a pass, answer',
    'questions about it from the terminal output in this context.'
  ]
  if (record && now - record.at < OPENING_FRESH_MS) {
    lines.push(`You opened with: "${record.line}"`)
    if (record.project && record.marker) {
      lines.push(
        `That came from the word "${record.marker}" appearing in the recent output of ${record.project} — a heuristic, not a verdict. Check before asserting more.`
      )
    }
  }
  return lines.join('\n')
}

export function buildOpeningLine(historyRoot: string, now: number = Date.now()): string {
  const activities = readRecentTerminalActivity(historyRoot, 5)
  const [mostRecent] = activities
  // Seeded on real state, so the wording only repeats when the situation does.
  const seed = Math.floor(now / 60_000) + activities.length

  const record = (line: string, project: string | null, marker: string | null): string => {
    lastOpening = { line, project, marker, at: now }
    return line
  }

  if (!mostRecent) {
    return record(pick(OPENERS_IDLE, seed), null, null)
  }

  const project = mostRecent.worktreePath.split('/').filter(Boolean).pop() ?? 'your project'
  const age = describeAge(now - mostRecent.lastActiveAt)
  const outcome = classifyOutcome(mostRecent.recentOutput)
  const marker = outcome ? matchedMarker(mostRecent.recentOutput) : null

  if (outcome === 'failed') {
    return record(pick(OPENERS_FAILED, seed)(project, age), project, marker)
  }
  if (outcome === 'passed') {
    return record(pick(OPENERS_PASSED, seed)(project, age), project, marker)
  }

  const live = activities.filter((a) => now - a.lastActiveAt < 10 * 60_000).length
  if (live > 1) {
    return record(pick(OPENERS_BUSY, seed)(project, live), project, null)
  }
  return record(pick(OPENERS_RECENT, seed)(project, age), project, null)
}
