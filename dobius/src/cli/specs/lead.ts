import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

const WORKTREE_NOTE =
  '--worktree defaults to the worktree that contains the current directory (same as --worktree active).'

export const LEAD_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['lead', 'init'],
    summary: 'Write .dobius/ORCHESTRATOR.md and .dobius/lead.json into the worktree if missing',
    usage: 'dobius lead init [--worktree active] [--json]',
    allowedFlags: ['worktree', ...GLOBAL_FLAGS],
    notes: [
      'Never overwrites an existing file; rerun safely.',
      'ORCHESTRATOR.md is a short project layer appended to the bundled lead rules; it cannot loosen them.',
      'Warns when .gitignore would drop these files; add `.dobius/*`, `!.dobius/ORCHESTRATOR.md`, `!.dobius/lead.json`.',
      WORKTREE_NOTE
    ],
    examples: ['dobius lead init --worktree active']
  },
  {
    path: ['lead', 'start'],
    summary: 'Start the lead watcher: seed the Hermes lead profile and nudge it when cards arrive',
    usage: 'dobius lead start [--worktree active] [--json]',
    allowedFlags: ['worktree', ...GLOBAL_FLAGS],
    notes: [
      'Polls the work board every 30 s for To Do cards assigned to the lead profile from .dobius/lead.json.',
      'Opens one lead console on the Board and sends it card ids only; card text is never relayed.',
      'Remembered across restarts: Dobius starts this lead again on launch until `dobius lead stop`.',
      WORKTREE_NOTE
    ],
    examples: ['dobius lead start --worktree active --json']
  },
  {
    path: ['lead', 'stop'],
    summary: 'Stop the lead watcher for a worktree',
    usage: 'dobius lead stop [--worktree active] [--json]',
    allowedFlags: ['worktree', ...GLOBAL_FLAGS],
    notes: [
      'Leaves the lead console running; use `dobius terminal stop` to close it.',
      'Also clears the restart memory, so the lead stays stopped after Dobius relaunches.',
      WORKTREE_NOTE
    ],
    examples: ['dobius lead stop --worktree active']
  },
  {
    path: ['lead', 'status'],
    summary: 'Show running lead watchers',
    usage: 'dobius lead status [--worktree active] [--json]',
    allowedFlags: ['worktree', ...GLOBAL_FLAGS],
    notes: ['Without --worktree, lists every running lead watcher, each with its autostart flag.'],
    examples: ['dobius lead status --json']
  }
]
