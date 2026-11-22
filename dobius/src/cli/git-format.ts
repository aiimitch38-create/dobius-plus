import type { GitHistoryResult } from '../shared/git-history-types'
import type { GitStatusEntry, GitStatusResult } from '../shared/git-status-types'
import type { GitDiffResult } from '../shared/types'
import type { RuntimeGitLocalBranches } from '../shared/runtime-types'
import { buildLineDiff, renderHunks } from './git-line-diff'

// Why: the runtime's commit-message result type lives in main/, which the CLI
// build does not include; this mirrors its wire shape.
export type GenerateCommitMessageWireResult =
  | { success: true; message: string; agentLabel?: string }
  | { success: false; error: string; canceled?: boolean }

export type GitCommitWireResult = { success: boolean; error?: string }

export type GitCommitCliResult = GitCommitWireResult & { message: string; generated: boolean }

export type GitPathChangeCliResult = {
  ok: true
  action: 'staged' | 'unstaged'
  paths: string[]
  skipped: { path: string; reason: string }[]
}

const MAX_DIFF_OUTPUT_LINES = 2000

// Why: PR comments, check logs, commit subjects and file contents can come from
// other people; raw terminal escape codes in them could hide or rewrite what the
// reader (Carson or ADAM) sees. Tabs and newlines are kept.
// oxlint-disable-next-line no-control-regex
const TERMINAL_ESCAPE = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g
// oxlint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g

