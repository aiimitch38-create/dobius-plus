import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CloudJob, CloudJobInput } from '../../../../shared/cloud-jobs'
import {
  CloudJobSubmissionBlockedError,
  canCancelCloudJob,
  canRetryCloudJob,
  clearUnresolvedSubmissionsForTests,
  sendCloudJobSubmission
} from './cloud-job-actions'

afterEach(clearUnresolvedSubmissionsForTests)

const messages = { inFlight: 'in flight', tooMany: 'too many' }
const work: Omit<CloudJobInput, 'requestKey'> = {
  title: 'Build',
  taskId: 'task',
  projectId: 'project',
  workspaceId: 'workspace',
  targetDeviceId: 'laptop',
  recipeId: 'build',
  sourceRevision: 'a'.repeat(40),
  estimatedBytes: 0,
  dependencies: []
}
function job(requestKey: string): CloudJob {
  return {
    ...work,
    requestKey,
    id: 'job-1',
    createdBy: 'local',
    state: 'queued',
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    attemptCount: 0,
    waitingReason: null,
    evidence: [],
    outcome: null
  }
}
const keyOf = (send: ReturnType<typeof vi.fn>, call: number) =>
  (send.mock.calls[call][0] as CloudJobInput).requestKey

describe('cloud job state rules', () => {
  it('matches the authority: cancel any non-final job, retry only failed or interrupted', () => {
    const states: CloudJob['state'][] = [
      'queued',
      'waiting_for_worker',
      'running',
      'needs_review',
      'completed',
      'failed',
      'cancelled',
      'interrupted'
    ]
    expect(states.filter((state) => canCancelCloudJob({ ...job('k'), state }))).toEqual([
      'queued',
      'waiting_for_worker',
      'running',
      'needs_review',
      'failed',
      'interrupted'
    ])
    expect(states.filter((state) => canRetryCloudJob({ ...job('k'), state }))).toEqual([
      'failed',
      'interrupted'
    ])
  })
})

describe('sendCloudJobSubmission', () => {
  it('refuses a second send of the same work while the first is in flight', async () => {
    let finish: (value: unknown) => void = () => {}
    const send = vi.fn(
      (_input: CloudJobInput) =>
        new Promise<unknown>((resolve) => {
          finish = resolve
        })
    )
    const first = sendCloudJobSubmission('vps', work, send, messages)
    await expect(sendCloudJobSubmission('vps', work, send, messages)).rejects.toBeInstanceOf(
      CloudJobSubmissionBlockedError
    )
    expect(send).toHaveBeenCalledTimes(1)
    finish({ job: job(keyOf(send, 0)) })
    await expect(first).resolves.toMatchObject({ id: 'job-1' })
  })

  it('keeps the key when the reply is lost or invalid, and releases it after a valid job', async () => {
    const send = vi
      .fn<(input: CloudJobInput) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('timed out'))
      .mockResolvedValueOnce({ unexpected: true })
      .mockImplementationOnce(async (input) => ({ job: job(input.requestKey) }))
      .mockImplementationOnce(async (input) => ({ job: job(input.requestKey) }))
    await expect(sendCloudJobSubmission('vps', work, send, messages)).rejects.toThrow('timed out')
    await expect(sendCloudJobSubmission('vps', work, send, messages)).rejects.toThrow()
    await sendCloudJobSubmission('vps', work, send, messages)
    expect(keyOf(send, 1)).toBe(keyOf(send, 0))
    expect(keyOf(send, 2)).toBe(keyOf(send, 0))
    await sendCloudJobSubmission('vps', work, send, messages)
    expect(keyOf(send, 3)).not.toBe(keyOf(send, 0))
  })

  it('never shares a key across authorities or different work', async () => {
    const send = vi.fn(async (_input: CloudJobInput): Promise<unknown> => {
      throw new Error('lost')
    })
    await sendCloudJobSubmission('vps-a', work, send, messages).catch(() => null)
    await sendCloudJobSubmission('vps-b', work, send, messages).catch(() => null)
    await sendCloudJobSubmission('vps-a', { ...work, title: 'Other' }, send, messages).catch(
      () => null
    )
    const keys = new Set([0, 1, 2].map((call) => keyOf(send, call)))
    expect(keys.size).toBe(3)
  })

  it('refuses new work instead of evicting unresolved keys at the cap', async () => {
    const send = vi.fn(async (_input: CloudJobInput): Promise<unknown> => {
      throw new Error('lost')
    })
    for (let index = 0; index < 200; index++) {
      await sendCloudJobSubmission('vps', { ...work, title: `t${index}` }, send, messages).catch(
        () => null
      )
    }
    await expect(
      sendCloudJobSubmission('vps', { ...work, title: 'one more' }, send, messages)
    ).rejects.toThrow('too many')
    await sendCloudJobSubmission('vps', { ...work, title: 't0' }, send, messages).catch(() => null)
    expect(keyOf(send, 200)).toBe(keyOf(send, 0))
  })
})
