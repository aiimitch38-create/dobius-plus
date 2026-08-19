import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userDataDir: string
const signAsOwnerMock = vi.fn()
const publishSignedEventMock = vi.fn().mockResolvedValue(undefined)

vi.mock('electron', () => ({ app: { getPath: () => userDataDir } }))
vi.mock('./owner-signing', () => ({ signAsOwner: (...args: unknown[]) => signAsOwnerMock(...args) }))
vi.mock('./relay-publish', () => ({ publishSignedEvent: (...args: unknown[]) => publishSignedEventMock(...args) }))

const {
  mergeProjectPullRequest,
  signProjectPullRequestStatus,
  signProjectPullRequestReviewRequest,
  publishProjectPullRequestMergedStatus
} = await import('./pull-requests')

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
}

describe('mergeProjectPullRequest', () => {
  let workDir: string
  let targetRemote: string
  let sourceRemote: string
  let sourceHead: string

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), 'dobius-workstation-merge-'))
    userDataDir = path.join(workDir, 'userData')
    mkdirSync(userDataDir, { recursive: true })

    targetRemote = path.join(workDir, 'target.git')
    mkdirSync(targetRemote)
    git(targetRemote, ['init', '--quiet', '-b', 'main'])
    git(targetRemote, ['config', 'user.email', 'fixture@example.com'])
    git(targetRemote, ['config', 'user.name', 'Fixture'])
    // Why: mergeProjectPullRequest pushes straight to this fixture's checked-out
    // branch, same as a real (non-bare) remote would refuse without this.
    git(targetRemote, ['config', 'receive.denyCurrentBranch', 'updateInstead'])
    writeFileSync(path.join(targetRemote, 'README.md'), '# fixture\n')
    git(targetRemote, ['add', 'README.md'])
    git(targetRemote, ['commit', '--quiet', '-m', 'initial commit'])

    sourceRemote = path.join(workDir, 'source.git')
    execFileSync('git', ['clone', '--quiet', targetRemote, sourceRemote])
    git(sourceRemote, ['config', 'user.email', 'fixture@example.com'])
    git(sourceRemote, ['config', 'user.name', 'Fixture'])
    writeFileSync(path.join(sourceRemote, 'feature.txt'), 'new file\n')
    git(sourceRemote, ['add', 'feature.txt'])
    git(sourceRemote, ['commit', '--quiet', '-m', 'feature commit'])
    sourceHead = git(sourceRemote, ['rev-parse', 'HEAD']).trim()

    signAsOwnerMock.mockReset().mockResolvedValue({
      id: 'status-event-id',
      pubkey: 'owner-pubkey',
      created_at: 1,
      kind: 1631,
      tags: [],
      content: '',
      sig: 'sig'
    })
    publishSignedEventMock.mockClear().mockResolvedValue(undefined)
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  it('merges, pushes, and signs+publishes a merged status event', async () => {
    const result = await mergeProjectPullRequest({
      targetCloneUrl: targetRemote,
      sourceCloneUrl: sourceRemote,
      targetOwner: 'owner-pubkey',
      repoAddress: '30617:owner-pubkey:repo',
      pullRequestId: 'pr-event-id',
      pullRequestAuthor: 'author-pubkey',
      statusCreatedAt: 12345,
      targetBranch: 'main',
      sourceBranch: 'main',
      expectedCommit: sourceHead
    })

    expect(result.merge_commit).toMatch(/^[0-9a-f]{40}$/)
    expect(result.status_event).toContain('status-event-id')
    expect(result.status_publication_error).toBeNull()
    expect(publishSignedEventMock).toHaveBeenCalled()

    const targetLog = git(targetRemote, ['log', '-1', '--format=%s'])
    expect(targetLog.trim()).toContain('Merge')
  })

  it('rejects with a structured merge_conflict payload (and aborts) when the branches conflict', async () => {
    writeFileSync(path.join(targetRemote, 'README.md'), '# fixture\ntarget changed this too\n')
    git(targetRemote, ['commit', '-a', '--quiet', '-m', 'target-side conflicting change'])
    writeFileSync(path.join(sourceRemote, 'README.md'), '# fixture\nsource changed this differently\n')
    git(sourceRemote, ['commit', '-a', '--quiet', '-m', 'source-side conflicting change'])
    const conflictingSourceHead = git(sourceRemote, ['rev-parse', 'HEAD']).trim()

    await expect(
      mergeProjectPullRequest({
        targetCloneUrl: targetRemote,
        sourceCloneUrl: sourceRemote,
        targetOwner: 'owner-pubkey',
        repoAddress: '30617:owner-pubkey:repo',
        pullRequestId: 'pr-event-id',
        pullRequestAuthor: 'author-pubkey',
        statusCreatedAt: 12345,
        targetBranch: 'main',
        sourceBranch: 'main',
        expectedCommit: conflictingSourceHead
      })
    ).rejects.toThrow(/merge_conflict/)
  })

  it('rejects when the source branch has moved past expectedCommit (stale PR review)', async () => {
    await expect(
      mergeProjectPullRequest({
        targetCloneUrl: targetRemote,
        sourceCloneUrl: sourceRemote,
        targetOwner: 'owner-pubkey',
        repoAddress: '30617:owner-pubkey:repo',
        pullRequestId: 'pr-event-id',
        pullRequestAuthor: 'author-pubkey',
        statusCreatedAt: 12345,
        targetBranch: 'main',
        sourceBranch: 'main',
        expectedCommit: '0'.repeat(40)
      })
    ).rejects.toThrow(/has moved/)
  })

  it('still returns the merge result when publishing the status event fails, with the error surfaced', async () => {
    publishSignedEventMock.mockRejectedValueOnce(new Error('relay unreachable'))
    const result = await mergeProjectPullRequest({
      targetCloneUrl: targetRemote,
      sourceCloneUrl: sourceRemote,
      targetOwner: 'owner-pubkey',
      repoAddress: '30617:owner-pubkey:repo',
      pullRequestId: 'pr-event-id',
      pullRequestAuthor: 'author-pubkey',
      statusCreatedAt: 12345,
      targetBranch: 'main',
      sourceBranch: 'main',
      expectedCommit: sourceHead
    })
    expect(result.merge_commit).toMatch(/^[0-9a-f]{40}$/)
    expect(result.status_publication_error).toContain('relay unreachable')
  })
})