export function safeText(text: string): string {
  return text.replace(TERMINAL_ESCAPE, '').replace(CONTROL_CHARS, '')
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function describeEntry(entry: GitStatusEntry): string {
  const label = entry.conflictStatus === 'unresolved' ? 'conflict' : entry.status
  const path = entry.oldPath ? `${entry.oldPath} -> ${entry.path}` : entry.path
  const counts =
    entry.added !== undefined || entry.removed !== undefined
      ? `  (+${entry.added ?? 0} -${entry.removed ?? 0})`
      : ''
  return `  ${label.padEnd(10)}${path}${counts}`
}

export function formatGitStatus(result: GitStatusResult): string {
  const lines: string[] = []
  const branch = result.branch ? result.branch.replace(/^refs\/heads\//, '') : null
  const upstream = result.upstreamStatus
  let branchLine = branch ? `On branch ${branch}` : 'Not on a branch (detached HEAD)'
  if (upstream?.hasUpstream) {
    branchLine += ` (tracking ${upstream.upstreamName ?? 'upstream'}: ${upstream.ahead} ahead, ${upstream.behind} behind)`
  } else if (upstream) {
    branchLine += ' (not pushed yet: no upstream branch)'
  }
  lines.push(branchLine)
  if (result.conflictOperation !== 'unknown') {
    lines.push(`A ${result.conflictOperation} is in progress.`)
  }

  const groups: { title: string; entries: GitStatusEntry[] }[] = [
    {
      title: 'Conflicts to resolve',
      entries: result.entries.filter((e) => e.conflictStatus === 'unresolved')
    },
    {
      title: 'Staged (will be in the next commit)',
      entries: result.entries.filter(
        (e) => e.area === 'staged' && e.conflictStatus !== 'unresolved'
      )
    },
    {
      title: 'Changed but not staged',
      entries: result.entries.filter(
        (e) => e.area === 'unstaged' && e.conflictStatus !== 'unresolved'
      )
    },
    {
      title: 'New files git is not tracking yet',
      entries: result.entries.filter((e) => e.area === 'untracked')
    }
  ]
  for (const group of groups) {
    if (group.entries.length === 0) {
      continue
    }
    lines.push('', `${group.title} (${group.entries.length}):`)
    for (const entry of group.entries) {
      lines.push(describeEntry(entry))
    }
  }
  if (result.entries.length === 0) {
    lines.push('', 'Nothing to commit. The working tree is clean.')
  }
  if (result.didHitLimit) {
    lines.push(
      '',
      `Only the first ${result.entries.length} of ${result.statusLength ?? 'many'} changes are shown.`
    )
  }
  return safeText(lines.join('\n'))
}

export function formatGitLog(result: GitHistoryResult): string {
  if (result.items.length === 0) {
    return 'No commits found.'
  }
  const lines = result.items.map((item) => {
    const id = item.displayId ?? item.id.slice(0, 7)
    const date =
      typeof item.timestamp === 'number' ? new Date(item.timestamp).toISOString().slice(0, 10) : ''
    const author = item.author ?? ''
    return [id, date, author, item.subject].filter((part) => part.length > 0).join('  ')
  })
  if (result.hasMore) {
    lines.push(`(showing ${result.items.length}; pass --limit for more, up to 200)`)
  }
  return safeText(lines.join('\n'))
}

export function formatGitBranches(result: RuntimeGitLocalBranches): string {
  if (result.branches.length === 0) {
    return 'No local branches.'
  }
  return safeText(
    result.branches.map((name) => `${name === result.current ? '*' : ' '} ${name}`).join('\n')
  )
}

export function formatGitDiff(path: string, staged: boolean, result: GitDiffResult): string {
  const area = staged ? 'staged' : 'not staged'
  if (result.kind === 'binary') {
    return safeText(`${path} (${area}): binary file changed; no text diff to show.`)
  }
  if (result.originalContent === result.modifiedContent) {
    return safeText(`No ${area} changes in ${path}.`)
  }
  const body = renderHunks(buildLineDiff(result.originalContent, result.modifiedContent))
  const lines = [`Diff of ${path} (${area}):`, ...body]
  if (lines.length > MAX_DIFF_OUTPUT_LINES) {
    return safeText(
      [
        ...lines.slice(0, MAX_DIFF_OUTPUT_LINES),
        `... diff cut off after ${MAX_DIFF_OUTPUT_LINES} lines. Pass --json for the full before and after text.`
      ].join('\n')
    )
  }
  return safeText(lines.join('\n'))
}

export function formatGitPathChange(result: GitPathChangeCliResult): string {
  const lines: string[] = []
  if (result.paths.length === 0) {
    lines.push(`Nothing to ${result.action === 'staged' ? 'stage' : 'unstage'}.`)
  } else {
    lines.push(
      `${result.action === 'staged' ? 'Staged' : 'Unstaged'} ${plural(result.paths.length, 'file')}:`
    )
    for (const path of result.paths) {
      lines.push(`  ${path}`)
    }
  }
  if (result.skipped.length > 0) {
    lines.push(`Skipped ${plural(result.skipped.length, 'file')}:`)
    for (const entry of result.skipped) {
      lines.push(`  ${entry.path} (${entry.reason})`)
    }
  }
  return safeText(lines.join('\n'))
}

export function formatGitCommit(result: GitCommitCliResult): string {
  const subject = result.message.split('\n')[0]
  return safeText(`Committed${result.generated ? ' with a generated message' : ''}: ${subject}`)
}

export function formatGeneratedCommitMessage(message: string): string {
  return safeText(`Suggested commit message (nothing was committed):\n\n${message}`)
}

export function formatRemoteOk(action: 'fetch' | 'pull'): (result: unknown) => string {
  return () =>
    action === 'fetch'
      ? 'Fetched the latest from the remote. Nothing in your files changed.'
      : 'Pulled the latest commits from the remote into this branch.'
}

// ─── Help text for flags ────────────────────────────────────────────────

const GIT_PR_FLAG_HELP: Record<string, string> = {
  worktree: '--worktree <selector>  Which workspace (default: the one you are in)',
  staged: '--staged               Show staged changes (default: changes not staged yet)',
  limit: '--limit <n>            How many commits to show (1-200, default 20)',
  base: '--base <ref>           Branch to compare against / open the PR into',
  path: '--path <path>          File path, relative to the workspace',
  all: '--all                  Every changed file at once',
  message: '--message <text>       The commit message',
  generate: '--generate             Have Dobius+ write the commit message (uses AI tokens)',
  'dry-run': '--dry-run              With --generate: show the message, do not commit',
  pr: "--pr <number>          A specific PR number instead of this branch's PR",
  check: '--check <name>         Show errors and log for one check by name',
  unresolved: '--unresolved           Only review threads that are still open',
  title: '--title <text>         PR title',
  body: '--body <text>          PR description',
  draft: '--draft                Open the PR as a draft'
}

export function formatGitPrFlagHelp(commandPath: readonly string[], flag: string): string | null {
  if (commandPath[0] !== 'git' && commandPath[0] !== 'pr') {
    return null
  }
  return GIT_PR_FLAG_HELP[flag] ?? null
}
