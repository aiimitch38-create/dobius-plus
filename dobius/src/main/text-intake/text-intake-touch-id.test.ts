// Codex round 2 on 7.17: Touch ID is the gate for every text that goes out.
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ systemPreferences: {} }))

import { memoryIntakeStore } from './intake-store'
import { cleanIntakeText } from './intake-text'
import { TextIntake } from './text-intake'
import { TOUCH_ID_REQUIRED, touchIdAuthorizeSend, touchIdReason } from './text-intake-wiring'

function setup(authorizeSend: (send: { toName: string; toHandle: string; text: string }) => Promise<string | null>) {
  const sendText = vi.fn(async (_handle: string, _text: string) => undefined)
  const intake = new TextIntake({
    store: memoryIntakeStore({ contacts: [{ name: 'Brett', handle: '+14798765432' }] }),
    createCard: () => ({ id: 't' }),
    sendText,
    sendUnavailable: () => null,
    authorizeSend,
    appendThread: async () => undefined,
    tap: () => undefined
  })
  const draft = intake.createDraft('Brett', 'at 3')
  const fingerprint = intake.view().drafts[0].fingerprint
  return { intake, sendText, id: draft.id, fingerprint }
}

describe('Touch ID gate', () => {
  it('sends only after Touch ID succeeds, naming the recipient and the exact text', async () => {
    const authorize = vi.fn(async () => null)
    const { intake, sendText, id, fingerprint } = setup(authorize)
    expect((await intake.sendDraft(id, fingerprint, 'at 3')).ok).toBe(true)
    expect(authorize).toHaveBeenCalledWith({ toName: 'Brett', toHandle: '+14798765432', text: 'at 3' })
    expect(sendText).toHaveBeenCalledWith('+14798765432', 'at 3')
    expect(sendText).toHaveBeenCalledTimes(1)
  })

  it('a refused or failing Touch ID sends nothing and the draft keeps waiting', async () => {
    for (const authorize of [
      async () => TOUCH_ID_REQUIRED,
      async () => {
        throw new Error('lockout')
      }
    ]) {
      const { intake, sendText, id, fingerprint } = setup(authorize)
      expect(await intake.sendDraft(id, fingerprint, 'at 3')).toMatchObject({ ok: false, error: /Not sent/ })
      expect(sendText).not.toHaveBeenCalled()
      expect(intake.view().drafts[0]).toMatchObject({ status: 'pending', text: 'at 3' })
    }
  })

  it('a second Send while Touch ID is open is refused', async () => {
    let finish: (value: string | null) => void = () => undefined
    const { intake, sendText, id, fingerprint } = setup(
      () => new Promise<string | null>((resolve) => (finish = resolve))
    )
    const first = intake.sendDraft(id, fingerprint, 'at 3')
    expect(await intake.sendDraft(id, fingerprint, 'at 3')).toMatchObject({ ok: false })
    finish(null)
    expect((await first).ok).toBe(true)
    expect(sendText).toHaveBeenCalledTimes(1)
  })
})

const BRETT_SEND = { toName: 'Brett', toHandle: '+14798765432', text: 'at 3' }

describe('touchIdAuthorizeSend', () => {
  it('previews the first 80 characters, then the full length', () => {
    const long = 'x'.repeat(90)
    expect(touchIdReason({ ...BRETT_SEND, text: long })).toBe(
      `send a text to Brett (+14798765432): "${'x'.repeat(80)}… (90 characters)"`
    )
  })

  it('refuses without Touch ID, with no click fallback', async () => {
    const none = { canPromptTouchID: () => false, promptTouchID: vi.fn(async () => undefined) }
    expect(await touchIdAuthorizeSend(BRETT_SEND, none, 'darwin')).toBe('Sending needs Touch ID on this Mac')
    expect(none.promptTouchID).not.toHaveBeenCalled()
    const yes = { canPromptTouchID: () => true, promptTouchID: vi.fn(async () => undefined) }
    expect(await touchIdAuthorizeSend(BRETT_SEND, yes, 'linux')).toBe(TOUCH_ID_REQUIRED)
  })

  it('prompts with the recipient and maps cancel to a refusal', async () => {
    const ok = { canPromptTouchID: () => true, promptTouchID: vi.fn(async () => undefined) }
    expect(await touchIdAuthorizeSend(BRETT_SEND, ok, 'darwin')).toBeNull()
    expect(ok.promptTouchID).toHaveBeenCalledWith('send a text to Brett (+14798765432): "at 3"')
    const cancel = { canPromptTouchID: () => true, promptTouchID: vi.fn(async () => {
        throw new Error('cancel')
      }) }
    expect(await touchIdAuthorizeSend(BRETT_SEND, cancel, 'darwin')).toBe('Touch ID was not confirmed.')
  })
})

describe('redaction round 2', () => {
  it('takes a whole Digest header to the end of its line', () => {
    const raw =
      'see below\nAuthorization: Digest username="carson", realm="x", nonce="dcd98b7102dd2f0e", response="6629fae49393a053"\nthanks'
    const clean = cleanIntakeText(raw)
    expect(clean).not.toMatch(/dcd98b|6629fae|username|realm/)
    expect(clean).toContain('see below')
    expect(clean).toContain('thanks')
  })

  it('an escaped quote inside a quoted password does not end redaction', () => {
    const clean = cleanIntakeText('"password": "correct \\"horse\\" battery staple" ok')
    expect(clean).not.toMatch(/horse|battery|staple/)
    expect(clean).toContain('ok')
  })
})
