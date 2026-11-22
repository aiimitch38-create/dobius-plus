import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

// Why `tabs` (plural): `dobius tab ...` already means tabs of the embedded browser.
export const TABS_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['tabs', 'list'],
    summary: 'List the workspace tabs (terminals, files, browser pages) of a worktree, or of all',
    usage: 'dobius tabs list [--worktree <selector> | --all] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'all'],
    notes: [
      'Without --worktree or --all, lists the tabs of the worktree that encloses the current directory.',
      'Terminal tabs show their terminal handle once running; use it with dobius terminal read/send.',
      'Read-only. These are workspace tabs; for embedded browser tabs use dobius tab list.'
    ],
    examples: ['dobius tabs list --json', 'dobius tabs list --all --json']
  },
  {
    path: ['tabs', 'activate'],
    summary: 'Bring a workspace tab to the front in the Dobius+ window',
    usage: 'dobius tabs activate --tab <tabId> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'tab', 'worktree'],
    notes: [
      '--tab takes the id shown by dobius tabs list (or $DOBIUS_TAB_ID). A stopped terminal tab is started again.',
      'This switches what Carson sees on screen; only use it when asked to show something.'
    ],
    examples: ['dobius tabs activate --tab tab_abc --worktree active --json']
  }
]
