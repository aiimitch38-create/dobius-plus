import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

const WORKTREE_NOTE =
  'Works on the workspace you are in. Pass --worktree <selector> (for example branch:my-feature or id:<id>) to pick another one.'

export const GIT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['git', 'status'],
    summary: 'Show which files changed, what is staged, and how far ahead or behind the branch is',
    usage: 'dobius git status [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree'],
    notes: [WORKTREE_NOTE],
    examples: ['dobius git status', 'dobius git status --worktree branch:my-feature --json']
  },
  {
    path: ['git', 'diff'],
    summary: 'Show what changed in one file',
    usage: 'dobius git diff <path> [--staged] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'path', 'staged', 'worktree'],
    positionalArgs: ['path'],
    notes: [
      'Shows changes that are not staged yet. Pass --staged to see what is staged for the next commit.',
      'With --json you get the full before and after text of the file.',
      WORKTREE_NOTE
    ],
    examples: ['dobius git diff src/App.tsx', 'dobius git diff package.json --staged']
  },
  {
    path: ['git', 'log'],
    summary: 'List recent commits on this branch',
    usage: 'dobius git log [--limit <n>] [--base <ref>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'limit', 'base', 'worktree'],
    notes: ['Shows 20 commits unless you pass --limit (up to 200).', WORKTREE_NOTE],
    examples: ['dobius git log', 'dobius git log --limit 50 --json']
  },
  {
    path: ['git', 'branches'],
    summary: 'List local branches and mark the current one',
    usage: 'dobius git branches [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree'],
    notes: [WORKTREE_NOTE],
    examples: ['dobius git branches']
  },
  {
    path: ['git', 'stage'],
    summary: 'Stage a file (or every changed file) for the next commit',
    usage: 'dobius git stage <path> | --all [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'path', 'all', 'worktree'],
    positionalArgs: ['path'],
    notes: [
      'Staging picks which changes go into the next commit. It does not change or delete any file.',
      '--all skips files with unresolved merge conflicts and files inside submodules; it lists what it skipped.',
      WORKTREE_NOTE
    ],
    examples: ['dobius git stage src/App.tsx', 'dobius git stage --all']
  },
  {
    path: ['git', 'unstage'],
    summary: 'Take a file (or every staged file) out of the next commit, keeping your edits',
    usage: 'dobius git unstage <path> | --all [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'path', 'all', 'worktree'],
    positionalArgs: ['path'],
    notes: ['Your edits stay in the file. Only the staged mark is removed.', WORKTREE_NOTE],
    examples: ['dobius git unstage src/App.tsx', 'dobius git unstage --all']
  },
  {
    path: ['git', 'commit'],
    summary: 'Commit the staged changes',
    usage:
      'dobius git commit --message <text> | --generate [--dry-run] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'message', 'generate', 'dry-run', 'worktree'],
    notes: [
      'A message is required. Pass --generate to have Dobius+ write one from the staged changes (this uses AI tokens).',
      'Add --dry-run with --generate to only see the suggested message.',
      'Only staged changes are committed. Stage files first with dobius git stage.',
      WORKTREE_NOTE
    ],
    examples: [
      'dobius git commit --message "Fix login button"',
      'dobius git commit --generate',
      'dobius git commit --generate --dry-run'
    ]
  },
  {
    path: ['git', 'fetch'],
    summary: 'Download the latest branch info from the remote without changing your files',
    usage: 'dobius git fetch [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree'],
    notes: [WORKTREE_NOTE],
    examples: ['dobius git fetch']
  },
  {
    path: ['git', 'pull'],
    summary: "Bring the remote branch's new commits into this workspace",
    usage: 'dobius git pull [--allow-dirty] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'allow-dirty', 'worktree'],
    notes: [
      'Refuses when there are uncommitted changes, so a pull never mixes into unsaved work. Pass --allow-dirty to pull anyway.',
      'This changes your files when the remote has new commits. It can stop with a merge conflict.',
      "There is no CLI push: pushing stays a person's decision.",
      WORKTREE_NOTE
    ],
    examples: ['dobius git pull']
  }
]
