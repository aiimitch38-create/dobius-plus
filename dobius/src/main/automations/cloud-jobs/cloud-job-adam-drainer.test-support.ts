import type {
  CloudJobAdamBindingResponse,
  CloudJobAdamReceipt,
  CloudJobAdamReceiptAck
} from '../../../shared/cloud-job-adam-receipts'
import { canonicalCloudJobAdamSha256 } from '../../../shared/cloud-job-adam-receipts'
import type { CloudJobAdamClient } from './cloud-job-adam-client'
import type { CloudJobAdamResult } from './cloud-job-adam-transport'

export type SubmitReceipt = (
  binding: CloudJobAdamBindingResponse,
  receipt: CloudJobAdamReceipt
) => Promise<CloudJobAdamResult<CloudJobAdamReceiptAck>>

export function syntheticClient(submit: SubmitReceipt): Pick<CloudJobAdamClient, 'submitReceipt'> {
  return {
    submitReceipt: async (binding, rawReceipt) =>
      submit(binding as CloudJobAdamBindingResponse, rawReceipt as CloudJobAdamReceipt)
  }
}

export function acceptedAck(
  receipt: CloudJobAdamReceipt,
  accepted: 'inserted' | 'duplicate' = 'inserted',
  storedAtMs = 7_500
): CloudJobAdamReceiptAck {
  return {
    schemaVersion: 1,
    ok: true,
    receiptId: receipt.receiptId,
    payloadSha256: canonicalCloudJobAdamSha256(receipt),
    accepted,
    storedAtMs,
    parentStateChanged: false
  }
}
