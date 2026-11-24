// Codex review of 37231733: one test block per finding.
import { describe, expect, it, vi } from 'vitest'
import { canonicalHandle, contactHandleSpellings, sameContactHandle } from './contact-handle'
import { memoryIntakeStore } from './intake-store'
import { cleanIntakeText } from './intake-text'
import { draftFingerprint, TextIntake } from './text-intake'

const NORWAY = '+4798765432'
const US = '+14798765432'

function intakeWith(
  contacts: { name: string; handle: string; startRowid?: number }[],
  authorizeSend: () => Promise<string | null> = async () => null
) {
  const sendText = vi.fn(async (_handle: string, _text: string) => undefined)
  const intake = new TextIntake({
    store: memoryIntakeStore({ contacts }),
    createCard: () => ({ id: 't' }),
    sendText,
    sendUnavailable: () => null,
    authorizeSend,
    appendThread: async () => undefined,
    tap: () => undefined
  })
  return { intake, sendText }
}

describe('P1: one canonical handle comparison', () => {
  it('keeps Norway +4798765432 and US +14798765432 apart', () => {
    expect(canonicalHandle(NORWAY)).toBe('+4798765432')
    expect(canonicalHandle(US)).toBe('+14798765432')
    expect(sameContactHandle(NORWAY, US)).toBe(false)
    expect(contactHandleSpellings(NORWAY)).toEqual(['+4798765432'])
    expect(contactHandleSpellings(US)).toEqual(['+14798765432', '14798765432', '4798765432'])
    expect(contactHandleSpellings(NORWAY).some((s) => contactHandleSpellings(US).includes(s))).toBe(false)
  })

  it('adds +1 only to a bare 10-digit number, keeps typed country codes, emails exact', () => {
    expect(canonicalHandle('(479) 876-5432')).toBe('+14798765432')
    expect(canonicalHandle('1 479 876 5432')).toBe('+14798765432')
    expect(canonicalHandle('+44 20 7946 0958')).toBe('+442079460958')
    expect(canonicalHandle(' Sam@Example.com ')).toBe('sam@example.com')
    expect(sameContactHandle('sam@example.com', 'sam@example.co')).toBe(false)
  })

  it('a Norwegian contact never takes a US text, and a draft goes to the exact number', async () => {
    const { intake, sendText } = intakeWith([{ name: 'Ola', handle: NORWAY }])
    expect(intake.ingest({ messageId: 'g1', handle: US, text: 'can you call?' })).toBe('ignored')
    expect(intake.ingest({ messageId: 'g2', handle: '4798765432', text: 'can you call?' })).toBe('ignored')
    expect(intake.ingest({ messageId: 'g3', handle: NORWAY, text: 'can you call?' })).toBe('suggested')
    const draft = intake.createDraft('Ola', 'hei')
    const fingerprint = intake.view().drafts[0].fingerprint
    expect((await intake.sendDraft(draft.id, fingerprint, 'hei')).ok).toBe(true)
    expect(sendText).toHaveBeenCalledWith(NORWAY, 'hei')
  })

  it('dedupes contacts by canonical handle', () => {
    const { intake } = intakeWith([])
    intake.setContacts([
      { name: 'A', handle: '479-876-5432' },
      { name: 'B', handle: US },
      { name: 'C', handle: NORWAY }
    ])
    expect(intake.view().contacts.map((c) => c.name)).toEqual(['A', 'C'])
  })
})

describe('P1: Send is bound to the exact draft shown', () => {
  it('refuses a missing or stale fingerprint and sends nothing', async () => {
    const { intake, sendText } = intakeWith([{ name: 'Brett', handle: US }])
    const draft = intake.createDraft('Brett', 'at 3')
    expect(await intake.sendDraft(draft.id, undefined, 'at 3')).toMatchObject({ ok: false, error: /changed since/ })
    expect(await intake.sendDraft(draft.id, 'forged', 'at 3')).toMatchObject({ ok: false, error: /changed since/ })
    const swapped = draftFingerprint({ ...draft, text: 'something else' })
    expect(await intake.sendDraft(draft.id, swapped, 'at 3')).toMatchObject({ ok: false })
    const otherRecipient = draftFingerprint({ ...draft, toHandle: NORWAY })
    expect(await intake.sendDraft(draft.id, otherRecipient, 'at 3')).toMatchObject({ ok: false })
    expect(sendText).not.toHaveBeenCalled()
  })
})

