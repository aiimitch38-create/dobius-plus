// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BoardCardFocusEdge } from './BoardCardFocusEdge'
import { useBoardCameraFocus } from './board-focus-state'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  useBoardCameraFocus.setState({ focus: null })
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const focusOn = (cardIds: string[], arrivedAt: number): void =>
  useBoardCameraFocus.setState({
    focus: {
      worktreeId: 'wt',
      cardId: cardIds.length === 1 ? cardIds[0] : null,
      cardIds,
      groupId: cardIds.length > 1 ? 'g' : null,
      previous: { x: 0, y: 0, zoom: 1 },
      arrivedAt
    }
  })

describe('BoardCardFocusEdge', () => {
  it('marks only focused cards (so the others dim) and rings them on arrival', () => {
    act(() =>
      root.render(
        <>
          <BoardCardFocusEdge cardId="a" />
          <BoardCardFocusEdge cardId="b" />
        </>
      )
    )
    expect(container.querySelectorAll('[data-board-focus-target]')).toHaveLength(0)
    act(() => focusOn(['a'], 0))
    const marks = container.querySelectorAll('[data-board-focus-target]')
    expect(marks).toHaveLength(1)
    expect(marks[0].className).not.toContain('border-2')
    act(() => focusOn(['a'], 123))
    expect(container.querySelector('[data-board-focus-target]')?.className).toContain('border-2')
    // A focused group keeps every member at full opacity.
    act(() => focusOn(['a', 'b'], 0))
    expect(container.querySelectorAll('[data-board-focus-target]')).toHaveLength(2)
  })
})
