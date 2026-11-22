import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const ACCOUNT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['accounts', 'list'],
    summary: 'List the Claude and Codex accounts and which one is in use',
    usage: 'dobius accounts list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: ['Refreshes each account’s usage first, like opening the Accounts page.'],
    examples: ['dobius accounts list', 'dobius accounts list --json']
  },
  {
    path: ['accounts', 'use'],
    summary: 'Switch the Claude or Codex account new agents use',
    usage: 'dobius accounts use (--claude <id|system> | --codex <id|system>) [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'claude', 'codex'],
    notes: [
      'Ids come from `dobius accounts list`. system means the account signed in outside Dobius+.',
      'Adding, signing in again and removing accounts stay in the app.'
    ],
    examples: ['dobius accounts use --claude 3f2a...', 'dobius accounts use --codex system']
  }
]
