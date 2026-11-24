// Codex review of 37231733: one test block per finding.
import { describe, expect, it, vi } from 'vitest'
import { canonicalHandle, contactHandleSpellings, sameContactHandle } from './contact-handle'
import { memoryIntakeStore } from './intake-store'
import { cleanIntakeText } from './intake-text'
import { draftFingerprint, TextIntake } from './text-intake'

const NORWAY = '+4798765432'
const US = '+14798765432'

function intakeWith(contacts: { name: string; handle: string; startRowid?: number }[]) {
  const sendText = vi.fn(async (_handle: string, _text: string) => undefined)
  const intake = new TextIntake({
    store: memoryIntakeStore({ contacts }),
    createCard: () => ({ id: 't' }),
    sendText,
    sendUnavailable: () => null,
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
    expect((await intake.sendDraft(draft.id, fingerprint)).ok).toBe(true)
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
    expect(await intake.sendDraft(draft.id, undefined)).toMatchObject({ ok: false, error: /changed since/ })
    expect(await intake.sendDraft(draft.id, 'forged')).toMatchObject({ ok: false, error: /changed since/ })
    const swapped = draftFingerprint({ ...draft, text: 'something else' })
    expect(await intake.sendDraft(draft.id, swapped)).toMatchObject({ ok: false })
    const otherRecipient = draftFingerprint({ ...draft, toHandle: NORWAY })
    expect(await intake.sendDraft(draft.id, otherRecipient)).toMatchObject({ ok: false })
    expect(sendText).not.toHaveBeenCalled()
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
    ['token=abc123def', 'abc123def']
  ])('redacts %s', (raw, leaked) => {
    const clean = cleanIntakeText(raw)
    expect(clean).not.toContain(leaked)
    expect(clean).toContain('[redacted')
  })

  it('redacts before cutting, and leaves normal words alone', () => {
    const late = `${'x '.repeat(600)}"password": "correct horse battery staple"`
    expect(cleanIntakeText(late)).not.toContain('horse')
    expect(cleanIntakeText('The author: Sam. Basic plan is fine.')).toBe('The author: Sam. Basic plan is fine.')
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
