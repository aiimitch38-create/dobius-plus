import { describe, expect, it } from 'vitest'
import { isErasableCard } from './eraser-target'

describe('isErasableCard', () => {
  it('erases pen strokes and shapes', () => {
    expect(isErasableCard('stroke')).toBe(true)
    expect(isErasableCard('shape')).toBe(true)
  })

  it('never erases panels or consoles', () => {
    for (const kind of ['kanban', 'checklist', 'calendar', 'console', 'note', 'web'] as const) {
      expect(isErasableCard(kind)).toBe(false)
    }
  })
})
