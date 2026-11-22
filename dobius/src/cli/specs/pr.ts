import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

const PR_NOTE =
  'Uses the pull request for the branch of the workspace you are in. Pass --worktree <selector> for another workspace, or --pr <number> for a specific PR.'

export const PR_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['pr', 'show'],
    summary: 'Show the pull request for this branch: title, state, checks, review',
    usage: 'dobius pr show [--pr <number>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'pr', 'worktree'],
    notes: ['Prints a plain message (not an error) when the branch has no PR yet.', PR_NOTE],
    examples: ['dobius pr show', 'dobius pr show --pr 42 --json']
  },
  {
    path: ['pr', 'checks'],
    summary: "List the PR's checks (tests, builds) and whether they passed",
    usage: 'dobius pr checks [--check <name>] [--pr <number>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'check', 'pr', 'worktree'],
    notes: [
      'Pass --check "<name>" to see the errors and the end of the log for one check.',
      PR_NOTE
    ],
    examples: ['dobius pr checks', 'dobius pr checks --check "build (ubuntu)"']
  },
  {
    path: ['pr', 'comments'],
    summary: "Read the PR's comments and review threads",
    usage: 'dobius pr comments [--unresolved] [--pr <number>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'unresolved', 'pr', 'worktree'],
    notes: ['Pass --unresolved to see only review threads that are still open.', PR_NOTE],
    examples: ['dobius pr comments', 'dobius pr comments --unresolved --json']
  },
  {
    path: ['pr', 'create'],
    summary: 'Open a pull request for this branch',
    usage:
      'dobius pr create --title <text> [--body <text>] [--base <branch>] [--draft] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'title', 'body', 'base', 'draft', 'worktree'],
    notes: [
      'The branch must be committed and already pushed. The CLI never pushes; if a push is needed it stops and says so.',
      "The PR goes into the repo's default branch unless you pass --base.",
      'Merging a PR is not available from the CLI. A person merges.'
    ],
    examples: [
      'dobius pr create --title "Fix login button"',
      'dobius pr create --title "Try new layout" --body "Draft for feedback" --draft'
    ]
  }
]
