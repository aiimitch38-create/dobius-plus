import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'
import { SERVE_COMMAND_SPECS } from './serve'

export const CORE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['open'],
    summary: 'Launch Dobius+ and wait for the runtime to be reachable',
    usage: 'dobius open [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['dobius open', 'dobius open --json']
  },
  ...SERVE_COMMAND_SPECS,
  {
    path: ['status'],
    summary: 'Show app/runtime/graph readiness',
    usage: 'dobius status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['dobius status', 'dobius status --json']
  },
  {
    path: ['claude-teams'],
    summary: 'Start Claude Code Agent Teams in the current Dobius+ terminal',
    usage: 'dobius claude-teams [claude args...]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Passes all following arguments through to Claude Code after enabling Agent Teams native panes.',
      'Must be run from inside an Dobius+ terminal. Starts Claude Code Agent Teams in the current pane and opens teammates as native Dobius+ splits.'
    ],
    examples: ['dobius claude-teams', 'dobius claude-teams --resume <session-id>']
  },
  {
    path: ['repo', 'list'],
    summary: 'List repos registered in Dobius+',
    usage: 'dobius repo list [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['repo', 'add'],
    summary: 'Add a project to Dobius+ by filesystem path',
    usage: 'dobius repo add --path <path> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'path']
  },
  {
    path: ['repo', 'show'],
    summary: 'Show one registered repo',
    usage: 'dobius repo show --repo <selector> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo']
  },
  {
    path: ['repo', 'set-base-ref'],
    summary: "Set the repo's default base ref for future worktrees",
    usage: 'dobius repo set-base-ref --repo <selector> --ref <ref> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo', 'ref']
  },
  {
    path: ['repo', 'search-refs'],
    summary: 'Search branch/tag refs within a repo',
    usage: 'dobius repo search-refs --repo <selector> --query <text> [--limit <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo', 'query', 'limit']
  },
  {
    path: ['worktree', 'list'],
    summary: 'List Dobius+-managed worktrees',
    usage: 'dobius worktree list [--repo <selector>] [--limit <n>] [--sleeping] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo', 'limit', 'sleeping'],
    notes: [
      '--sleeping lists only worktrees with no live terminal (asleep), skipping archived ones.'
    ]
  },
  {
    path: ['worktree', 'show'],
    summary: 'Show one worktree',
    usage: 'dobius worktree show --worktree <selector> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree']
  },
  {
    path: ['worktree', 'current'],
    summary: 'Show the Dobius+-managed worktree for the current directory',
    usage: 'dobius worktree current [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Resolves the current shell directory to a path: selector so agents can target the enclosing Dobius+ worktree without spelling out $PWD.'
    ],
    examples: ['dobius worktree current', 'dobius worktree current --json']
  },
  {
    path: ['worktree', 'create'],
    summary: 'Create a new Dobius+-managed worktree',
    usage:
      'dobius worktree create --name <name> [--repo <selector>|--project <id> [--host <host-id>]|--project-host-setup <id>] [--agent <id>] [--prompt <text>] [--setup run|skip|inherit] [--base-branch <ref>] [--issue <number>] [--linear-issue <identifier-or-url>] [--comment <text>] [--parent-worktree <selector>] [--no-parent] [--run-hooks] [--activate] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'repo',
      'project',
      'host',
      'project-host-setup',
      'name',
      'agent',
      'prompt',
      'base-branch',
      'issue',
      'linear-issue',
      'comment',
      'setup',
      'parent-worktree',
      'no-parent',
      'run-hooks',
      'activate'
    ],
    notes: [
      'This creates a new checkout. For a fresh agent in an existing worktree, use `dobius terminal create --worktree active --command "codex"` instead.',
      'By default, Dobius+ records the new worktree as a child of the caller context when it can infer one from the Dobius+ terminal or current directory.',
      'If --repo is omitted, Dobius+ infers the repo from the current Dobius+-managed worktree.',
      'Use --project with --host to create on a ready project host setup without spelling the backing repo id.',
      'For related work, use the inferred parent or pass --parent-worktree active, folder:<id>, or worktree:<id> to make the relationship explicit.',
      'Use --no-parent when the new worktree should be independent of the current context.',
      '--no-parent only affects Dobius+ lineage; omit --base-branch to use the repo default base, or pass the default base ref explicitly for independent top-level work.',
      'By default this creates the worktree and its first terminal without switching the active Dobius+ view.',
      'Pass --agent to launch an agent in the first terminal; --prompt sends initial work to that agent.',
      'Repo-defined setup hooks follow the repository setup policy; pass --setup run to force them.',
      'Pass --activate when the CLI caller intentionally wants to reveal the new worktree in the app.',
      'Passing --run-hooks is kept as a legacy alias for --setup run and reveals the worktree.'
    ],
    examples: [
      'dobius worktree create --name agent-task --agent codex --prompt "hi" --json',
      'dobius worktree create --repo id:<repoId> --name related-task --json',
      'dobius worktree create --project github:statusdigitalmarketing/dobius-plus --host runtime:gpu --name benchmark --json',
      'dobius worktree create --repo id:<repoId> --name linear-task --linear-issue https://linear.app/stably/issue/STA-335/test-issue --json',
      'dobius worktree create --repo id:<repoId> --name agent-task --agent codex --prompt "hi" --json',
      'dobius worktree create --repo id:<repoId> --name folder-child --parent-worktree folder:<folderId> --json',
      'dobius worktree create --repo id:<repoId> --name related-task --parent-worktree active --json',
      'dobius worktree create --repo id:<repoId> --name independent-task --no-parent --json'
    ]
  },
  {
    path: ['worktree', 'set'],
    summary: 'Update Dobius+ metadata for a worktree',
    usage:
      'dobius worktree set --worktree <selector> [--display-name <name>] [--issue <number|null>] [--linear-issue <identifier-or-url|null>] [--comment <text>] [--workspace-status <id>] [--purpose <name>] [--parent-worktree <selector>|--no-parent] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'worktree',
      'display-name',
      'issue',
      'linear-issue',
      'comment',
      'workspace-status',
      'purpose',
      'parent-worktree',
      'no-parent'
    ],
    notes: [
      'Workspace status ids match the board columns (defaults: todo, in-progress, in-review, completed); custom statuses use their configured id.',
      'Purpose is a grouping label for the Board top bar and Source Control workspace view (defaults: Features, Backend, Research; any name works). Pass --purpose "" to move the worktree back to Other.',
      'Pass --linear-issue null to clear the Linear issue link.'
    ],
    examples: [
      'dobius worktree set --worktree active --linear-issue STA-335 --json',
      'dobius worktree set --worktree active --linear-issue null --json'
    ]
  },
  {
    path: ['worktree', 'rm'],
    summary: 'Remove a worktree from Dobius+ and git',
    usage: 'dobius worktree rm --worktree <selector> [--force] [--run-hooks] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'force', 'run-hooks'],
    notes: ['Repo-defined dobius.yaml archive hooks are skipped unless --run-hooks is passed.']
  },
  {
    path: ['worktree', 'sleep'],
    summary: 'Put a worktree to sleep: its terminals stop, agent sessions are saved for wake',
    usage: 'dobius worktree sleep --worktree <selector> [--force] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'force'],
    notes: [
      'Stops every terminal in that worktree (agents included). Agent sessions are saved so wake can resume them.',
      'Refuses the worktree the calling terminal runs in (it would stop itself mid-command) unless --force is passed.'
    ],
    examples: ['dobius worktree sleep --worktree branch:old-feature --json']
  },
  {
    path: ['worktree', 'wake'],
    summary: 'Wake a sleeping worktree (opens it in the app so its terminals start again)',
    usage: 'dobius worktree wake --worktree <selector> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree'],
    notes: ['Waking switches the Dobius+ window to that worktree, the same as clicking it.'],
    examples: ['dobius worktree wake --worktree branch:old-feature --json']
  },
  {
    path: ['worktree', 'ps'],
    summary: 'Show a compact orchestration summary across worktrees',
    usage: 'dobius worktree ps [--limit <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'limit']
  },
  {
    path: ['terminal', 'list'],
    summary: 'List live Dobius+-managed terminals',
    usage: 'dobius terminal list [--worktree <selector>] [--limit <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'limit']
  },
  {
    path: ['terminal', 'show'],
    summary: 'Show terminal metadata and preview',
    usage: 'dobius terminal show [--terminal <handle>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'terminal']
  },
  {
    path: ['terminal', 'read'],
    summary: 'Read bounded terminal output',
    usage:
      'dobius terminal read [--terminal <handle>] [--cursor <n>] [--limit <n>] [--screen] [--transcript] [--transcript-limit <n>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'terminal',
      'cursor',
      'limit',
      'screen',
      'transcript',
      'transcript-limit'
    ],
    notes: [
      'Omit --terminal to target the active terminal in the current worktree.',
      'Use --cursor with the nextCursor value from a previous read to get only new output since that read.',
      'Use --limit to request more retained lines for long agent responses; output reports oldestCursor when older lines were dropped.',
      'Useful for capturing the response to a command: read before sending, then read --cursor <prev> after waiting.',
      'The default output is a raw line log of the PTY stream. Full-screen agent TUIs (Claude Code, Codex) redraw in place, so that log can collapse to a few status rows.',
      '--screen adds what the terminal actually shows: the rendered screen plus retained scrollback (up to --limit lines), with redraws resolved. It reports when scrollback was evicted or never captured.',
      "--transcript adds the agent's recent user/assistant text messages from its own session transcript (default 10, max 200 via --transcript-limit). Tool calls, tool output and reasoning are excluded. It says why when no transcript is known."
    ],
    examples: [
      'dobius terminal read --json',
      'dobius terminal read --terminal term_abc123 --cursor 42 --limit 1000 --json',
      'dobius terminal read --terminal term_abc123 --screen --transcript --limit 200 --json'
    ]
  },
  {
    path: ['terminal', 'send'],
    summary: 'Send input to a live terminal',
    usage:
      'dobius terminal send [--terminal <handle|card:<id-or-title>|tab:<tabId>>] [--worktree <selector>] [--text <text>] [--enter] [--interrupt] [--expected-runtime-id <id>] [--require-agent-status sendable] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'terminal',
      'worktree',
      'text',
      'enter',
      'interrupt',
      'expected-runtime-id',
      'require-agent-status'
    ],
    notes: [
      '--terminal card:<id-or-title> targets a Board console card, looked up at send time; an unknown, ambiguous or not-running card is an error. Prefer the card id ($DOBIUS_BOARD_CARD_ID inside a console): titles can repeat. tab:<tabId> targets the running terminal of that tab ($DOBIUS_TAB_ID inside a terminal); a closed or stopped tab is an error. A tab id changes when a Board console restarts; the card id does not.',
      '--worktree picks the Board the card is on (default: the worktree enclosing the current directory). Without --terminal it picks the worktree whose active terminal is used.',
      'Leaving --terminal out uses the active terminal. --terminal with an empty value is an error, never the active terminal.',
      'Use --expected-runtime-id to bind submission to one exact runtime identity; this selects terminal.sendBound.',
      'Older hosts that do not support terminal.sendBound refuse the request instead of silently falling back to terminal.send.',
      'Use --require-agent-status sendable to refuse submission when no agent is active or it requests permission.'
    ]
  },
  {
    path: ['terminal', 'wait'],
    summary: 'Wait for a terminal condition',
    usage:
      'dobius terminal wait [--terminal <handle>] --for exit|tui-idle [--timeout-ms <ms>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'terminal', 'for', 'timeout-ms']
  },
  {
    path: ['terminal', 'stop'],
    summary: 'Stop terminals for a worktree',
    usage: 'dobius terminal stop --worktree <selector> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree']
  },
  {
    path: ['terminal', 'create'],
    summary: 'Create a terminal session in the current worktree',
    usage:
      'dobius terminal create [--worktree <selector>] [--title <name>] [--command <text>] [--focus] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'command', 'title', 'focus'],
    notes: [
      'Creates a visible terminal tab without switching focus when possible; falls back to a background handle if the UI cannot adopt it. Pass --focus to switch to it.',
      'Use this, not worktree create, for a fresh agent in the current checkout.'
    ],
    examples: [
      'dobius terminal create --json',
      'dobius terminal create --worktree active --command "codex" --json',
      'dobius terminal create --worktree path:/projects/myapp --title "RUNNER" --command "opencode"',
      'dobius terminal create --worktree path:/projects/myapp --command "opencode" --focus'
    ]
  },
  {
    path: ['terminal', 'switch'],
    summary: 'Switch to a terminal tab in the UI',
    usage: 'dobius terminal switch [--terminal <handle>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'terminal'],
    examples: ['dobius terminal switch --terminal term_abc123']
  },
  {
    path: ['terminal', 'focus'],
    summary: 'Switch to a terminal tab in the UI (alias for terminal switch)',
    usage: 'dobius terminal focus [--terminal <handle>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'terminal'],
    examples: ['dobius terminal focus --terminal term_abc123']
  },
  {
    path: ['terminal', 'close'],
    summary: 'Close a terminal tab (kills PTY if running)',
    usage: 'dobius terminal close [--terminal <handle>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'terminal'],
    examples: ['dobius terminal close --terminal term_abc123']
  },
  {
    path: ['terminal', 'rename'],
    summary: 'Set or clear the title of a terminal tab',
    usage: 'dobius terminal rename [--terminal <handle>] [--title <text>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'terminal', 'title'],
    notes: ['Omit --title or pass an empty string to reset to the auto-generated title.'],
    examples: [
      'dobius terminal rename --terminal term_abc123 --title "RUNNER"',
      'dobius terminal rename --terminal term_abc123 --json'
    ]
  },
  {
    path: ['terminal', 'agent'],
    summary: 'Show whether an agent runs in a terminal and what it is doing',
    usage: 'dobius terminal agent [--terminal <handle|card:<id-or-title>|tab:<tabId>>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'terminal', 'worktree'],
    notes: [
      'status is working, permission (waiting for a yes/no), idle, or null when no agent is running.',
      'Omit --terminal to check the active terminal. Read-only.'
    ],
    examples: ['dobius terminal agent --terminal term_abc123 --json']
  },
  {
    path: ['terminal', 'split'],
    summary: 'Split an existing terminal pane',
    usage:
      'dobius terminal split [--terminal <handle>] [--direction horizontal|vertical] [--command <text>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'terminal', 'direction', 'command'],
    examples: [
      'dobius terminal split --terminal term_abc123 --direction horizontal --json',
      'dobius terminal split --terminal term_abc123 --command "codex"'
    ]
  }
]
