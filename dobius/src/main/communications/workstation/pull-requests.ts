// merge_project_pull_request, sign_project_pull_request_review_request,
// sign_project_pull_request_status, publish_project_pull_request_merged_status.
//
// Event kinds mirror vendor/buzz-desktop/src/shared/constants/kinds.ts (a
// read-only vendored file — copied here as plain numbers, the same way every
// other reader of that file already treats it, so this feature's build does
// not import across the vendor boundary). Tag shapes mirror
// vendor/buzz-desktop/src/features/projects/pullRequestMutations.ts
// (`projectPullRequestMergedTags`) and pullRequestReviews.ts, which this
// feature's commands exist to serve.
import { existsSync } from 'node:fs'
import { isGitRepo } from '../../git/repo'
import { assertNotFlagLike, runGit, runGitNetwork } from './git-exec'
import { defaultWorkstationCacheDir, resolveRemoteCachePath } from './paths'
import { signAsOwner } from './owner-signing'
import { publishSignedEvent, type SignedCommunicationsEvent } from './relay-publish'

const KIND_TEXT_NOTE = 1
const KIND_GIT_STATUS_OPEN = 1630
const KIND_GIT_STATUS_MERGED = 1631
const KIND_GIT_STATUS_CLOSED = 1632
const KIND_GIT_STATUS_DRAFT = 1633

const PR_STATUS_KIND: Record<'open' | 'draft' | 'closed', number> = {
  open: KIND_GIT_STATUS_OPEN,
  draft: KIND_GIT_STATUS_DRAFT,
  closed: KIND_GIT_STATUS_CLOSED
}

// Mirrors pullRequestReviews.ts's PR_REVIEW_REQUEST_LABEL constant (a `t` tag
// value used to identify review-request comments among plain kind:1 notes).
const PR_REVIEW_REQUEST_LABEL = 'buzz-pr-review-request'

function uniquePubkeys(pubkeys: readonly string[]): string[] {
  return [...new Set(pubkeys.map((pubkey) => pubkey.trim().toLowerCase()))]
}

export class ProjectPullRequestMergeConflictError extends Error {
  constructor(message: string, targetBranch: string, sourceBranch: string) {
    super(
      JSON.stringify({
        code: 'merge_conflict',
        message,
        recovery: { action: 'open_terminal', targetBranch, sourceBranch }
      })
    )
    this.name = 'ProjectPullRequestMergeConflictError'
  }
}

export type RawMergeResult = {
  message: string
  merge_commit: string
  status_event: string
  status_publication_error: string | null
}

/**
 * Merges a reviewed pull request's source branch into its target branch and
 * pushes the result, then signs + publishes a "merged" status event as the
 * repository owner. `expectedCommit` is the PR's reviewed source-branch head
 * — verified before merging so a force-push after review can't silently
 * merge different code than what was approved.
 */
