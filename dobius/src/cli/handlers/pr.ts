import type { GitStatusResult } from '../../shared/git-status-types'
import type {
  CreateHostedReviewResult,
  HostedReviewCreationEligibility
} from '../../shared/hosted-review'
import {
  normalizeHostedReviewBaseRef,
  normalizeHostedReviewHeadRef
} from '../../shared/hosted-review-refs'
import type { RuntimeWorktreeRecord } from '../../shared/runtime-types'
import type { PRCheckDetail, PRCheckRunDetails, PRComment, PRInfo } from '../../shared/types'
import type { CommandHandler, HandlerContext } from '../dispatch'
import { getOptionalPositiveIntegerFlag, getOptionalStringFlag } from '../flags'
import { printResult } from '../format'
import {
  formatPullRequest,
  formatPullRequestCheckDetails,
  formatPullRequestChecks,
  formatPullRequestComments,
  formatPullRequestCreated
} from '../pr-format'
import { safeText } from '../git-format'
import { RuntimeClientError, type RuntimeRpcSuccess } from '../runtime-client'
import { getGitWorktreeSelector, getSwitchFlag } from '../git-cli-args'

// Why: PR lookups and creation go through gh/the GitHub API and can be slow on
// cold caches; give them more room than the 60s client default.
const GITHUB_TIMEOUT_MS = 120_000

type PrTarget = {
  worktreeSelector: string
  repo: string
  branch: string
  worktree: RuntimeWorktreeRecord
}

async function resolvePrTarget(
  ctx: HandlerContext,
  options: { allowDetachedWithPrNumber: boolean }
): Promise<PrTarget> {
  const worktreeSelector = await getGitWorktreeSelector(ctx)
  const shown = await ctx.client.call<{ worktree: RuntimeWorktreeRecord }>('worktree.show', {
    worktree: worktreeSelector
  })
  const worktree = shown.result.worktree
  const branch = normalizeHostedReviewHeadRef(worktree.git.branch ?? '')
  if (!branch || branch === 'HEAD') {
    // Why: an exact --pr lookup does not need the branch, but the RPC schema
    // requires a non-empty one; 'HEAD' never matches a real PR head branch.
    if (
      options.allowDetachedWithPrNumber &&
      getOptionalPositiveIntegerFlag(ctx.flags, 'pr') !== undefined
    ) {
      return { worktreeSelector, repo: `id:${worktree.repoId}`, branch: 'HEAD', worktree }
    }
    throw new RuntimeClientError(
      'invalid_argument',
      'This workspace is not on a branch (detached HEAD). Pass --pr <number> to read a specific PR.'
    )
  }
  return { worktreeSelector, repo: `id:${worktree.repoId}`, branch, worktree }
}

async function lookupPullRequest(
  ctx: HandlerContext,
  target: PrTarget
): Promise<RuntimeRpcSuccess<PRInfo | null>> {
  const explicitPr = getOptionalPositiveIntegerFlag(ctx.flags, 'pr')
  return await ctx.client.call<PRInfo | null>(
    'github.prForBranch',
    {
      repo: target.repo,
      branch: target.branch,
      linkedPRNumber: explicitPr ?? target.worktree.linkedPR ?? null,
      currentHeadOid: target.worktree.git.head || null
    },
    { timeoutMs: GITHUB_TIMEOUT_MS }
  )
}

async function findPullRequest(ctx: HandlerContext, target: PrTarget): Promise<PRInfo> {
  const response = await lookupPullRequest(ctx, target)
  if (!response.result) {
    const explicitPr = getOptionalPositiveIntegerFlag(ctx.flags, 'pr')
    throw new RuntimeClientError(
      'pr_not_found',
      explicitPr !== undefined
        ? `Pull request #${explicitPr} was not found for this repo.`
        : `No pull request found for branch ${target.branch}. Open one with: dobius pr create --title "<title>"`
    )
  }
  return response.result
}

function prRepoParam(pr: PRInfo): { prRepo?: PRInfo['prRepo'] } {
  return pr.prRepo ? { prRepo: pr.prRepo } : {}
}

