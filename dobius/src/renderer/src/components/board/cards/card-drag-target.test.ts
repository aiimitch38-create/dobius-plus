import { describe, expect, it } from 'vitest'
import { shouldStartCardDrag } from './card-drag-target'

function node(insideControl: boolean): Element {
  return {
    closest: (sel: string) => (insideControl && sel.includes('data-board-card-control') ? {} : null)
  } as unknown as Element
}

function handleOf(...children: Element[]): Pick<Node, 'contains'> {
  return { contains: (n) => children.includes(n as Element) }
}

describe('shouldStartCardDrag', () => {
  it('starts a drag for a plain header target', () => {
    const t = node(false)
    expect(shouldStartCardDrag(0, t, handleOf(t))).toBe(true)
  })

  it('ignores non-primary buttons', () => {
    const t = node(false)
    expect(shouldStartCardDrag(2, t, handleOf(t))).toBe(false)
  })

  it('ignores targets inside a card control', () => {
    const t = node(true)
    expect(shouldStartCardDrag(0, t, handleOf(t))).toBe(false)
  })

  it('ignores portal content that bubbled through React but is outside the handle DOM', () => {
    const menuItem = node(false)
    expect(shouldStartCardDrag(0, menuItem, handleOf(node(false)))).toBe(false)
  })

  it('ignores a null target', () => {
    expect(shouldStartCardDrag(0, null, handleOf())).toBe(false)
  })
})
