import { translate } from '@/i18n/i18n'
import type { AgentStatusState } from '../../../../../shared/agent-status-types'

export type ConsoleCardStatus =
  | 'working'
  | 'waiting'
  | 'idle'
  | 'paused'
  /** The agent exited back to its shell; restart to work again. */
  | 'shell'
  /** The terminal process itself ended. */
  | 'done'
  /** The tab is gone (closed elsewhere). */
  | 'gone'

/** What runs in the terminal's foreground, as reported by the PTY layer. */
export type ConsoleForeground = 'agent' | 'shell' | 'exited' | null

/**
 * Foreground while the tab has no PTY. Why: the store drops a tab's PTY id when
 * the process exits, so "had a PTY, now none, tab still open" means it ended.
 */
export function foregroundWithoutPty(hadPty: boolean): ConsoleForeground {
  return hadPty ? 'exited' : null
}

export type ConsoleCardStatusInput = {
  tabExists: boolean
  /** Board-paused (process suspended) or hibernated by the sleep feature. */
  paused: boolean
  foreground: ConsoleForeground
  entry: { state: AgentStatusState; updatedAt: number } | undefined
  now: number
  staleAfterMs: number
}

const SHELL_NAMES = new Set([
  'zsh',
  'bash',
  'sh',
  'fish',
  'dash',
  'ksh',
  'tcsh',
  'csh',
  'nu',
  'pwsh',
  'powershell',
  'powershell.exe',
  'pwsh.exe',
  'cmd',
  'cmd.exe'
])

/** True when the PTY's foreground process is a plain shell (the agent is not running). */
export function isShellProcessName(name: string | null): boolean {
  if (!name) {
    return false
  }
  const base = name.trim().split(/[\\/]/).at(-1)?.replace(/^-/, '').toLowerCase() ?? ''
  return SHELL_NAMES.has(base)
}

// Why (per the Board status table): "done" only when the process ended; a
// finished agent turn is idle; needs-you only from a permission or question.
export function consoleCardStatus({
  tabExists,
  paused,
  foreground,
  entry,
  now,
  staleAfterMs
}: ConsoleCardStatusInput): ConsoleCardStatus {
  if (!tabExists) {
    return 'gone'
  }
  if (foreground === 'exited') {
    return 'done'
  }
  if (paused) {
    return 'paused'
  }
  if (foreground === 'shell') {
    return 'shell'
  }
  if (!entry || now - entry.updatedAt > staleAfterMs) {
    return 'idle'
  }
  switch (entry.state) {
    case 'working':
      return 'working'
    case 'blocked':
    case 'waiting':
      return 'waiting'
    case 'done':
      return 'idle'
  }
}

/** AgentStateDot state per console status; statuses without a dot render a plain muted dot. */
export const CONSOLE_STATUS_DOT: Partial<
  Record<ConsoleCardStatus, 'working' | 'waiting' | 'done' | 'idle'>
> = {
  working: 'working',
  waiting: 'waiting',
  done: 'done',
  idle: 'idle'
}

export function consoleStatusLabel(status: ConsoleCardStatus): string {
  switch (status) {
    case 'working':
      return translate('board.console.status.working', 'Working')
    case 'waiting':
      return translate('board.console.status.waiting', 'Needs you')
    case 'idle':
      return translate('board.console.status.idle', 'Idle')
    case 'paused':
      return translate('board.console.status.paused', 'Paused')
    case 'done':
      return translate('board.console.status.done', 'Ended')
    case 'shell':
      return translate('board.console.status.shell', 'At its shell')
    case 'gone':
      return translate('board.console.status.gone', 'Terminal closed')
  }
}

/** First leaf of a terminal layout tree; the card shows the tab's active pane, else its first. */
export function resolveConsoleLeafId(
  layout: { activeLeafId: string | null; root: LayoutNode | null } | undefined
): string | null {
  if (!layout) {
    return null
  }
  if (layout.activeLeafId) {
    return layout.activeLeafId
  }
  let node = layout.root
  while (node && node.type === 'split') {
    node = node.first
  }
  return node?.leafId ?? null
}

type LayoutNode =
  | { type: 'leaf'; leafId: string }
  | { type: 'split'; first: LayoutNode; second: LayoutNode }