describe('signProjectPullRequestStatus / signProjectPullRequestReviewRequest', () => {
  beforeEach(() => {
    signAsOwnerMock.mockReset().mockResolvedValue({ id: 'x', pubkey: 'p', created_at: 1, kind: 1, tags: [], content: '', sig: 's' })
    publishSignedEventMock.mockClear().mockResolvedValue(undefined)
  })

  it('signs and publishes a status change as the owner', async () => {
    await signProjectPullRequestStatus({
      targetOwner: 'owner-pubkey',
      repoAddress: 'addr',
      pullRequestId: 'pr-1',
      pullRequestAuthor: 'author',
      status: 'closed',
      createdAt: 1
    })
    expect(signAsOwnerMock).toHaveBeenCalledWith('owner-pubkey', expect.objectContaining({ kind: 1632 }))
    expect(publishSignedEventMock).toHaveBeenCalled()
  })

  it('rejects a review request with no reviewers before signing anything', async () => {
    await expect(
      signProjectPullRequestReviewRequest({
        targetOwner: 'owner-pubkey',
        repoAddress: 'addr',
        pullRequestId: 'pr-1',
        reviewers: [],
        reviewerLabel: 'nobody'
      })
    ).rejects.toThrow(/At least one reviewer/)
    expect(signAsOwnerMock).not.toHaveBeenCalled()
  })
})

describe('publishProjectPullRequestMergedStatus', () => {
  beforeEach(() => {
    publishSignedEventMock.mockClear().mockResolvedValue(undefined)
  })

  it('re-publishes a pre-signed event matching targetOwner', async () => {
    const event = { id: 'x', pubkey: 'Owner-Pubkey', created_at: 1, kind: 1631, tags: [], content: '', sig: 's' }
    await publishProjectPullRequestMergedStatus({ targetOwner: 'owner-pubkey', statusEvent: JSON.stringify(event) })
    expect(publishSignedEventMock).toHaveBeenCalledWith(event)
  })

  it('rejects a statusEvent signed by a different pubkey than targetOwner', async () => {
    const event = { id: 'x', pubkey: 'someone-else', created_at: 1, kind: 1631, tags: [], content: '', sig: 's' }
    await expect(
      publishProjectPullRequestMergedStatus({ targetOwner: 'owner-pubkey', statusEvent: JSON.stringify(event) })
    ).rejects.toThrow(/not signed by targetOwner/)
    expect(publishSignedEventMock).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON', async () => {
    await expect(
      publishProjectPullRequestMergedStatus({ targetOwner: 'owner-pubkey', statusEvent: 'not json' })
    ).rejects.toThrow(/not valid JSON/)
  })
})
