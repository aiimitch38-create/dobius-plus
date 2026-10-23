import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CloudJobInput } from '../../../dobius/src/shared/cloud-jobs.ts'
import { canonicalCloudJobAdamJson, canonicalCloudJobAdamSha256 } from '../../../dobius/src/shared/cloud-job-adam-receipts.ts'
import { parseApprovedJobIntent } from './service/src/dobius-cloud/approved-job-payload.ts'
import { canonicalCloudJobAdamSha256 as adamSha256 } from './service/src/dobius-cloud/receipt-contract.ts'

describe('ADAM approved payload fingerprint compatibility', () => {
  it('matches the live Dobius CloudJobInput parser and canonical digest', () => {
    const job = CloudJobInput.parse({
      requestKey: 'child-request', taskId: 'task-1', projectId: 'project', workspaceId: 'workspace',
      targetDeviceId: 'hermes-1', recipeId: 'build', title: '  Approved child  ', sourceRevision: 'a'.repeat(40),
      estimatedBytes: 0, dependencies: []
    })
    const fingerprint = canonicalCloudJobAdamSha256(job)
    const request = {
      intentId: '8f084f3e-e22e-4413-bc7e-b271cb5626b5', parentObjectiveId: 'parent-1',
      parentObjectiveVersion: 1, projectId: 'project', contextDigest: 'b'.repeat(64),
      requestFingerprint: fingerprint, ttlMs: 60_000, approvedJob: job
    }
    const raw = canonicalCloudJobAdamJson(request)
    const parsed = parseApprovedJobIntent(raw)
    assert.equal(parsed.approvedPayloadJson, canonicalCloudJobAdamJson(job))
    assert.equal(parsed.approvedPayloadDigest, fingerprint)
    assert.equal(parsed.approvedPayloadDigest, adamSha256(job))
  })
})
