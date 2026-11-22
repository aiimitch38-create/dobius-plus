import { describe, expect, it } from 'vitest'
import {
  WHATS_NEW_MAX_BULLETS,
  WHATS_NEW_MAX_LINE,
  WHATS_NEW_MAX_SECTIONS,
  compareWhatsNewVersions,
  isWhatsNewVersion,
  normalizeWhatsNewState,
  parseWhatsNewNotes,
  planWhatsNew,
  raiseWhatsNewSeen,
  readWhatsNewPayload,
  readWhatsNewSeen
} from './whats-new'

function notesFor(...versions: string[]): Map<string, string[]> {
  return new Map(versions.map((version) => [version, [`Note for ${version}.`]]))
}

describe('whats-new versions', () => {
  it('accepts plain major.minor.patch only', () => {
    expect(isWhatsNewVersion('2.1.10')).toBe(true)
    expect(isWhatsNewVersion('2.1')).toBe(false)
    expect(isWhatsNewVersion('2.1.10-beta.1')).toBe(false)
    expect(isWhatsNewVersion('v2.1.10')).toBe(false)
    expect(isWhatsNewVersion(2)).toBe(false)
  })

  it('compares by number, not by text', () => {
    expect(compareWhatsNewVersions('2.1.10', '2.1.9')).toBe(1)
    expect(compareWhatsNewVersions('2.1.9', '2.1.10')).toBe(-1)
    expect(compareWhatsNewVersions('2.1.9', '2.1.9')).toBe(0)
    expect(compareWhatsNewVersions('3.0.0', '2.9.9')).toBe(1)
  })
})

describe('parseWhatsNewNotes', () => {
  it('reads "- " lines and skips blank lines', () => {
    expect(parseWhatsNewNotes('- One.\n\n-   Two.  \r\n')).toEqual({
      ok: true,
      bullets: ['One.', 'Two.']
    })
  })

  it('refuses anything that is not a bullet', () => {
    expect(parseWhatsNewNotes('# Heading\n- One.').ok).toBe(false)
    expect(parseWhatsNewNotes('').ok).toBe(false)
    expect(parseWhatsNewNotes('- ').ok).toBe(false)
    expect(parseWhatsNewNotes(null).ok).toBe(false)
  })

  it('refuses too many lines and lines that are too long', () => {
    const many = Array.from({ length: WHATS_NEW_MAX_BULLETS + 1 }, (_, i) => `- Line ${i}.`)
    expect(parseWhatsNewNotes(many.join('\n')).ok).toBe(false)
    expect(parseWhatsNewNotes(many.slice(0, WHATS_NEW_MAX_BULLETS).join('\n')).ok).toBe(true)
    expect(parseWhatsNewNotes(`- ${'a'.repeat(WHATS_NEW_MAX_LINE + 1)}`).ok).toBe(false)
  })

  it('refuses dashes and control characters', () => {
    expect(parseWhatsNewNotes(`- Before ${String.fromCharCode(0x2014)} after.`).ok).toBe(false)
    expect(parseWhatsNewNotes(`- Before ${String.fromCharCode(0x2013)} after.`).ok).toBe(false)
    expect(parseWhatsNewNotes(`- Flip${String.fromCharCode(0x202e)}ped.`).ok).toBe(false)
    expect(parseWhatsNewNotes(`- Bell${String.fromCharCode(7)}.`).ok).toBe(false)
  })
})

