// Proof that the morning brief texts Carson himself (Codex review of 7.16): the
// handle set in Settings is only used once Carson typed back a 4-digit code
// that was texted to it. Changing the handle drops the proof, because only the
// exact handle that was verified counts.
import { randomInt } from 'node:crypto'
import type { BriefHandleResult, BriefHandleStatus } from '../../shared/adam-speaks-up'

const CODE_TTL_MS = 15 * 60_000
const RESEND_GAP_MS = 60_000
const MAX_TRIES = 5
const HOUR_MS = 60 * 60_000
// Why caps across codes: a fresh code resets the per-code tries, so without
// them a caller could keep guessing (Codex review of f043583b).
const MAX_CODES_PER_HOUR = 3
const MAX_WRONG_PER_HOUR = 10
export const BRIEF_HANDLE_LOCKED = 'Too many tries, try again in an hour.'

export type BriefHandleDeps = {
  /** The iMessage bridge "your handle" setting, read at each use. */
  handle: () => string | null
  /** Texts the handle; rejects when it cannot. */
  send: (handle: string, text: string) => Promise<void>
  verifiedHandle: () => string | null
  /** Saves the verified handle (null clears); false when it could not be saved. */
  setVerifiedHandle: (handle: string | null) => boolean
  now?: () => number
  code?: () => string
}

const same = (a: string | null, b: string | null): boolean =>
  a !== null && b !== null && a.trim().toLowerCase() === b.trim().toLowerCase()

export class BriefHandleVerifier {
  private pending: { handle: string; code: string; sentAt: number; tries: number } | null = null
  /** Apart from `pending`, so dropping a code never lifts the resend wait. */
  private lastSentAt = Number.NEGATIVE_INFINITY
  private sentTimes: number[] = []
  private wrongTimes: number[] = []
  private lockedUntil = Number.NEGATIVE_INFINITY
  private readonly now: () => number

  constructor(private readonly deps: BriefHandleDeps) {
    this.now = deps.now ?? Date.now
  }

  private current(): string | null {
    return this.deps.handle()?.trim() || null
  }

  /** True only for the exact handle Carson confirmed; a changed handle clears the proof. */
  isVerified(): boolean {
    const verified = this.deps.verifiedHandle()
    if (verified !== null && !same(verified, this.current())) {
      this.deps.setVerifiedHandle(null)
      return false
    }
    return verified !== null
  }

  status(): BriefHandleStatus {
    const handle = this.current()
    const pending = this.pending
    const codeSent =
      pending !== null && same(pending.handle, handle) && this.now() - pending.sentAt < CODE_TTL_MS
    return { handle, verified: this.isVerified(), codeSent }
  }

  /** True while locked; starts the hour's lock when a cap is reached. */
  private locked(): boolean {
    const now = this.now()
    this.sentTimes = this.sentTimes.filter((at) => now - at < HOUR_MS)
    this.wrongTimes = this.wrongTimes.filter((at) => now - at < HOUR_MS)
    return now < this.lockedUntil
  }

  private lock(): BriefHandleResult {
    this.lockedUntil = this.now() + HOUR_MS
    this.pending = null
    return this.fail(BRIEF_HANDLE_LOCKED)
  }

  async sendCode(): Promise<BriefHandleResult> {
    const handle = this.current()
    if (!handle) {
      return this.fail('Set your handle in Settings, iMessage bridge first.')
    }
    if (this.locked()) {
      return this.fail(BRIEF_HANDLE_LOCKED)
    }
    if (this.now() - this.lastSentAt < RESEND_GAP_MS) {
      return this.fail('A code was just sent. Wait a minute before sending another.')
    }
    if (this.sentTimes.length >= MAX_CODES_PER_HOUR) {
      return this.lock()
    }
    // Why before the send: a failing send still waits, so it cannot be retried in a loop.
    this.lastSentAt = this.now()
    const code = this.deps.code?.() ?? String(randomInt(1000, 10_000))
    try {
      await this.deps.send(handle, `Your Dobius+ code is ${code}. Type it in Settings to confirm this is your number.`)
    } catch (error) {
      return this.fail(`The text could not be sent: ${error instanceof Error ? error.message : String(error)}`)
    }
    this.sentTimes.push(this.now())
    this.pending = { handle, code, sentAt: this.now(), tries: 0 }
    return { ok: true, status: this.status() }
  }

  confirm(raw: unknown): BriefHandleResult {
    if (this.locked()) {
      return this.fail(BRIEF_HANDLE_LOCKED)
    }
    const pending = this.pending
    const handle = this.current()
    if (!pending || !same(pending.handle, handle) || this.now() - pending.sentAt >= CODE_TTL_MS) {
      this.pending = null
      return this.fail('No code is waiting. Send a test text first.')
    }
    if (typeof raw !== 'string' || raw.trim() !== pending.code) {
      pending.tries += 1
      this.wrongTimes.push(this.now())
      if (this.wrongTimes.length >= MAX_WRONG_PER_HOUR) {
        return this.lock()
      }
      if (pending.tries >= MAX_TRIES) {
        this.pending = null
        return this.fail('Too many wrong codes. Send a new test text.')
      }
      return this.fail('That code does not match.')
    }
    this.pending = null
    if (!this.deps.setVerifiedHandle(pending.handle)) {
      return this.fail('The number was confirmed but could not be saved. Try again.')
    }
    return { ok: true, status: this.status() }
  }

  private fail(error: string): BriefHandleResult {
    return { ok: false, error, status: this.status() }
  }
}
