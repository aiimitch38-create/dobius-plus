import { describe, expect, it } from 'vitest'
import {
  MAX_WORKSPACE_PURPOSE_LENGTH,
  groupByWorkspacePurpose,
  listWorkspacePurposeOptions,
  normalizeWorkspacePurpose,
  workspacePurposeKey
} from './workspace-purpose'

describe('normalizeWorkspacePurpose', () => {
  it('trims, drops blanks and canonicalizes default labels case-insensitively', () => {
    expect(normalizeWorkspacePurpose('  features ')).toBe('Features')
    expect(normalizeWorkspacePurpose('BACKEND')).toBe('Backend')
    expect(normalizeWorkspacePurpose('Design ')).toBe('Design')
    expect(normalizeWorkspacePurpose('   ')).toBeUndefined()
    expect(normalizeWorkspacePurpose(undefined)).toBeUndefined()
    expect(normalizeWorkspacePurpose(null)).toBeUndefined()
  })

  it('caps the label at the maximum length after trimming', () => {
    const long = `  ${'x'.repeat(MAX_WORKSPACE_PURPOSE_LENGTH + 25)}  `
    expect(normalizeWorkspacePurpose(long)).toBe('x'.repeat(MAX_WORKSPACE_PURPOSE_LENGTH))
    expect(normalizeWorkspacePurpose(`${'y'.repeat(39)}   z`)).toBe('y'.repeat(39))
  })

  it('keys default and custom purposes by lowercase label, blanks as other', () => {
    expect(workspacePurposeKey('Features')).toBe('purpose:features')
    expect(workspacePurposeKey('features')).toBe('purpose:features')
    expect(workspacePurposeKey('')).toBe('other')
    expect(workspacePurposeKey(undefined)).toBe('other')
  })
})

describe('groupByWorkspacePurpose', () => {
  it('orders defaults first, custom alphabetically, Other last and omits empty groups', () => {
    const groups = groupByWorkspacePurpose([
      { id: 'a', purpose: 'Research' },
      { id: 'b' },
      { id: 'c', purpose: 'Zeta' },
      { id: 'd', purpose: 'features' },
      { id: 'e', purpose: 'Alpha' },
      { id: 'f', purpose: 'Features' },
      { id: 'g', purpose: '' }
    ])
    expect(groups.map((g) => [g.key, g.purpose, g.items.map((i) => i.id)])).toEqual([
      ['purpose:features', 'Features', ['d', 'f']],
      ['purpose:research', 'Research', ['a']],
      ['purpose:alpha', 'Alpha', ['e']],
      ['purpose:zeta', 'Zeta', ['c']],
      ['other', null, ['b', 'g']]
    ])
  })

  it('returns a single Other group when nothing is labeled', () => {
    const items: { id: string; purpose?: string }[] = [{ id: 'a' }, { id: 'b' }]
    expect(groupByWorkspacePurpose(items)).toEqual([
      { key: 'other', purpose: null, items: [{ id: 'a' }, { id: 'b' }] }
    ])
    expect(groupByWorkspacePurpose([])).toEqual([])
  })
})

describe('listWorkspacePurposeOptions', () => {
  it('lists defaults then custom purposes in use, deduplicated', () => {
    expect(
      listWorkspacePurposeOptions([
        { purpose: 'ops' },
        { purpose: 'Ops' },
        { purpose: 'backend' },
        { purpose: 'Design' },
        {}
      ])
    ).toEqual(['Features', 'Backend', 'Research', 'Design', 'ops'])
  })
})
