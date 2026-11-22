import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

const SETTABLE =
  'defaultTuiAgent, disabledTuiAgents, defaultTaskSource, visibleTaskProviders, defaultTaskViewPreset, experimentalNewWorktreeCardStyle, compactWorktreeCards, defaultRepoSelection, defaultLinearTeamSelection'

export const APP_UI_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['settings', 'get'],
    summary: 'Show the agent and task settings (secrets hidden)',
    usage: 'dobius settings get [<key>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'key'],
    positionalArgs: ['key'],
    notes: [
      'Agent commands, launch arguments and environment values are always hidden; only whether one is set is shown.',
      'Give a key to show only that setting.'
    ],
    examples: ['dobius settings get', 'dobius settings get defaultTuiAgent --json']
  },
  {
    path: ['settings', 'set'],
    summary: 'Change one setting from a short list of safe ones',
    usage: 'dobius settings set <key> <value> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'key', 'value'],
    positionalArgs: ['key', 'value'],
    notes: [
      `Only these keys can be changed here: ${SETTABLE}.`,
      'The value is JSON (true, null, ["a","b"]); a plain word is taken as text.',
      'Secrets, agent launch arguments and environment, Pause crew, the agent sandbox, auto-fix and live voice settings can only be changed in the app.'
    ],
    examples: [
      'dobius settings set defaultTuiAgent codex',
      'dobius settings set compactWorktreeCards true',
      'dobius settings set visibleTaskProviders \'["github","linear"]\''
    ]
  },
  {
    path: ['view', 'open'],
    summary: 'Show the Board, Tasks, Settings or a worktree in the Dobius+ window',
    usage: 'dobius view open <board|tasks|settings|worktree> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'view', 'worktree'],
    positionalArgs: ['view'],
    notes: [
      'Brings the Dobius+ window to the front and switches it, like the menu and keyboard shortcuts.',
      'worktree needs --worktree (for example active, branch:<name> or path:<folder>) and opens that workspace.',
      'Settings opens on its first page; a particular Settings page cannot be chosen yet.'
    ],
    examples: ['dobius view open board', 'dobius view open worktree --worktree branch:main']
  },
  {
    path: ['notify'],
    summary: 'Show a desktop notification',
    usage: 'dobius notify --title <title> --body <text> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'title', 'body'],
    notes: ['Title up to 120 characters, text up to 1000. Clicking it brings Dobius+ forward.'],
    examples: ['dobius notify --title "Build done" --body "All tests pass on main"']
  }
]