describe('Send carries exactly the fingerprinted text', () => {
  it('refuses text that differs from the checked draft, before Touch ID', async () => {
    const authorizeSend = vi.fn(async () => null)
    const { intake, sendText } = intakeWith([{ name: 'Brett', handle: US }], authorizeSend)
    const draft = intake.createDraft('Brett', 'at 3')
    const fingerprint = intake.view().drafts[0].fingerprint
    for (const text of ['at 4', undefined, 'at 3 ']) {
      expect(await intake.sendDraft(draft.id, fingerprint, text)).toMatchObject({ ok: false, error: /not the text that was checked/ })
    }
    expect(authorizeSend).not.toHaveBeenCalled()
    expect(sendText).not.toHaveBeenCalled()
    expect(intake.view().drafts[0]).toMatchObject({ status: 'pending', text: 'at 3' })
  })

  it('an edit is saved first and re-fingerprinted; the old fingerprint then fails', async () => {
    const { intake, sendText } = intakeWith([{ name: 'Brett', handle: US }])
    const draft = intake.createDraft('Brett', 'at 3')
    const before = intake.view().drafts[0].fingerprint
    expect(intake.editDraft(draft.id, before, 'at 4').ok).toBe(true)
    expect(await intake.sendDraft(draft.id, before, 'at 4')).toMatchObject({ ok: false, error: /changed since/ })
    const after = intake.view().drafts[0].fingerprint
    expect((await intake.sendDraft(draft.id, after, 'at 4')).ok).toBe(true)
    expect(sendText).toHaveBeenCalledWith(US, 'at 4')
    expect(intake.editDraft(draft.id, 'forged', 'x').ok).toBe(false)
  })
})

describe('P2: redaction takes whole values', () => {
  it.each([
    ['Authorization: Basic dXNlcjpwYXNz', 'dXNlcjpwYXNz'],
    ['authorization=Bearer abc.def.ghijkl', 'abc.def'],
    ['"Authorization": "Basic dXNlcjpwYXNz"', 'dXNlcjpwYXNz'],
    ['use Bearer eyJhbGciOiJIUzI1NiJ9 there', 'eyJhbGci'],
    ['"password": "correct horse battery staple"', 'horse'],
    ["password='correct horse battery staple' ok", 'battery'],
    ['api_key: "k e y s p a c e d"', 'k e y'],
    ['token=abc123def', 'abc123def'],
    ['Authorization:\n  Basic dXNlcjpwYXNz', 'dXNlcjpwYXNz'],
    ['Authorization:\r\nBearer abc.def.ghijkl end', 'abc.def'],
    ['"Authorization":\n"Basic dXNlcjpwYXNz"', 'dXNlcjpwYXNz'],
    ['Proxy-Authorization:   \n\tNegotiate YIIBhgYGKwYBBQUC', 'YIIBhg'],
    ['Authorization: Basic\n dXNlcjpwYXNz', 'dXNlcjpwYXNz'],
    ['Authorization: Basic\r\n\tdXNlcjpwYXNz\nnext line', 'dXNlcjpwYXNz'],
    ['Authorization: Digest username="c", realm="x",\n  nonce="dcd98b7102dd2f0e",\n  response="6629fae49393a053"', '6629fae4'],
    ['Authorization: Digest username="c",\n\tnonce="dcd98b7102dd2f0e"', 'dcd98b71']
  ])('redacts %s', (raw, leaked) => {
    const clean = cleanIntakeText(raw)
    expect(clean).not.toContain(leaked)
    expect(clean).toContain('[redacted')
  })

  it('redacts before cutting, and leaves normal words alone', () => {
    const late = `${'x '.repeat(600)}"password": "correct horse battery staple"`
    expect(cleanIntakeText(late)).not.toContain('horse')
    expect(cleanIntakeText('The author: Sam. Basic plan is fine.')).toBe('The author: Sam. Basic plan is fine.')
    const folded = cleanIntakeText('Authorization: Basic\n dXNlcjpwYXNz\nsee you at 3')
    expect(folded).not.toContain('dXNlcjpwYXNz')
    expect(folded).toMatch(/\[redacted[^\]]*\] see you at 3$/)
  })
})

describe('P2: a newly tracked contact starts at the newest row', () => {
  it('only tracked contacts with a start row are read; saving never takes a start from Settings', () => {
    const { intake } = intakeWith([])
    intake.setContacts([{ name: 'Brett', handle: US, startRowid: 0 }])
    expect(intake.needsStart()).toBe(true)
    expect(intake.trackedSpellings()).toEqual([])
    intake.startTracking(900)
    expect(intake.trackedSpellings()).toContainEqual({ spelling: US, start: 900 })
    intake.setContacts([{ name: 'Brett B', handle: US }, { name: 'Ola', handle: NORWAY }])
    expect(intake.view().contacts).toEqual([
      { name: 'Brett B', handle: US, startRowid: 900 },
      { name: 'Ola', handle: NORWAY }
    ])
  })
})
