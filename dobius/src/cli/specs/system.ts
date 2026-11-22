import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const SYSTEM_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['ports'],
    summary: 'List listening ports and which worktree runs each one',
    usage: 'dobius ports [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree'],
    notes: [
      'kind is workspace (started from a worktree), container, or external (another app or the system).',
      '--worktree keeps only the ports that worktree owns. Read-only.'
    ],
    examples: ['dobius ports --json', 'dobius ports --worktree active --json']
  },
  {
    path: ['ports', 'kill'],
    summary: "Stop the process listening on a port, only if the worktree's own process owns it",
    usage: 'dobius ports kill --worktree <selector> --port <n> [--pid <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'port', 'pid'],
    notes: [
      'Refused unless the listener was started from that worktree: ports of other worktrees, other apps, containers and the system are never stopped.',
      'Dobius re-checks the owner right before it sends the stop signal (SIGTERM).',
      'If more than one process listens on the port, pass --pid (see dobius ports).'
    ],
    examples: ['dobius ports kill --worktree active --port 5173 --json']
  },
  {
    path: ['skills', 'list'],
    summary: 'List the agent skills Dobius+ can find (home folder and registered repos)',
    usage: 'dobius skills list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: ['Read-only.'],
    examples: ['dobius skills list --json']
  },
  {
    path: ['system'],
    summary: 'Show disk and storage health from the system monitor',
    usage: 'dobius system [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: ['configured is false when the system monitor is not running. Read-only.'],
    examples: ['dobius system --json']
  },
  {
    path: ['preflight'],
    summary: 'Check the tools Dobius+ needs (git, gh, glab and others) and whether they are signed in',
    usage: 'dobius preflight [--force] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'force'],
    notes: ['Answers come from a cache; --force checks again now. Read-only.'],
    examples: ['dobius preflight --json', 'dobius preflight --force --json']
  }
]
