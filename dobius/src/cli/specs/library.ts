import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

const WHAT_IS_IN_IT =
  'The library is a search index on this Mac of project notes (plans, CLAUDE.md, handoffs, build logs, lessons, notes, READMEs, docs), Claude Code and Codex conversations, ADAM’s thread and Hermes sessions, and the Obsidian vault. Text only; secret files are never read and key-like text is removed.'

export const LIBRARY_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['library', 'search'],
    summary: 'Search the library of projects, conversations and notes',
    usage:
      'dobius library search <query> [--project <name>] [--source claude|codex|project|adam|obsidian] [--limit <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'query', 'project', 'source', 'limit'],
    positionalArgs: ['query'],
    notes: [
      WHAT_IS_IN_IT,
      'Put several words in quotes. Passages with every word rank first; when none has them all, any word counts.',
      '--project matches part of a project name ("epoxy" finds epoxyitright). --limit is 1 to 20 (default 8).',
      'The app refreshes the library two minutes after it starts and then every 30 minutes, so the newest work can be missing for a while.'
    ],
    examples: [
      'dobius library search "voice link plan"',
      'dobius library search "hero image" --project pocket --source claude',
      'dobius library search "lessons about worktrees" --json'
    ]
  },
  {
    path: ['library', 'status'],
    summary: 'Show what the library holds, its size and its last refresh',
    usage: 'dobius library status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [WHAT_IS_IN_IT, 'The index is capped (400 MB by default); the oldest material goes first.'],
    examples: ['dobius library status', 'dobius library status --json']
  }
]
