// Proof that the morning brief texts Carson himself (Codex review of 7.16): the
// handle set in Settings is only used once Carson typed back a 4-digit code
// that was texted to it. Changing the handle drops the proof, because only the
// exact handle that was verified counts.
import { randomInt } from 'node:crypto'
import type { BriefHandleResult, BriefHandleStatus } from '../../shared/adam-speaks-up'

const CODE_TTL_MS = 15 * 60_000
const RESEND_GAP_MS = 60_000
const MAX_TRIES = 5

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

  async sendCode(): Promise<BriefHandleResult> {
    const handle = this.current()
    if (!handle) {
      return this.fail('Set your handle in Settings, iMessage bridge first.')
    }
    if (this.pending && this.now() - this.pending.sentAt < RESEND_GAP_MS) {
      return this.fail('A code was just sent. Wait a minute before sending another.')
    }
    const code = this.deps.code?.() ?? String(randomInt(1000, 10_000))
    try {
      await this.deps.send(handle, `Your Dobius+ code is ${code}. Type it in Settings to confirm this is your number.`)
    } catch (error) {
      return this.fail(`The text could not be sent: ${error instanceof Error ? error.message : String(error)}`)
    }
    this.pending = { handle, code, sentAt: this.now(), tries: 0 }
    return { ok: true, status: this.status() }
  }

  confirm(raw: unknown): BriefHandleResult {
    const pending = this.pending
    const handle = this.current()
    if (!pending || !same(pending.handle, handle) || this.now() - pending.sentAt >= CODE_TTL_MS) {
      this.pending = null
      return this.fail('No code is waiting. Send a test text first.')
    }
    if (typeof raw !== 'string' || raw.trim() !== pending.code) {
      pending.tries += 1
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
