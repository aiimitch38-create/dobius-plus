import { describe, expect, it } from 'vitest'
import { mergeSnapshotBoard } from './board-persistence'
import type { BoardCard, BoardState } from './board-state'

const base = { x: 0, y: 0, w: 100, h: 100, z: 1 }
const consoleCard = (id: string, tabId: string): BoardCard =>
  ({ ...base, id, kind: 'console', tabId, agentKind: 'claude', title: id }) as BoardCard
const note = (id: string): BoardCard =>
  ({ ...base, id, kind: 'note', text: id, color: 'yellow', title: id }) as BoardCard
const boardOf = (cards: BoardCard[], extra: Partial<BoardState> = {}): BoardState => ({
  cards,
  groups: [],
  connectors: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  tool: 'select',
  ...extra
})

describe('mergeSnapshotBoard', () => {
  it('brings snapshot cards back and keeps every live console the snapshot lacks', () => {
    const current = boardOf([consoleCard('live', 'tab-live'), note('new-note')], {
      viewport: { x: 5, y: 6, zoom: 2 }
    })
    const snapshot = boardOf([note('old-note'), consoleCard('gone', 'tab-gone')])
    const merged = mergeSnapshotBoard(current, snapshot)
    expect(merged.cards.map((c) => c.id)).toEqual(['old-note', 'gone', 'live'])
    // The camera stays where the user is.
    expect(merged.viewport).toEqual({ x: 5, y: 6, zoom: 2 })
  })

  it('restores a console whose terminal is gone as-is (it renders as closed)', () => {
    const merged = mergeSnapshotBoard(boardOf([]), boardOf([consoleCard('gone', 'tab-gone')]))
    expect(merged.cards).toEqual([consoleCard('gone', 'tab-gone')])
  })

  it('never shows one terminal twice: the card on the board now wins', () => {
    const current = boardOf([consoleCard('now', 'tab-1')])
    const snapshot = boardOf([consoleCard('then', 'tab-1'), note('n')])
    expect(mergeSnapshotBoard(current, snapshot).cards.map((c) => c.id)).toEqual(['n', 'now'])
  })

  it('drops group members, arrows and orchestrator wires that point at missing cards', () => {
    const orch = {
      ...base,
      id: 'o',
      kind: 'orchestrator',
      name: 'Lead',
      title: 'Lead',
      wiredCardIds: ['then', 'n']
    } as unknown as BoardCard
    const snapshot = boardOf([consoleCard('then', 'tab-1'), note('n'), orch], {
      groups: [
        { id: 'g', name: 'G', color: 'blue', cardIds: ['then', 'n'] },
        { id: 'g2', name: 'G2', color: 'blue', cardIds: ['then'] }
      ],
      connectors: [
        { id: 'k1', fromCardId: 'n', toCardId: 'o' },
        { id: 'k2', fromCardId: 'then', toCardId: 'n' }
      ]
    })
    const merged = mergeSnapshotBoard(boardOf([consoleCard('now', 'tab-1')]), snapshot)
    expect(merged.groups).toEqual([{ id: 'g', name: 'G', color: 'blue', cardIds: ['n'] }])
    expect(merged.connectors?.map((c) => c.id)).toEqual(['k1'])
    const wired = merged.cards.find((c) => c.id === 'o')
    expect(wired?.kind === 'orchestrator' && wired.wiredCardIds).toEqual(['n'])
  })
})
