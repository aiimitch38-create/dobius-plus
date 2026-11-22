import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

const CONFIRM_NOTE =
  'Dobius+ shows a dialog asking you to confirm in the app first; nothing happens unless someone clicks it there.'

export const APP_SERVICE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['usage'],
    summary: 'Show token usage and estimated cost for Claude, Codex or OpenCode',
    usage:
      'dobius usage [--provider claude|codex|opencode] [--range 7d|30d|90d|all] [--scope all|dobius] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'provider', 'range', 'scope'],
    notes: [
      'Defaults: --provider claude, --range 7d, --scope all. --scope dobius counts only sessions started inside Dobius+.',
      'Same numbers as the Usage page. If usage tracking is off there, the totals are empty.'
    ],
    examples: ['dobius usage', 'dobius usage --provider codex --range 30d --json']
  },
  {
    path: ['limits'],
    summary: 'Show how much of each account’s rate limit is used (am I out of credits?)',
    usage: 'dobius limits [--refresh] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'refresh'],
    notes: [
      'Shows the last numbers the app fetched. --refresh asks every provider again first (not allowed for background agents).'
    ],
    examples: ['dobius limits', 'dobius limits --refresh --json']
  },
  {
    path: ['knowledge', 'tree'],
    summary: 'List the knowledge cabinet: skills, memory, lessons, docs, rules, project notes',
    usage: 'dobius knowledge tree [--branch <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'branch'],
    notes: [
      'Each file is shown with its full path; pass that path to `dobius knowledge read`.',
      '--branch shows one branch only (learned, skills, memory, lessons, docs, rules, projects).'
    ],
    examples: ['dobius knowledge tree', 'dobius knowledge tree --branch memory']
  },
  {
    path: ['knowledge', 'read'],
    summary: 'Print one knowledge file',
    usage: 'dobius knowledge read <path> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'path'],
    positionalArgs: ['path'],
    notes: [
      'Only Markdown files inside the knowledge folders are read (your ~/.claude folder, the Docs folder and your project folders). Links that point outside them are refused.',
      'Files whose names look like secrets (.env, secrets, credentials, passwords, API keys, access tokens) are refused.'
    ],
    examples: ['dobius knowledge read ~/.claude/CLAUDE.md']
  },
  {
    path: ['imessage', 'status'],
    summary: 'Show whether the iMessage bridge is on and working',
    usage: 'dobius imessage status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['dobius imessage status']
  },
  {
    path: ['version'],
    summary: 'Show the Dobius+ app version',
    usage: 'dobius version [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['dobius version']
  },
  {
    path: ['update', 'status'],
    summary: 'Show whether an app update is available',
    usage: 'dobius update status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Status only. Checking, downloading and installing updates stay in the app (Settings or the update banner).'
    ],
    examples: ['dobius update status']
  },
  {
    path: ['backup', 'status'],
    summary: 'Show the AWS cloud backup status (last backup, problems)',
    usage: 'dobius backup status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['dobius backup status']
  },
  {
    path: ['backup', 'run'],
    summary: 'Start an AWS cloud backup now',
    usage: 'dobius backup run [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      CONFIRM_NOTE,
      'Backups must already be connected in Settings. Connecting AWS and the recovery key stay in the app.'
    ],
    examples: ['dobius backup run']
  },
  {
    path: ['feedback'],
    summary: 'Send feedback to the Dobius+ team',
    usage: 'dobius feedback --text <text> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'text'],
    notes: [
      CONFIRM_NOTE,
      'This sends the text off this Mac, without your name, with the app version and OS. At most 1500 characters; no diagnostics are attached.'
    ],
    examples: ['dobius feedback --text "The Board froze after I closed a console"']
  }
]