export const PR_HANDLERS: Record<string, CommandHandler> = {
  'pr show': async (ctx) => {
    const target = await resolvePrTarget(ctx, { allowDetachedWithPrNumber: true })
    const response = await lookupPullRequest(ctx, target)
    // Why: "no PR yet" is a normal answer for show, not an error.
    printResult(response, ctx.json, (pr) => formatPullRequest(pr, target.branch))
  },
  'pr checks': async (ctx) => {
    const target = await resolvePrTarget(ctx, { allowDetachedWithPrNumber: true })
    const pr = await findPullRequest(ctx, target)
    const checks = await ctx.client.call<PRCheckDetail[]>(
      'github.prChecks',
      {
        repo: target.repo,
        prNumber: pr.number,
        ...(pr.headSha ? { headSha: pr.headSha } : {}),
        ...prRepoParam(pr)
      },
      { timeoutMs: GITHUB_TIMEOUT_MS }
    )
    const checkName = getOptionalStringFlag(ctx.flags, 'check')
    if (ctx.flags.has('check') && checkName === undefined) {
      throw new RuntimeClientError('invalid_argument', 'Missing value for --check.')
    }
    if (checkName === undefined) {
      printResult(checks, ctx.json, (list) =>
        formatPullRequestChecks({ prNumber: pr.number, checks: list })
      )
      return
    }
    const wanted = checkName.toLowerCase()
    const check = checks.result.find((candidate) => candidate.name.toLowerCase() === wanted)
    if (!check) {
      const names = checks.result.map((candidate) => candidate.name).join(', ') || 'none'
      throw new RuntimeClientError(
        'invalid_argument',
        safeText(`No check named "${checkName}" on PR #${pr.number}. Checks: ${names}`)
      )
    }
    const details = await ctx.client.call<PRCheckRunDetails | null>(
      'github.prCheckDetails',
      {
        repo: target.repo,
        checkName: check.name,
        url: check.url,
        ...(check.checkRunId !== undefined ? { checkRunId: check.checkRunId } : {}),
        ...(check.workflowRunId !== undefined ? { workflowRunId: check.workflowRunId } : {}),
        ...prRepoParam(pr)
      },
      { timeoutMs: GITHUB_TIMEOUT_MS }
    )
    printResult(details, ctx.json, formatPullRequestCheckDetails)
  },
  'pr comments': async (ctx) => {
    const target = await resolvePrTarget(ctx, { allowDetachedWithPrNumber: true })
    const pr = await findPullRequest(ctx, target)
    const comments = await ctx.client.call<PRComment[]>(
      'github.prComments',
      { repo: target.repo, prNumber: pr.number, ...prRepoParam(pr) },
      { timeoutMs: GITHUB_TIMEOUT_MS }
    )
    const unresolvedOnly = getSwitchFlag(ctx.flags, 'unresolved')
    const list = unresolvedOnly
      ? comments.result.filter((comment) => comment.threadId !== undefined && !comment.isResolved)
      : comments.result
    printResult({ ...comments, result: list }, ctx.json, (value) =>
      formatPullRequestComments({ prNumber: pr.number, comments: value })
    )
  },
  'pr create': async (ctx) => {
    const title = getOptionalStringFlag(ctx.flags, 'title')?.trim()
    if (!title) {
      throw new RuntimeClientError(
        'invalid_argument',
        'A pull request needs a title: --title "<text>".'
      )
    }
    const rawBody = ctx.flags.get('body')
    if (ctx.flags.has('body') && typeof rawBody !== 'string') {
      throw new RuntimeClientError('invalid_argument', 'Missing value for --body.')
    }
    const baseFlag = getOptionalStringFlag(ctx.flags, 'base')
    if (ctx.flags.has('base') && baseFlag === undefined) {
      throw new RuntimeClientError('invalid_argument', 'Missing value for --base.')
    }
    const draft = getSwitchFlag(ctx.flags, 'draft')
    const target = await resolvePrTarget(ctx, { allowDetachedWithPrNumber: false })
    const status = await ctx.client.call<GitStatusResult>('git.status', {
      worktree: target.worktreeSelector
    })
    const upstream = status.result.upstreamStatus
    const eligibility = await ctx.client.call<HostedReviewCreationEligibility>(
      'hostedReview.getCreationEligibility',
      {
        repo: target.repo,
        worktree: target.worktreeSelector,
        branch: target.branch,
        base: baseFlag ?? null,
        hasUncommittedChanges: status.result.entries.length > 0,
        ...(upstream
          ? { hasUpstream: upstream.hasUpstream, ahead: upstream.ahead, behind: upstream.behind }
          : {}),
        linkedGitHubPR: target.worktree.linkedPR ?? null
      },
      { timeoutMs: GITHUB_TIMEOUT_MS }
    )
    const verdict = eligibility.result
    const base = verdict.defaultBaseRef ? normalizeHostedReviewBaseRef(verdict.defaultBaseRef) : ''
    if (!verdict.canCreate || !base) {
      throw new RuntimeClientError('pr_create_blocked', safeText(explainBlocked(verdict, base)))
    }
    const created = await ctx.client.call<CreateHostedReviewResult>(
      'hostedReview.create',
      {
        repo: target.repo,
        worktree: target.worktreeSelector,
        provider: verdict.provider,
        base,
        head: normalizeHostedReviewHeadRef(verdict.head ?? target.branch),
        title,
        ...(typeof rawBody === 'string' ? { body: rawBody } : {}),
        draft
      },
      { timeoutMs: GITHUB_TIMEOUT_MS }
    )
    const result = created.result
    if (!result.ok) {
      const existing = result.existingReview ? ` Existing: ${result.existingReview.url}` : ''
      throw new RuntimeClientError(
        'pr_create_failed',
        safeText(`Could not open the PR: ${result.error}${existing}`)
      )
    }
    printResult({ ...created, result }, ctx.json, formatPullRequestCreated)
  }
}

function explainBlocked(verdict: HostedReviewCreationEligibility, base: string): string {
  switch (verdict.blockedReason) {
    case 'dirty':
      return 'There are uncommitted changes. Commit them first (dobius git commit), then try again.'
    case 'detached_head':
      return 'This workspace is not on a branch, so a PR cannot be opened from it.'
    case 'default_branch':
      return `This branch is the base branch (${base || 'default'}). Open the PR from a feature branch.`
    case 'no_upstream':
      return 'This branch has not been pushed yet. A person needs to push it first; the CLI does not push.'
    case 'needs_push':
      return 'This branch has commits that are not pushed yet. A person needs to push them first; the CLI does not push.'
    case 'needs_sync':
      return 'The remote branch has commits this workspace does not have. Run dobius git pull first.'
    case 'auth_required':
      return 'Dobius+ is not signed in to GitHub for this repo. Sign in from the app, then try again.'
    case 'fork_head_unsupported':
      return 'Opening a PR from a fork branch is not supported here.'
    case 'unsupported_provider':
      return 'This repo is not on a host Dobius+ can open PRs for.'
    case 'existing_review':
      return `This branch already has a PR${verdict.review ? `: ${verdict.review.url}` : ''}.`
    default:
      return base
        ? 'Dobius+ could not confirm this branch is ready for a PR (its push status is unknown). Run dobius git fetch, then try again.'
        : 'No base branch could be found. Pass --base <branch>.'
  }
}
