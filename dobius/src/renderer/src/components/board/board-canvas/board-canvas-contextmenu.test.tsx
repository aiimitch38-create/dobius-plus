// @vitest-environment happy-dom
import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BoardCanvas } from './BoardCanvas'

describe('BoardCanvas right-click', () => {
  let container: HTMLDivElement | null = null
  afterEach(() => {
    container?.remove()
    container = null
  })

  it('reports a right-click on empty canvas, and not one on a card', () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    const onEmptyContextMenu = vi.fn()
    const ref = createRef<HTMLDivElement>()
    const root = createRoot(container)
    act(() => {
      root.render(
        <BoardCanvas
          viewport={{ x: 0, y: 0, zoom: 1 }}
          onViewportChange={() => {}}
          containerRef={ref}
          onEmptyContextMenu={onEmptyContextMenu}
        >
          <div data-testid="card">card</div>
        </BoardCanvas>
      )
    })
    const canvas = ref.current!
    act(() => {
      canvas.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    })
    expect(onEmptyContextMenu).toHaveBeenCalledTimes(1)
    const card = container.querySelector('[data-testid="card"]')!
    act(() => {
      card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    })
    expect(onEmptyContextMenu).toHaveBeenCalledTimes(1)
    act(() => root.unmount())
  })
})
