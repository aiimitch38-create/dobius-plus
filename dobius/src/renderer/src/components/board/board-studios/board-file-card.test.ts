import { describe, expect, it } from 'vitest'
import { boardFileCard } from './board-file-card'

describe('boardFileCard', () => {
  it('centres a markdown card on the point, titled by file name', () => {
    const card = boardFileCard('/repo/docs/guide.md', { x: 0, y: 0 }, 0)
    expect(card).toMatchObject({ kind: 'markdown', path: '/repo/docs/guide.md', title: 'guide.md' })
    expect(card.x + card.w / 2).toBe(0)
    expect(card.y + card.h / 2).toBe(0)
  })

  it('cascades repeat drops and wraps after a few', () => {
    const first = boardFileCard('a.ts', { x: 0, y: 0 }, 0)
    const second = boardFileCard('a.ts', { x: 0, y: 0 }, 1)
    const wrapped = boardFileCard('a.ts', { x: 0, y: 0 }, 6)
    expect(second.x).toBeGreaterThan(first.x)
    expect(wrapped.x).toBe(first.x)
  })

  it('handles Windows paths', () => {
    expect(boardFileCard('C:\\repo\\src\\main.ts', { x: 0, y: 0 }, 0).title).toBe('main.ts')
  })
})
