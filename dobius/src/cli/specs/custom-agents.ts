import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

const AGENT_FIELD_FLAGS = [
  'name',
  'description',
  'system-prompt',
  'engine',
  'account',
  'model',
  'tools',
  'skills',
  'cwd'
]

const AGENT_VS_AUTOMATION_NOTE =
  'Agents are persistent Claude or Codex personas shown in Communications and the Agents tab. For scheduled terminal runs (the Automations tab), use `automations create` instead.'

export const CUSTOM_AGENT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['agents', 'list'],
    summary: 'List persistent Communications agents',
    usage: 'dobius agents list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [AGENT_VS_AUTOMATION_NOTE],
    examples: ['dobius agents list', 'dobius agents list --json']
  },
  {
    path: ['agents', 'show'],
    summary: 'Show one Agents-tab agent',
    usage: 'dobius agents show <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    positionalArgs: ['id'],
    examples: ['dobius agents show 2f9e...', 'dobius agents show --id 2f9e... --json']
  },
  {
    path: ['agents', 'create'],
    summary: 'Create an agent in the Agents tab',
    usage:
      'dobius agents create --name <name> [--engine <claude|codex>] [--account <id>] [--description <text>] [--system-prompt <text>] [--model <id>] [--tools <a,b>] [--skills <a,b>] [--cwd <path>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, ...AGENT_FIELD_FLAGS],
    notes: [
      AGENT_VS_AUTOMATION_NOTE,
      'Engine defaults to Claude. Account selects an existing Dobius-managed OAuth account.',
      'Tools and skills accept comma-separated lists; tools default to Read, Grep, Glob.',
      'Icon, color, heartbeat, notification, and permission-bypass settings are editable only in the app UI.'
    ],
    examples: [
      'dobius agents create --name "Code Reviewer" --system-prompt "Review diffs for bugs" --tools "Read,Grep,Glob,Bash"',
      'dobius agents create --name "Docs Writer" --model claude-fable-5 --cwd ~/Projects --json',
      'dobius agents create --name "Codex Reviewer" --engine codex --cwd ~/Projects --json'
    ]
  },
  {
    path: ['agents', 'edit'],
    summary: 'Edit an Agents-tab agent',
    usage: 'dobius agents edit <id> [--name <name>] [--system-prompt <text>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', ...AGENT_FIELD_FLAGS],
    positionalArgs: ['id'],
    examples: [
      'dobius agents edit 2f9e... --model claude-fable-5',
      'dobius agents edit --id 2f9e... --tools "Read,Grep,Glob,Bash" --json'
    ]
  },
  {
    path: ['agents', 'remove'],
    summary: 'Remove an Agents-tab agent',
    usage: 'dobius agents remove <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    positionalArgs: ['id'],
    examples: ['dobius agents remove 2f9e...', 'dobius agents remove --id 2f9e... --json']
  },
  {
    path: ['agents', 'run'],
    summary: 'Run an Agents-tab agent now with a prompt',
    usage:
      'dobius agents run <id> --prompt <text> [--check <command>] [--check-timeout <seconds>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'prompt', 'check', 'check-timeout'],
    positionalArgs: ['id'],
    notes: [
      'Requires the Dobius+ app to be running; the run uses the agent\'s saved Claude or Codex engine and OAuth account.',
      'Use --check to have the app run a command in the agent\'s folder after the run ends; exit code 0 means the work passed. A failed check starts one retry with the check output.',
      'The check is skipped, and the run marked needs-review, when the run used anything that could act outside this Mac or changed tooling files (package.json, lockfiles, tool config, node_modules, .git).',
      'The check runs in its own macOS sandbox: no network, writes only inside the agent\'s folder, no access to sign-in files or .env files, and only basic environment variables. If that sandbox cannot be applied the check does not run. --check-timeout defaults to 60 seconds, maximum 600.',
      '--check is for Claude agents only; a Codex agent refuses it.',
      'Use `agents runs --json` to see each attempt, its check result and the outcome (verified, blocked or needs-review).'
    ],
    examples: [
      'dobius agents run 2f9e... --prompt "Summarize open PRs"',
      'dobius agents run 2f9e... --prompt "Fix the failing test" --check "npm test" --check-timeout 300'
    ]
  },
  {
    path: ['agents', 'runs'],
    summary: 'List agent run history',
    usage: 'dobius agents runs [--id <agent-id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    examples: ['dobius agents runs', 'dobius agents runs --id 2f9e... --json']
  }
]
