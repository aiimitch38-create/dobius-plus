import { describe, expect, it } from 'vitest'
import { kanbanColumnAt, kanbanMoveTargets, moveKanbanItem } from './kanban-card-moves'

const cols = [
  {
    id: 'a',
    title: 'A',
    items: [
      { id: '1', text: 'one' },
      { id: '2', text: 'two' }
    ]
  },
  { id: 'b', title: 'B', items: [{ id: '3', text: 'three' }] }
]
const ids = (c: typeof cols) => c.map((col) => col.items.map((i) => i.id))

describe('moveKanbanItem', () => {
  it('moves across columns at the index', () => {
    expect(ids(moveKanbanItem(cols, '1', 'b', 0))).toEqual([['2'], ['1', '3']])
  })
  it('reorders inside a column', () => {
    expect(ids(moveKanbanItem(cols, '1', 'a', 1))).toEqual([['2', '1'], ['3']])
  })
  it('clamps the index and ignores unknown ids', () => {
    expect(ids(moveKanbanItem(cols, '3', 'a', 99))).toEqual([['1', '2', '3'], []])
    expect(ids(moveKanbanItem(cols, 'x', 'a', 0))).toEqual(ids(cols))
    expect(ids(moveKanbanItem(cols, '1', 'zzz', 0))).toEqual(ids(cols))
  })
})

describe('kanbanColumnAt', () => {
  const el = (column: string | null, inside = true) => ({
    closest: () => (column === null ? null : { getAttribute: () => column, inside })
  })
  const root = { contains: (n: unknown) => Boolean((n as { inside: boolean }).inside) }

  it('resolves the column under the drop target', () => {
    expect(kanbanColumnAt(el('b') as never, root as never)).toBe('b')
  })
  it('ignores drops outside any column or in another kanban', () => {
    expect(kanbanColumnAt(el(null) as never, root as never)).toBeNull()
    expect(kanbanColumnAt(el('b', false) as never, root as never)).toBeNull()
    expect(kanbanColumnAt(null, root as never)).toBeNull()
  })
})

describe('kanbanMoveTargets', () => {
  it('lists every column except the one holding the item', () => {
    expect(kanbanMoveTargets(cols, '1').map((c) => c.id)).toEqual(['b'])
    expect(kanbanMoveTargets(cols, '3').map((c) => c.id)).toEqual(['a'])
  })
  it('moving via the menu appends to the target column', () => {
    const target = kanbanMoveTargets(cols, '1')[0]
    expect(ids(moveKanbanItem(cols, '1', target.id, target.items.length))).toEqual([
      ['2'],
      ['3', '1']
    ])
  })
})