export async function mergeProjectPullRequest(input: {
  targetCloneUrl: string
  sourceCloneUrl: string
  targetOwner: string
  repoAddress: string
  pullRequestId: string
  pullRequestAuthor: string
  statusCreatedAt: number
  targetBranch: string
  sourceBranch: string
  expectedCommit: string
}): Promise<RawMergeResult> {
  for (const [field, value] of Object.entries(input)) {
    if (typeof value === 'string') {assertNotFlagLike(value, field)}
  }

  const path = resolveRemoteCachePath(input.targetCloneUrl)
  if (!existsSync(path) || !isGitRepo(path)) {
    const { mkdir } = await import('node:fs/promises')
    await mkdir(defaultWorkstationCacheDir(), { recursive: true })
    await runGitNetwork(['clone', '--no-checkout', '--', input.targetCloneUrl, path], defaultWorkstationCacheDir())
  }

  await runGitNetwork(['fetch', '--', input.sourceCloneUrl, input.sourceBranch], path)
  const sourceHead = (await runGit(['rev-parse', 'FETCH_HEAD'], path)).stdout.trim()
  if (sourceHead !== input.expectedCommit) {
    throw new Error(
      `${input.sourceBranch} has moved (expected ${input.expectedCommit}, remote is at ${sourceHead}) — refresh and try again`
    )
  }

  await runGitNetwork(['fetch', 'origin', '--', input.targetBranch], path)
  const targetHead = (await runGit(['rev-parse', 'FETCH_HEAD'], path)).stdout.trim()
  await runGit(['checkout', '-B', input.targetBranch, targetHead], path)

  try {
    await runGit(['merge', '--no-ff', sourceHead], path)
  } catch {
    await runGit(['merge', '--abort'], path).catch(() => undefined)
    throw new ProjectPullRequestMergeConflictError(
      `${input.sourceBranch} could not be merged into ${input.targetBranch} — it has conflicts`,
      input.targetBranch,
      input.sourceBranch
    )
  }

  const mergeCommit = (await runGit(['rev-parse', 'HEAD'], path)).stdout.trim()
  await runGitNetwork(['push', 'origin', `HEAD:${input.targetBranch}`], path)

  const tags = [
    ['e', input.pullRequestId, '', 'root'],
    ['a', input.repoAddress],
    ...uniquePubkeys([input.targetOwner, input.pullRequestAuthor]).map((pubkey) => ['p', pubkey]),
    ['merge-commit', mergeCommit],
    ['r', mergeCommit]
  ]

  let statusEventJson = ''
  let statusPublicationError: string | null = null
  try {
    const signed = await signAsOwner(input.targetOwner, {
      kind: KIND_GIT_STATUS_MERGED,
      content: '',
      tags,
      createdAt: input.statusCreatedAt
    })
    statusEventJson = JSON.stringify(signed)
    try {
      await publishSignedEvent(signed)
    } catch (error) {
      statusPublicationError = error instanceof Error ? error.message : String(error)
    }
  } catch (error) {
    // Why: the git merge already succeeded and was pushed — a signing failure
    // (e.g. no local identity controls targetOwner) must not be reported as
    // "the merge failed". It's surfaced as a publication error the caller can
    // retry via publish_project_pull_request_merged_status once resolved.
    statusPublicationError = error instanceof Error ? error.message : String(error)
  }

  return {
    message: `Merged ${input.sourceBranch} into ${input.targetBranch}`,
    merge_commit: mergeCommit,
    status_event: statusEventJson,
    status_publication_error: statusPublicationError
  }
}

/** Re-publishes a pre-signed merged-status event (retry path for a merge whose inline publish failed). */
export async function publishProjectPullRequestMergedStatus(input: {
  targetOwner: string
  statusEvent: string
}): Promise<void> {
  let event: SignedCommunicationsEvent
  try {
    event = JSON.parse(input.statusEvent) as SignedCommunicationsEvent
  } catch {
    throw new Error('statusEvent is not valid JSON')
  }
  if (event.pubkey?.toLowerCase() !== input.targetOwner.trim().toLowerCase()) {
    throw new Error('statusEvent was not signed by targetOwner')
  }
  await publishSignedEvent(event)
}

/** Signs and publishes a lifecycle status change (open/draft/closed) as the repo owner. */
export async function signProjectPullRequestStatus(input: {
  targetOwner: string
  repoAddress: string
  pullRequestId: string
  pullRequestAuthor: string
  status: 'open' | 'draft' | 'closed'
  createdAt: number
}): Promise<void> {
  const tags = [
    ['e', input.pullRequestId, '', 'root'],
    ['a', input.repoAddress],
    ...uniquePubkeys([input.targetOwner, input.pullRequestAuthor]).map((pubkey) => ['p', pubkey])
  ]
  const signed = await signAsOwner(input.targetOwner, {
    kind: PR_STATUS_KIND[input.status],
    content: '',
    tags,
    createdAt: input.createdAt
  })
  await publishSignedEvent(signed)
}

/** Signs and publishes a review-request note (kind:1, tagged for discovery) as the repo owner. */
export async function signProjectPullRequestReviewRequest(input: {
  targetOwner: string
  repoAddress: string
  pullRequestId: string
  reviewers: string[]
  reviewerLabel: string
}): Promise<void> {
  if (input.reviewers.length === 0) {
    throw new Error('At least one reviewer is required')
  }
  const reviewerPubkeys = uniquePubkeys(input.reviewers)
  const tags = [
    ['e', input.pullRequestId, '', 'root'],
    ['a', input.repoAddress],
    ...reviewerPubkeys.map((pubkey) => ['p', pubkey]),
    ['t', PR_REVIEW_REQUEST_LABEL]
  ]
  const signed = await signAsOwner(input.targetOwner, {
    kind: KIND_TEXT_NOTE,
    content: `Requested a review from ${input.reviewerLabel}`,
    tags
  })
  await publishSignedEvent(signed)
}
