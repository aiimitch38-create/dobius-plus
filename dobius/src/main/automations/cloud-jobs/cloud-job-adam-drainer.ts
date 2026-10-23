import type SyncDatabase from '../../sqlite/sync-database'
import { CloudJobAdamReceiptAck } from '../../../shared/cloud-job-adam-receipts'
import type { CloudJobAdamClient } from './cloud-job-adam-client'
import {
  acknowledgeCloudJobAdamReceipt,
  claimNextCloudJobAdamReceipt,
  recordCloudJobAdamReceiptFailure
} from './cloud-job-adam-outbox-lease'
import {
  CloudJobAdamOutboxLeaseMs,
  CloudJobAdamOutboxLeaseOwner,
  CloudJobAdamOutboxNow,
  type CloudJobAdamOutboxFailure as Failure
} from './cloud-job-adam-outbox-schema'
import {
  emptyTick,
  drainerIntervalMs,
  drainerStopWaitMs,
  mapUnavailable,
  parseFailure,
  readConsumedBinding,
  type CloudJobAdamDrainerOptions,
  type CloudJobAdamDrainerStop,
  type CloudJobAdamDrainerTick
} from './cloud-job-adam-drainer-contract'

/** Main-only adapter over the existing shared CloudJobStore SQLite connection and outbox CAS helpers. */
export class CloudJobAdamOutboxDrainer {
  private readonly owner: string
  private readonly now: () => number
  private readonly authorityAvailable: () => boolean
  private readonly leaseMs: number
  private readonly intervalMs: number
  private readonly maxBatch: number
  private accepting = false
  private started = false
  private stopped = false
  private settlementOpen = true
  private activeTick: Promise<CloudJobAdamDrainerTick> | null = null
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly db: SyncDatabase,
    private readonly client: Pick<CloudJobAdamClient, 'submitReceipt'>,
    options: CloudJobAdamDrainerOptions
  ) {
    this.owner = CloudJobAdamOutboxLeaseOwner.parse(options.owner)
    this.now = options.now
    this.authorityAvailable = options.authorityAvailable
    this.leaseMs = CloudJobAdamOutboxLeaseMs.parse(options.leaseMs ?? 10_000)
    this.intervalMs = drainerIntervalMs.parse(options.intervalMs ?? 1_000)
    this.maxBatch = options.maxBatch ?? 8
    if (!Number.isSafeInteger(this.maxBatch) || this.maxBatch < 1 || this.maxBatch > 32) {
      throw new RangeError('ADAM drainer batch size must be an integer from 1 to 32.')
    }
  }

  /** Starts one immediate tick and then bounded, non-overlapping periodic ticks. */
  start(): Promise<CloudJobAdamDrainerTick> {
    if (this.started || this.stopped) {
      throw new Error('ADAM outbox drainer has already been started.')
    }
    this.started = true
    this.accepting = true
    this.settlementOpen = true
    this.timer = setInterval(() => {
      void this.runOwnedTick()
    }, this.intervalMs)
    this.timer.unref?.()
    return this.runOwnedTick()
  }

  /** Closes admission synchronously; a timeout abandons settlement and preserves the live lease. */
  stop(timeoutMs = 5_000): Promise<CloudJobAdamDrainerStop> {
    this.accepting = false
    this.stopped = true
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    const active = this.activeTick
    if (!active) {
      return Promise.resolve('drained')
    }
    const waitMs = drainerStopWaitMs.parse(timeoutMs)
    return new Promise((resolve) => {
      let settled = false
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          this.settlementOpen = false
          resolve('timed-out')
        }
      }, waitMs)
      void active.then(() => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          resolve('drained')
        }
      })
    })
  }

  private runOwnedTick(): Promise<CloudJobAdamDrainerTick> {
    if (!this.accepting) {
      return Promise.resolve(emptyTick('not-running'))
    }
    if (this.activeTick) {
      return this.activeTick
    }
    const operation = Promise.resolve()
      .then(() => {
        if (!this.accepting) {
          return emptyTick('not-running')
        }
        return this.drainBatch()
      })
      .catch(() => emptyTick('failed'))
    this.activeTick = operation
    void operation.then(() => {
      if (this.activeTick === operation) {
        this.activeTick = null
      }
    })
    return operation
  }

  private async drainBatch(): Promise<CloudJobAdamDrainerTick> {
    if (!this.accepting) {
      return emptyTick('not-running')
    }
    const result = emptyTick('completed')
    const bindings = this.db
      .prepare(
        `SELECT binding_id FROM cloud_job_adam_receipt_outbox
         WHERE state IN ('pending', 'leased') GROUP BY binding_id
         ORDER BY MIN(cloud_event_sequence), binding_id LIMIT ?`
      )
      .all(this.maxBatch)
    let claimedCount = 0
    for (const row of bindings) {
      const bindingId = String(row.binding_id)
      while (this.accepting && claimedCount < this.maxBatch) {
        const nowMs = CloudJobAdamOutboxNow.parse(this.now())
        if (!this.accepting) {
          break
        }
        const authorizedToClaim = this.isAuthorityAvailable()
        if (!authorizedToClaim || !this.accepting) {
          result.retained += 1
          break
        }
        const claim = claimNextCloudJobAdamReceipt(this.db, {
          bindingId,
          owner: this.owner,
          nowMs,
          leaseMs: this.leaseMs
        })
        if (claim.state !== 'claimed') {
          if (claim.state === 'blocked') {
            result.blocked += 1
          }
          break
        }
        claimedCount += 1
        if (!this.accepting) {
          result.retained += 1
          break
        }
        if (claim.request.receipt.bindingId !== claim.bindingId) {
          const settled = this.settleFailure(claim, 'malformed-response')
          if (settled === 'blocked') {
            result.blocked += 1
          } else {
            result.retained += 1
          }
          break
        }
        const binding = readConsumedBinding(
          this.db,
          claim.bindingId,
          claim.request.receipt.cloudJobId
        )
        if (!binding) {
          const settled = this.settleFailure(claim, 'malformed-response')
          if (settled === 'blocked') {
            result.blocked += 1
          } else {
            result.retained += 1
          }
          break
        }
        let submitted: Awaited<ReturnType<CloudJobAdamClient['submitReceipt']>>
        try {
          // No await or work is allowed between this authority check and the network invocation.
          const authorized = this.isAuthorityAvailable()
          if (!authorized || !this.accepting) {
            result.retained += 1
            break
          }
          submitted = await this.client.submitReceipt(binding, claim.request.receipt)
        } catch {
          result.retained += 1
          break
        }
        if (!this.settlementOpen) {
          result.retained += 1
          break
        }
        if (submitted.state === 'unavailable') {
          const failure = mapUnavailable(submitted.reason)
          if (failure === 'retain') {
            result.retained += 1
            break
          }
          const settled = this.settleFailure(claim, failure)
          if (settled === 'retry') {
            result.retried += 1
          } else if (settled === 'blocked') {
            result.blocked += 1
          } else {
            result.retained += 1
          }
          break
        }
        const ack = CloudJobAdamReceiptAck.safeParse(submitted.value)
        if (
          !ack.success ||
          ack.data.receiptId !== claim.receiptId ||
          ack.data.payloadSha256 !== claim.request.payloadSha256
        ) {
          const settled = this.settleFailure(claim, 'malformed-response')
          if (settled === 'blocked') {
            result.blocked += 1
          } else {
            result.retained += 1
          }
          break
        }
        if (!this.canSettle()) {
          result.retained += 1
          break
        }
        try {
          acknowledgeCloudJobAdamReceipt(this.db, {
            receiptId: claim.receiptId,
            owner: claim.owner,
            nonce: claim.nonce,
            ack: ack.data,
            nowMs: CloudJobAdamOutboxNow.parse(this.now())
          })
          result.acknowledged += 1
        } catch {
          result.retained += 1
          break
        }
      }
      if (!this.accepting || claimedCount >= this.maxBatch) {
        break
      }
    }
    return result
  }

  private settleFailure(
    claim: Extract<ReturnType<typeof claimNextCloudJobAdamReceipt>, { state: 'claimed' }>,
    failure: Failure
  ): 'retry' | 'blocked' | null {
    if (!this.canSettle()) {
      return null
    }
    try {
      return recordCloudJobAdamReceiptFailure(this.db, {
        receiptId: claim.receiptId,
        owner: claim.owner,
        nonce: claim.nonce,
        failure: parseFailure(failure),
        nowMs: CloudJobAdamOutboxNow.parse(this.now())
      })
    } catch {
      return null
    }
  }

  private canSettle(): boolean {
    return this.settlementOpen && this.isAuthorityAvailable()
  }

  private isAuthorityAvailable(): boolean {
    try {
      return this.authorityAvailable() === true
    } catch {
      return false
    }
  }
}
