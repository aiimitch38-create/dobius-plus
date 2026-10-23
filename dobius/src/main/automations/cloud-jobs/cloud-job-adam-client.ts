import {
  CloudJobAdamBindingConsumeRequest,
  CloudJobAdamBindingGrant,
  CloudJobAdamBindingIdentity,
  CloudJobAdamBindingResponse,
  CloudJobAdamReceipt,
  CloudJobAdamReceiptAck,
  CloudJobAdamReceiptRequest,
  canonicalCloudJobAdamJson,
  canonicalCloudJobAdamSha256,
  type CloudJobAdamBindingResponse as BindingResponse,
  type CloudJobAdamReceipt as Receipt,
  type CloudJobAdamReceiptAck as ReceiptAck
} from '../../../shared/cloud-job-adam-receipts'
import { CloudJobInput } from '../../../shared/cloud-jobs'
import {
  CloudJobAdamTransport,
  type CloudJobAdamResult,
  type CloudJobAdamTransportOptions,
  type CloudJobAdamUnavailableReason
} from './cloud-job-adam-transport'

const BINDING_PATH = 'v1/dobius/cloud-job-bindings/consume'
const RECEIPT_PATH = 'v1/dobius/cloud-job-receipts'

export type CloudJobAdamClientOptions = CloudJobAdamTransportOptions & { now?: () => number }

/** Main-process adapter only; network wiring remains owned by the parent service. */
export class CloudJobAdamClient {
  private readonly transport: CloudJobAdamTransport
  private readonly now: () => number

  constructor(options: CloudJobAdamClientOptions = {}) {
    this.transport = new CloudJobAdamTransport(options)
    this.now = options.now ?? Date.now
  }

  consumeBinding(
    rawGrant: unknown,
    rawJobInput: unknown
  ): Promise<CloudJobAdamResult<BindingResponse>> {
    return this.consumeBindingInternal(rawGrant, rawJobInput, false)
  }

  /** Replays an exact consumed response through ADAM after local grant expiry. */
  consumeBindingForRecovery(
    rawGrant: unknown,
    rawJobInput: unknown
  ): Promise<CloudJobAdamResult<BindingResponse>> {
    return this.consumeBindingInternal(rawGrant, rawJobInput, true)
  }

  private async consumeBindingInternal(
    rawGrant: unknown,
    rawJobInput: unknown,
    allowExpiredReplay: boolean
  ): Promise<CloudJobAdamResult<BindingResponse>> {
    const grantResult = CloudJobAdamBindingGrant.safeParse(rawGrant)
    const inputResult = CloudJobInput.safeParse(rawJobInput)
    if (!grantResult.success || !inputResult.success) {
      return unavailable('malformed-response')
    }
    const grant = grantResult.data
    const fingerprint = canonicalCloudJobAdamSha256(inputResult.data)
    if (
      inputResult.data.projectId !== grant.projectId ||
      fingerprint !== grant.requestFingerprint
    ) {
      return unavailable('receipt-binding-mismatch')
    }
    if (!allowExpiredReplay && grant.expiresAtMs <= this.now()) {
      return unavailable('expired-binding')
    }

    const identity = CloudJobAdamBindingIdentity.parse({
      schemaVersion: grant.schemaVersion,
      bindingId: grant.bindingId,
      adamInstanceId: grant.adamInstanceId,
      parentObjectiveId: grant.parentObjectiveId,
      parentObjectiveVersion: grant.parentObjectiveVersion,
      projectId: grant.projectId,
      contextDigest: grant.contextDigest,
      requestFingerprint: grant.requestFingerprint,
      expiresAtMs: grant.expiresAtMs
    })
    const body = canonicalCloudJobAdamJson(
      CloudJobAdamBindingConsumeRequest.parse({
        schemaVersion: 1,
        capability: grant.capability,
        binding: identity
      })
    )
    const result = await this.transport.postJson(BINDING_PATH, body)
    if (result.state !== 'accepted') {
      return result
    }
    const response = CloudJobAdamBindingResponse.safeParse(result.value)
    if (!response.success) {
      return unavailable('malformed-response')
    }
    if (!allowExpiredReplay && this.now() >= grant.expiresAtMs) {
      return unavailable('expired-binding')
    }
    if (response.data.boundAtMs >= grant.expiresAtMs) {
      return unavailable('expired-binding')
    }
    if (
      canonicalCloudJobAdamJson(response.data.binding) !== canonicalCloudJobAdamJson(identity) ||
      response.data.bindingDigest !== canonicalCloudJobAdamSha256(identity)
    ) {
      return unavailable('receipt-binding-mismatch')
    }
    return { state: 'accepted', value: response.data }
  }

  async submitReceipt(
    rawBinding: unknown,
    rawReceipt: unknown
  ): Promise<CloudJobAdamResult<ReceiptAck>> {
    const bindingResult = CloudJobAdamBindingResponse.safeParse(rawBinding)
    const receiptResult = CloudJobAdamReceipt.safeParse(rawReceipt)
    if (!bindingResult.success || !receiptResult.success) {
      return unavailable('malformed-response')
    }
    const binding = bindingResult.data
    const receipt = receiptResult.data
    if (
      binding.bindingDigest !== canonicalCloudJobAdamSha256(binding.binding) ||
      !sameReceiptBinding(binding, receipt)
    ) {
      return unavailable('receipt-binding-mismatch')
    }

    const payloadSha256 = canonicalCloudJobAdamSha256(receipt)
    const body = canonicalCloudJobAdamJson(
      CloudJobAdamReceiptRequest.parse({ schemaVersion: 1, receipt, payloadSha256 })
    )
    const result = await this.transport.postJson(RECEIPT_PATH, body)
    if (result.state !== 'accepted') {
      return result
    }
    const ack = CloudJobAdamReceiptAck.safeParse(result.value)
    if (
      !ack.success ||
      ack.data.receiptId !== receipt.receiptId ||
      ack.data.payloadSha256 !== payloadSha256 ||
      ack.data.parentStateChanged
    ) {
      return unavailable('receipt-ack-mismatch')
    }
    return { state: 'accepted', value: ack.data }
  }
}

export type CloudJobAdamSubmissionClient = Pick<CloudJobAdamClient, 'consumeBinding'> &
  Partial<Pick<CloudJobAdamClient, 'consumeBindingForRecovery'>>

function sameReceiptBinding(binding: BindingResponse, receipt: Receipt): boolean {
  return (
    receipt.bindingId === binding.binding.bindingId &&
    receipt.adamInstanceId === binding.binding.adamInstanceId &&
    receipt.parentObjectiveId === binding.binding.parentObjectiveId &&
    receipt.parentObjectiveVersion === binding.binding.parentObjectiveVersion &&
    receipt.projectId === binding.binding.projectId &&
    receipt.contextDigest === binding.binding.contextDigest
  )
}

function unavailable<T>(reason: CloudJobAdamUnavailableReason): CloudJobAdamResult<T> {
  return { state: 'unavailable', reason }
}
