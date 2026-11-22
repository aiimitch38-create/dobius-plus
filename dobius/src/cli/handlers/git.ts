import type { GitHistoryResult } from '../../shared/git-history-types'
import type { GitStatusEntry, GitStatusResult } from '../../shared/git-status-types'
import type { RuntimeGitLocalBranches } from '../../shared/runtime-types'
import type { GitDiffResult } from '../../shared/types'
import type { CommandHandler, HandlerContext } from '../dispatch'
import { getOptionalPositiveIntegerFlag, getOptionalStringFlag } from '../flags'
import { printResult } from '../format'
import {
  formatGeneratedCommitMessage,
  formatGitBranches,
  formatGitCommit,
  formatGitDiff,
  formatGitLog,
  formatGitPathChange,
  formatGitStatus,
  formatRemoteOk,
  safeText,
  type GenerateCommitMessageWireResult,
  type GitCommitCliResult,
  type GitCommitWireResult,
  type GitPathChangeCliResult
} from '../git-format'
import { RuntimeClientError, type RuntimeRpcSuccess } from '../runtime-client'
import { getGitWorktreeSelector, getSwitchFlag } from '../git-cli-args'

const DEFAULT_LOG_LIMIT = 20
const MAX_LOG_LIMIT = 200
// Why: commit-message generation runs an AI agent and network git calls can
// stall on slow remotes; the 60s client default would cut both off early.
const GENERATE_TIMEOUT_MS = 180_000
const REMOTE_TIMEOUT_MS = 120_000

function getPathFlag(flags: Map<string, string | boolean>, verb: string): string | null {
  const all = getSwitchFlag(flags, 'all')
  const path = getOptionalStringFlag(flags, 'path')
  if (flags.has('path') && path === undefined) {
    throw new RuntimeClientError('invalid_argument', 'Missing value for --path.')
  }
  if (all && path !== undefined) {
    throw new RuntimeClientError(
      'invalid_argument',
      `Pass a file path or --all to ${verb}, not both.`
    )
  }
  if (!all && path === undefined) {
    throw new RuntimeClientError(
      'invalid_argument',
      `Say which file to ${verb}: dobius git ${verb} <path>, or --all for every file.`
    )
  }
  return all ? null : path!
}

async function loadStatus(
  ctx: HandlerContext,
  worktree: string
): Promise<RuntimeRpcSuccess<GitStatusResult>> {
  const status = await ctx.client.call<GitStatusResult>('git.status', { worktree })
  if (status.result.didHitLimit) {
    throw new RuntimeClientError(
      'invalid_argument',
      'This workspace has too many changes to act on all of them at once. Name the files one by one.'
    )
  }
  return status
}

function isStageable(entry: GitStatusEntry): string | null {
  if (entry.submoduleRoot) {
    return 'inside a submodule'
  }
  if (entry.conflictStatus === 'unresolved') {
    return 'unresolved conflict; fix it, then stage it by name'
  }
  return null
}

