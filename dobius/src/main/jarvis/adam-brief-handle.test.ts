import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BriefHandleVerifier } from './adam-brief-handle'

let now = 0
let handle: string | null = '+15551234567'
let verified: string | null = null
const send = vi.fn(async (_handle: string, _text: string) => undefined)

function verifier(): BriefHandleVerifier {
  return new BriefHandleVerifier({
    handle: () => handle,
    send,
    verifiedHandle: () => verified,
    setVerifiedHandle: (next) => {
      verified = next
      return true
    },
    now: () => now,
    code: () => '4821'
  })
}

beforeEach(() => {
  now = 0
  handle = '+15551234567'
  verified = null
  send.mockReset()
  send.mockResolvedValue(undefined)
})

describe('BriefHandleVerifier', () => {
  it('texts a 4-digit code and verifies the handle when it is typed back', async () => {
    const check = verifier()
    expect(check.isVerified()).toBe(false)
    expect(await check.sendCode()).toMatchObject({ ok: true, status: { codeSent: true, verified: false } })
    expect(send).toHaveBeenCalledWith('+15551234567', expect.stringContaining('4821'))
    expect(check.confirm(' 4821 ')).toMatchObject({ ok: true, status: { verified: true } })
    expect(verified).toBe('+15551234567')
    expect(check.isVerified()).toBe(true)
  })

  it('refuses a wrong code, and drops the code after 5 wrong tries', async () => {
    const check = verifier()
    await check.sendCode()
    for (let i = 0; i < 4; i += 1) {
      expect(check.confirm('0000')).toMatchObject({ ok: false, error: 'That code does not match.' })
    }
    expect(check.confirm('0000')).toMatchObject({ ok: false, error: expect.stringMatching(/Too many/) })
    expect(check.confirm('4821')).toMatchObject({ ok: false })
    expect(verified).toBeNull()
  })

  it('a changed handle clears the proof and the waiting code', async () => {
    const check = verifier()
    await check.sendCode()
    check.confirm('4821')
    handle = '+15559999999'
    expect(check.isVerified()).toBe(false)
    expect(verified).toBeNull()
    handle = '+15551234567'
    expect(check.isVerified()).toBe(false)
    now = 2 * 60_000
    await check.sendCode()
    handle = 'other@example.com'
    expect(check.confirm('4821')).toMatchObject({ ok: false })
  })

  it('expires a code after 15 minutes, limits resends, and reports send failures', async () => {
    const check = verifier()
    await check.sendCode()
    expect(await check.sendCode()).toMatchObject({ ok: false, error: expect.stringMatching(/Wait a minute/) })
    now = 15 * 60_000
    expect(check.confirm('4821')).toMatchObject({ ok: false, error: expect.stringMatching(/No code/) })
    send.mockRejectedValueOnce(new Error('Not authorized'))
    expect(await check.sendCode()).toMatchObject({ ok: false, error: expect.stringMatching(/Not authorized/) })
    handle = null
    expect(await check.sendCode()).toMatchObject({ ok: false, error: expect.stringMatching(/Set your handle/) })
  })
})
