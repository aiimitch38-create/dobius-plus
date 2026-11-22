import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const FILE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['file', 'open'],
    summary: 'Open a workspace file in the Dobius editor',
    usage: 'dobius file open <path> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'path', 'worktree'],
    positionalArgs: ['path'],
    notes: [
      'The path is relative to the selected worktree. When --worktree is omitted, local CLI calls infer the current Dobius worktree from cwd.'
    ],
    examples: [
      'dobius file open src/App.tsx',
      'dobius file open --path docs/readme.md --worktree active'
    ]
  },
  {
    path: ['file', 'diff'],
    summary: 'Open a workspace file diff in the Dobius editor',
    usage: 'dobius file diff <path> [--staged] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'path', 'staged', 'worktree'],
    positionalArgs: ['path'],
    notes: [
      'Diffs default to unstaged changes. Pass --staged to open the staged source-control diff.'
    ],
    examples: [
      'dobius file diff src/App.tsx',
      'dobius file diff --path package.json --staged --worktree branch:feature'
    ]
  },
  {
    path: ['file', 'open-changed'],
    summary: 'Open all git-changed files for a workspace',
    usage: 'dobius file open-changed [--mode edit|diff|both] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'mode', 'worktree'],
    notes: [
      'For v1, changed files come from git status for the selected worktree.',
      'The default mode is diff. Edit mode skips deleted files because there is no file to open.'
    ],
    examples: [
      'dobius file open-changed',
      'dobius file open-changed --mode both',
      'dobius file open-changed --mode diff --worktree active'
    ]
  },
  {
    path: ['file', 'read'],
    summary: 'Print a text file from a worktree',
    usage: 'dobius file read <path> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'path', 'worktree'],
    positionalArgs: ['path'],
    notes: [
      'The path is relative to the worktree and must stay inside it, also after following symlinks.',
      'Secret-looking files are refused: .env*, names with key, secret, credential, token or password, dobius-runtime*.json, .pem and SSH keys.',
      'Large files are cut short (truncated: true in the JSON). Binary files are refused.'
    ],
    examples: ['dobius file read src/App.tsx --json', 'dobius file read --path README.md --worktree active']
  },
  {
    path: ['file', 'write'],
    summary: 'Write (create or replace) a text file inside a worktree',
    usage:
      'dobius file write <path> (--content <text> | --stdin | --from-file <local-path>) [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'path', 'worktree', 'content', 'stdin', 'from-file'],
    positionalArgs: ['path'],
    notes: [
      'Replaces the whole file. Only inside the Dobius-managed worktree: ".." and symlinks that lead elsewhere are refused.',
      'Refused: secret-looking files (as for file read), every dot-file or dot-folder (.git, .claude, .github, .env...), agent instruction files (CLAUDE.md, AGENTS.md...), package.json, dobius.yaml, and Dobius data.',
      '--content "" writes an empty file on purpose. 5 MB max.'
    ],
    examples: [
      'dobius file write notes/plan.md --content "# Plan" --json',
      'cat draft.ts | dobius file write src/draft.ts --stdin --worktree active'
    ]
  },
  {
    path: ['file', 'search'],
    summary: 'Search the text of the files in a worktree',
    usage:
      'dobius file search --query <text> [--regex] [--case-sensitive] [--whole-word] [--include <glob>] [--exclude <glob>] [--limit <n>] [--worktree <selector>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'query',
      'regex',
      'case-sensitive',
      'whole-word',
      'include',
      'exclude',
      'limit',
      'worktree'
    ],
    notes: [
      'Hits in secret-looking files are left out (hiddenFiles in the JSON counts them).',
      '--limit defaults to 200 matches, at most 2000.'
    ],
    examples: ['dobius file search --query "TODO" --include "src/**" --json']
  }
]
