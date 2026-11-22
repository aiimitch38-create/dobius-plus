import { z } from 'zod'
import { CloudJob, type CloudJob as Job, type CloudJobInput } from '../../../../shared/cloud-jobs'
import type { CloudJobReadSource } from '../../../../shared/cloud-job-projection'

export type CloudJobWriteMethod = 'jobs.submit' | 'jobs.cancel' | 'jobs.retry'

/** A read source that may also change jobs; injected read-only sources omit `write`. */
export type CloudJobActionSource = CloudJobReadSource & {
  write?: (method: CloudJobWriteMethod, params: unknown) => Promise<unknown>
}

// Why: mirrors the store's own rules (main/automations/cloud-jobs/store.ts
// cancel/retry) so the board never offers a button the authority will refuse.
export function canCancelCloudJob(job: Job): boolean {
  return job.state !== 'completed' && job.state !== 'cancelled'
}

export function canRetryCloudJob(job: Job): boolean {
  return job.state === 'failed' || job.state === 'interrupted'
}

const WriteResult = z.object({ job: CloudJob })

export function parseCloudJobWriteResult(value: unknown): Job {
  return WriteResult.parse(value).job
}

export function newCloudJobRequestKey(): string {
  return `board-${globalThis.crypto.randomUUID()}`
}

// Why: the authority dedupes on (creator, requestKey). When a submit's reply
// is lost, the same work must go out again with the same key, even if the form
// was remounted or the Jobs view was left meanwhile; otherwise a second paid
// job could be created. State is module-level (shared by every mount) and
// keyed by authority + work fingerprint.
const MAX_UNRESOLVED_SUBMISSIONS = 200
const unresolvedSubmissions = new Map<string, string>()
const inFlightSubmissions = new Set<string>()

type CloudJobSubmitWork = Omit<CloudJobInput, 'requestKey'>

function submissionKey(sourceKey: string, work: CloudJobSubmitWork): string {
  const { dependencies, ...rest } = work
  const ordered = Object.fromEntries(Object.entries(rest).sort(([a], [b]) => a.localeCompare(b)))
  return JSON.stringify([sourceKey, ordered, [...dependencies].sort()])
}

export class CloudJobSubmissionBlockedError extends Error {}

/**
 * Sends one submit with a stable idempotency key. Call only after the user
 * confirmed. The key is released only once the authority returns a valid job.
 */
export async function sendCloudJobSubmission(
  sourceKey: string,
  work: CloudJobSubmitWork,
  send: (input: CloudJobInput) => Promise<unknown>,
  messages: { inFlight: string; tooMany: string }
): Promise<Job> {
  const fingerprint = submissionKey(sourceKey, work)
  if (inFlightSubmissions.has(fingerprint)) {
    throw new CloudJobSubmissionBlockedError(messages.inFlight)
  }
  let requestKey = unresolvedSubmissions.get(fingerprint)
  if (!requestKey) {
    // Why: never evict safety state; an evicted key could re-create paid work.
    if (unresolvedSubmissions.size >= MAX_UNRESOLVED_SUBMISSIONS) {
      throw new CloudJobSubmissionBlockedError(messages.tooMany)
    }
    requestKey = newCloudJobRequestKey()
    // Why: recorded before sending, so a lost reply is retried with this key.
    unresolvedSubmissions.set(fingerprint, requestKey)
  }
  inFlightSubmissions.add(fingerprint)
  try {
    const job = parseCloudJobWriteResult(await send({ ...work, requestKey }))
    if (unresolvedSubmissions.get(fingerprint) === requestKey) {
      unresolvedSubmissions.delete(fingerprint)
    }
    return job
  } finally {
    inFlightSubmissions.delete(fingerprint)
  }
}

export function clearUnresolvedSubmissionsForTests(): void {
  unresolvedSubmissions.clear()
  inFlightSubmissions.clear()
}