describe('planWhatsNew', () => {
  it('shows nothing on a first install and records the baseline', () => {
    expect(
      planWhatsNew({
        current: '2.1.10',
        seen: null,
        existingProfile: false,
        notes: notesFor('2.1.10')
      })
    ).toEqual({ sections: [], newSeen: '2.1.10' })
  })

  it('shows the new version once after an update', () => {
    const plan = planWhatsNew({
      current: '2.1.10',
      seen: '2.1.9',
      existingProfile: true,
      notes: notesFor('2.1.9', '2.1.10')
    })
    expect(plan.sections.map((section) => section.version)).toEqual(['2.1.10'])
    expect(plan.newSeen).toBeNull()
  })

  it('shows nothing once the current version was seen', () => {
    expect(
      planWhatsNew({
        current: '2.1.10',
        seen: '2.1.10',
        existingProfile: true,
        notes: notesFor('2.1.10')
      })
    ).toEqual({ sections: [], newSeen: null })
  })

  it('lists every skipped version, newest first, and never a future one', () => {
    const plan = planWhatsNew({
      current: '2.1.12',
      seen: '2.1.9',
      existingProfile: true,
      notes: notesFor('2.1.9', '2.1.10', '2.1.11', '2.1.12', '2.1.13')
    })
    expect(plan.sections.map((section) => section.version)).toEqual(['2.1.12', '2.1.11', '2.1.10'])
  })

  it('treats an older profile with no record as having missed everything', () => {
    const plan = planWhatsNew({
      current: '2.1.10',
      seen: null,
      existingProfile: true,
      notes: notesFor('2.1.10', '2.1.11')
    })
    expect(plan.sections.map((section) => section.version)).toEqual(['2.1.10'])
  })

  it('caps the list at the newest ten', () => {
    const versions = Array.from({ length: 14 }, (_, i) => `2.2.${i}`)
    const plan = planWhatsNew({
      current: '2.2.13',
      seen: null,
      existingProfile: true,
      notes: notesFor(...versions)
    })
    expect(plan.sections).toHaveLength(WHATS_NEW_MAX_SECTIONS)
    expect(plan.sections[0].version).toBe('2.2.13')
    expect(plan.sections.at(-1)?.version).toBe('2.2.4')
  })

  it('moves the marker without a popup when no notes were written', () => {
    expect(
      planWhatsNew({ current: '2.1.10', seen: '2.1.8', existingProfile: true, notes: new Map() })
    ).toEqual({ sections: [], newSeen: '2.1.10' })
  })

  it('stays quiet after a downgrade', () => {
    expect(
      planWhatsNew({
        current: '2.1.9',
        seen: '2.1.10',
        existingProfile: true,
        notes: notesFor('2.1.9', '2.1.10')
      })
    ).toEqual({ sections: [], newSeen: null })
  })

  it('does nothing for a version it cannot read', () => {
    expect(
      planWhatsNew({
        current: '2.1.10-beta.1',
        seen: null,
        existingProfile: true,
        notes: notesFor('2.1.10')
      })
    ).toEqual({ sections: [], newSeen: null })
  })
})

describe('saved state', () => {
  it('never lowers the seen version', () => {
    expect(raiseWhatsNewSeen(null, '2.1.9')).toBe('2.1.9')
    expect(raiseWhatsNewSeen('2.1.9', '2.1.10')).toBe('2.1.10')
    expect(raiseWhatsNewSeen('2.1.10', '2.1.9')).toBe('2.1.10')
    expect(raiseWhatsNewSeen('2.1.10', 'garbage')).toBe('2.1.10')
  })

  it('drops a damaged record', () => {
    expect(readWhatsNewSeen({ seen: '2.1.9' })).toBe('2.1.9')
    expect(readWhatsNewSeen({ seen: 'latest' })).toBeNull()
    expect(readWhatsNewSeen(['2.1.9'])).toBeNull()
    expect(normalizeWhatsNewState('2.1.9')).toBeUndefined()
    expect(normalizeWhatsNewState({ seen: '2.1.9', extra: true })).toEqual({ seen: '2.1.9' })
  })

  it('checks a payload that crossed IPC', () => {
    expect(readWhatsNewPayload(null)).toBeNull()
    expect(readWhatsNewPayload({ sections: [] })).toBeNull()
    expect(
      readWhatsNewPayload({
        sections: [
          { version: '2.1.10', bullets: ['One.', 5, ''] },
          { version: 'bad', bullets: ['x'] },
          { version: '2.1.9', bullets: [] }
        ]
      })
    ).toEqual({ sections: [{ version: '2.1.10', bullets: ['One.'] }] })
  })
})
