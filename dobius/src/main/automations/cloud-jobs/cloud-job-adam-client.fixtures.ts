import {
  canonicalCloudJobAdamSha256,
  type CloudJobAdamBindingGrant,
  type CloudJobAdamBindingIdentity,
  type CloudJobAdamBindingResponse,
  type CloudJobAdamReceipt,
  type CloudJobAdamReceiptAck
} from '../../../shared/cloud-job-adam-receipts'
import { CloudJobInput } from '../../../shared/cloud-jobs'

export const adamJobInput = () => ({
  requestKey: 'request-1',
  taskId: 'task-1',
  projectId: 'project-1',
  workspaceId: 'workspace-1',
  targetDeviceId: 'worker-1',
  recipeId: 'recipe-1',
  title: 'Run synthetic check',
  sourceRevision: 'a'.repeat(40),
  estimatedBytes: 100,
  dependencies: []
})

export const adamBindingIdentity = (): CloudJobAdamBindingIdentity => ({
  schemaVersion: 1,
  bindingId: 'b318dc55-1f52-4eaf-9e77-9b5ca269cf97',
  adamInstanceId: 'adam-local',
  parentObjectiveId: 'objective-1',
  parentObjectiveVersion: 7,
  projectId: 'project-1',
  contextDigest: 'c'.repeat(64),
  requestFingerprint: canonicalCloudJobAdamSha256(CloudJobInput.parse(adamJobInput())),
  expiresAtMs: 9_000
})

export const adamBindingGrant = (): CloudJobAdamBindingGrant => ({
  ...adamBindingIdentity(),
  capability: 'synthetic-one-use-capability-not-a-real-secret'
})

export const adamBindingResponse = (): CloudJobAdamBindingResponse => {
  const binding = adamBindingIdentity()
  return {
    schemaVersion: 1,
    consumed: true,
    binding,
    boundAtMs: 5_000,
    bindingDigest: canonicalCloudJobAdamSha256(binding)
  }
}

export const adamReceipt = (): CloudJobAdamReceipt => ({
  schemaVersion: 1,
  receiptId: 'f782b91c-739c-4b57-a1b9-64931c5c79d3',
  bindingId: adamBindingIdentity().bindingId,
  adamInstanceId: 'adam-local',
  parentObjectiveId: 'objective-1',
  parentObjectiveVersion: 7,
  cloudJobId: 'f27995d3-5a22-462c-93f0-37dcd1f98841',
  cloudJobVersion: 3,
  cloudEventSequence: 11,
  attemptId: 'ed0be264-07f9-4a91-9c5d-f7078ed8453f',
  attemptNumber: 1,
  eventKind: 'execution_needs_review',
  cloudJobState: 'needs_review',
  projectId: 'project-1',
  contextDigest: 'c'.repeat(64),
  evidenceDigests: [{ evidenceId: 'evidence-1', sha256: 'd'.repeat(64) }],
  occurredAtMs: 5_100
})

export const adamAck = (receipt = adamReceipt()): CloudJobAdamReceiptAck => ({
  schemaVersion: 1,
  ok: true,
  receiptId: receipt.receiptId,
  payloadSha256: canonicalCloudJobAdamSha256(receipt),
  accepted: 'inserted',
  storedAtMs: 5_200,
  parentStateChanged: false
})
