import { describe, expect, it } from 'vitest'
import type { BoardState } from '@/store/slices/board'
import { buildSkillRunPrompt, filterBranches, strokeIdsOver } from './board-card-extras'

const base = { z: 0, title: 't' }
const board = {
  cards: [
    { ...base, id: 's1', kind: 'stroke', points: [], x: 10, y: 10, w: 20, h: 20 },
    { ...base, id: 's2', kind: 'stroke', points: [], x: 500, y: 500, w: 20, h: 20 },
    { ...base, id: 'n', kind: 'note', text: '', color: 'yellow', x: 10, y: 10, w: 20, h: 20 }
  ],
  groups: []
} as unknown as BoardState

describe('strokeIdsOver', () => {
  it('returns only strokes overlapping the rect', () => {
    expect(strokeIdsOver(board, { x: 0, y: 0, w: 100, h: 100 })).toEqual(['s1'])
  })
  it('keeps a long stroke that only crosses the rect', () => {
    const crossing = {
      cards: [{ ...base, id: 'long', kind: 'stroke', points: [], x: -400, y: 40, w: 1000, h: 10 }],
      groups: []
    } as unknown as BoardState
    expect(strokeIdsOver(crossing, { x: 300, y: 0, w: 100, h: 100 })).toEqual([])
  })
  it('treats touching edges as not overlapping', () => {
    expect(strokeIdsOver(board, { x: 30, y: 30, w: 10, h: 10 })).toEqual([])
  })
})

describe('buildSkillRunPrompt', () => {
  it('names the skill and appends trimmed arguments', () => {
    expect(buildSkillRunPrompt('review', '  src/a.ts ')).toBe(
      'Use the "review" skill with these arguments: src/a.ts'
    )
    expect(buildSkillRunPrompt('review', ' ')).toBe('Use the "review" skill.')
  })
})

describe('filterBranches', () => {
  it('filters case-insensitively and lists local before remote', () => {
    expect(filterBranches(['origin/main', 'main', 'Feat/x', 'dev'], '')).toEqual([
      'dev',
      'main',
      'Feat/x',
      'origin/main'
    ])
    expect(filterBranches(['origin/main', 'main', 'dev'], 'MA')).toEqual(['main', 'origin/main'])
  })
})