export const GIT_HANDLERS: Record<string, CommandHandler> = {
  'git status': async (ctx) => {
    const worktree = await getGitWorktreeSelector(ctx)
    const result = await ctx.client.call<GitStatusResult>('git.status', { worktree })
    printResult(result, ctx.json, formatGitStatus)
  },
  'git diff': async (ctx) => {
    const worktree = await getGitWorktreeSelector(ctx)
    const filePath = getOptionalStringFlag(ctx.flags, 'path')
    if (filePath === undefined) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Say which file to diff: dobius git diff <path>. Run dobius git status to see changed files.'
      )
    }
    const staged = getSwitchFlag(ctx.flags, 'staged')
    const result = await ctx.client.call<GitDiffResult>('git.diff', {
      worktree,
      filePath,
      staged
    })
    printResult(result, ctx.json, (value) => formatGitDiff(filePath, staged, value))
  },
  'git log': async (ctx) => {
    const worktree = await getGitWorktreeSelector(ctx)
    const limit = getOptionalPositiveIntegerFlag(ctx.flags, 'limit') ?? DEFAULT_LOG_LIMIT
    if (limit > MAX_LOG_LIMIT) {
      throw new RuntimeClientError('invalid_argument', `--limit can be at most ${MAX_LOG_LIMIT}.`)
    }
    const baseRef = getOptionalStringFlag(ctx.flags, 'base')
    const result = await ctx.client.call<GitHistoryResult>('git.history', {
      worktree,
      limit,
      ...(baseRef !== undefined ? { baseRef } : {})
    })
    printResult(result, ctx.json, formatGitLog)
  },
  'git branches': async (ctx) => {
    const worktree = await getGitWorktreeSelector(ctx)
    const result = await ctx.client.call<RuntimeGitLocalBranches>('git.localBranches', {
      worktree
    })
    printResult(result, ctx.json, formatGitBranches)
  },
  'git stage': async (ctx) => {
    const path = getPathFlag(ctx.flags, 'stage')
    const worktree = await getGitWorktreeSelector(ctx)
    if (path !== null) {
      const response = await ctx.client.call<{ ok: true }>('git.stage', {
        worktree,
        filePath: path
      })
      const result: GitPathChangeCliResult = {
        ok: true,
        action: 'staged',
        paths: [path],
        skipped: []
      }
      printResult({ ...response, result }, ctx.json, formatGitPathChange)
      return
    }
    const status = await loadStatus(ctx, worktree)
    const paths: string[] = []
    const skipped: GitPathChangeCliResult['skipped'] = []
    for (const entry of status.result.entries) {
      if (entry.area === 'staged') {
        continue
      }
      const reason = isStageable(entry)
      if (reason) {
        skipped.push({ path: entry.path, reason })
      } else if (!paths.includes(entry.path)) {
        paths.push(entry.path)
      }
    }
    const result: GitPathChangeCliResult = { ok: true, action: 'staged', paths, skipped }
    if (paths.length === 0) {
      printResult({ ...status, result }, ctx.json, formatGitPathChange)
      return
    }
    const response = await ctx.client.call<{ ok: true }>('git.bulkStage', {
      worktree,
      filePaths: paths
    })
    printResult({ ...response, result }, ctx.json, formatGitPathChange)
  },
  'git unstage': async (ctx) => {
    const path = getPathFlag(ctx.flags, 'unstage')
    const worktree = await getGitWorktreeSelector(ctx)
    if (path !== null) {
      const response = await ctx.client.call<{ ok: true }>('git.unstage', {
        worktree,
        filePath: path
      })
      const result: GitPathChangeCliResult = {
        ok: true,
        action: 'unstaged',
        paths: [path],
        skipped: []
      }
      printResult({ ...response, result }, ctx.json, formatGitPathChange)
      return
    }
    const status = await loadStatus(ctx, worktree)
    const paths = [
      ...new Set(
        status.result.entries
          .filter((entry) => entry.area === 'staged' && !entry.submoduleRoot)
          // Why: a staged rename also stages the old path's deletion; unstage both.
          .flatMap((entry) => (entry.oldPath ? [entry.oldPath, entry.path] : [entry.path]))
      )
    ]
    const result: GitPathChangeCliResult = { ok: true, action: 'unstaged', paths, skipped: [] }
    if (paths.length === 0) {
      printResult({ ...status, result }, ctx.json, formatGitPathChange)
      return
    }
    const response = await ctx.client.call<{ ok: true }>('git.bulkUnstage', {
      worktree,
      filePaths: paths
    })
    printResult({ ...response, result }, ctx.json, formatGitPathChange)
  },
  'git commit': async (ctx) => {
    const generate = getSwitchFlag(ctx.flags, 'generate')
    const dryRun = getSwitchFlag(ctx.flags, 'dry-run')
    const rawMessage = ctx.flags.get('message')
    if (generate && ctx.flags.has('message')) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Pass either --message or --generate, not both.'
      )
    }
    if (dryRun && !generate) {
      throw new RuntimeClientError(
        'invalid_argument',
        '--dry-run only works together with --generate.'
      )
    }
    if (!generate && (typeof rawMessage !== 'string' || rawMessage.trim().length === 0)) {
      throw new RuntimeClientError(
        'invalid_argument',
        'A commit needs a message. Pass --message "<text>", or --generate to have Dobius+ write one.'
      )
    }
    const worktree = await getGitWorktreeSelector(ctx)
    let message = typeof rawMessage === 'string' ? rawMessage : ''
    if (generate) {
      const generated = await ctx.client.call<GenerateCommitMessageWireResult>(
        'git.generateCommitMessage',
        { worktree },
        { timeoutMs: GENERATE_TIMEOUT_MS }
      )
      if (!generated.result.success) {
        throw new RuntimeClientError(
          'commit_message_failed',
          safeText(`Could not write a commit message: ${generated.result.error}`)
        )
      }
      message = generated.result.message
      if (message.trim().length === 0) {
        throw new RuntimeClientError(
          'commit_message_failed',
          'The generated commit message was empty, so nothing was committed.'
        )
      }
      if (dryRun) {
        printResult(generated, ctx.json, () => formatGeneratedCommitMessage(message))
        return
      }
    }
    const committed = await ctx.client.call<GitCommitWireResult>('git.commit', {
      worktree,
      message
    })
    if (!committed.result.success) {
      throw new RuntimeClientError(
        'git_commit_failed',
        safeText(`Commit failed: ${committed.result.error ?? 'git did not say why'}`)
      )
    }
    const result: GitCommitCliResult = { ...committed.result, message, generated: generate }
    printResult({ ...committed, result }, ctx.json, formatGitCommit)
  },
  'git fetch': async (ctx) => {
    const worktree = await getGitWorktreeSelector(ctx)
    const result = await ctx.client.call<{ ok: true }>(
      'git.fetch',
      { worktree },
      { timeoutMs: REMOTE_TIMEOUT_MS }
    )
    printResult(result, ctx.json, formatRemoteOk('fetch'))
  },
  'git pull': async (ctx) => {
    const allowDirty = getSwitchFlag(ctx.flags, 'allow-dirty')
    const worktree = await getGitWorktreeSelector(ctx)
    if (!allowDirty) {
      const status = await ctx.client.call<GitStatusResult>('git.status', { worktree })
      if (status.result.entries.length > 0) {
        throw new RuntimeClientError(
          'git_pull_blocked',
          `This workspace has ${status.result.entries.length} uncommitted change(s). Commit them first, or pass --allow-dirty to pull anyway.`
        )
      }
    }
    const result = await ctx.client.call<{ ok: true }>(
      'git.pull',
      { worktree },
      { timeoutMs: REMOTE_TIMEOUT_MS }
    )
    printResult(result, ctx.json, formatRemoteOk('pull'))
  }
}
