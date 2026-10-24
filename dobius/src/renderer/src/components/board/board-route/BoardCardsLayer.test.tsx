// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BoardCard, BoardState } from '@/store/slices/board'
import { ConfirmationDialogProvider } from '@/components/confirmation-dialog'
import { BoardCardsLayer } from './BoardCardsLayer'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const checklist = (id: string, z: number): BoardCard =>
  ({
    id,
    kind: 'checklist',
    title: id,
    x: 0,
    y: 0,
    w: 300,
    h: 200,
    z,
    items: [{ id: `${id}-1`, text: `${id} item`, done: false }]
  }) as BoardCard

const board = (cards: BoardCard[]): BoardState =>
  ({
    cards,
    groups: [],
    connectors: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    tool: 'select'
  }) as never

const render = (cards: BoardCard[]): void =>
  act(() =>
    root.render(
      <ConfirmationDialogProvider>
        <BoardCardsLayer
          worktreeId="wt"
          board={board(cards)}
          selectedIds={new Set()}
          onSelect={() => {}}
          onDragBy={() => {}}
          onDragEnd={() => {}}
          guides={[]}
          penPoints={[]}
        />
      </ConfirmationDialogProvider>
    )
  )

describe('BoardCardsLayer', () => {
  // Regression: a to-do checkbox needed two clicks because bring-to-front on
  // press re-sorted the cards and moved the pressed node, cancelling the click.
  it('keeps each card node in place when its z changes (stacking is zIndex only)', () => {
    render([checklist('a', 2), checklist('b', 1)])
    const nodes = (): Element[] => [...container.querySelectorAll('[data-board-card]')]
    const before = nodes()
    const bNode = before[1] as HTMLElement
    expect(bNode.style.zIndex).toBe('1')

    render([checklist('a', 2), checklist('b', 3)])
    const after = nodes()
    expect(after[1]).toBe(bNode)
    expect(after[0]).toBe(before[0])
    expect(bNode.style.zIndex).toBe('3')
  })
})
