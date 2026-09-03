import { execFile } from 'node:child_process'
import { readRecentTerminalActivity } from './terminal-history-context'

const DOBIUS_CLI = '/usr/local/bin/dobius'
const CLI_TIMEOUT_MS = 12_000
const MAX_OUTPUT_CHARS = 4_000

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

export async function buildAgentContext(historyRoot?: string): Promise<string> {
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
  return [
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
  ]
    .join('\n')
    .slice(0, MAX_OUTPUT_CHARS * 2)
}

const GREETINGS = ['Hey.', 'Yeah?', 'Go ahead.', 'Listening.', "What's up.", 'Right here.']

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
 * Why generated per call: a fixed first_message makes every conversation start
 * identically, which reads as canned. Grounding the opening in the terminal the
 * user actually touched last means it changes whenever their work changes, and
 * proves up front that this thing can see the machine.
 */
export function buildOpeningLine(
  historyRoot: string,
  now: number = Date.now(),
  greetings: string[] = GREETINGS
): string {
  const greeting = greetings[Math.floor(now / 60_000) % greetings.length]
  const [mostRecent] = readRecentTerminalActivity(historyRoot, 1)
  if (!mostRecent) {
    return `${greeting} Nothing running that I can see.`
  }
  const project = mostRecent.worktreePath.split('/').filter(Boolean).pop() ?? 'your project'
  return `${greeting} Last thing I saw was ${project}, ${describeAge(now - mostRecent.lastActiveAt)}.`
}
