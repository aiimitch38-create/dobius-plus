// @vitest-environment happy-dom
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { BoardCanvas, type BoardCanvasProps, type BoardMarqueeRect } from './BoardCanvas'
import type { BoardPoint, BoardViewport } from './board-viewport'
import { BOARD_USER_PAN_EVENT } from './board-pan-event'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Pointer = { x: number; y: number; button?: number; shiftKey?: boolean }

function pointer(type: string, p: Pointer): PointerEvent {
  const button = p.button ?? 0
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: p.x,
    clientY: p.y,
    button,
    buttons: type === 'pointerup' ? 0 : button === 1 ? 4 : 1,
    shiftKey: p.shiftKey ?? false,
    pointerId: 7
  })
  return event
}

describe('BoardCanvas drag gestures', () => {
  let container: HTMLDivElement
  let root: Root
  let onViewportChange: Mock<(viewport: BoardViewport) => void>
  let onMarquee: Mock<(rect: BoardMarqueeRect, additive: boolean) => void>
  let onEmptyPointerDown: Mock<(world: BoardPoint, event: React.PointerEvent<HTMLDivElement>) => void>
  let panEvents: number
  const ref = createRef<HTMLDivElement>()

  const render = (props: Partial<BoardCanvasProps> = {}): void => {
    act(() =>
      root.render(
        <BoardCanvas
          viewport={{ x: 0, y: 0, zoom: 1 }}
          onViewportChange={onViewportChange}
          containerRef={ref}
          onMarquee={onMarquee}
          onEmptyPointerDown={onEmptyPointerDown}
          {...props}
        >
          <div data-board-card="" data-testid="card">
            card
          </div>
        </BoardCanvas>
      )
    )
  }

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onViewportChange = vi.fn<(viewport: BoardViewport) => void>()
    onMarquee = vi.fn<(rect: BoardMarqueeRect, additive: boolean) => void>()
    onEmptyPointerDown = vi.fn<(world: BoardPoint, event: React.PointerEvent<HTMLDivElement>) => void>()
    panEvents = 0
    // happy-dom has no pointer capture; the canvas calls it on every drag start.
    HTMLElement.prototype.setPointerCapture = () => {}
    HTMLElement.prototype.releasePointerCapture = () => {}
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const canvas = (): HTMLDivElement => {
    const el = ref.current!
    el.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 }) as DOMRect
    el.addEventListener(BOARD_USER_PAN_EVENT, () => panEvents++)
    return el
  }
  const drag = (target: Element, from: Pointer, to: Pointer): void => {
    act(() => {
      target.dispatchEvent(pointer('pointerdown', from))
      target.dispatchEvent(pointer('pointermove', { ...to, button: from.button, shiftKey: from.shiftKey }))
      target.dispatchEvent(pointer('pointerup', { ...to, button: from.button, shiftKey: from.shiftKey }))
    })
  }

  it('plain drag on empty canvas draws the box and reports a replace-selection marquee', () => {
    render()
    const el = canvas()
    act(() => el.dispatchEvent(pointer('pointerdown', { x: 100, y: 100 })))
    act(() => el.dispatchEvent(pointer('pointermove', { x: 300, y: 250 })))
    const box = el.querySelector('[data-board-marquee]') as HTMLElement
    expect(box.style.display).toBe('block')
    expect([box.style.left, box.style.top, box.style.width, box.style.height]).toEqual([
      '100px',
      '100px',
      '200px',
      '150px'
    ])
    act(() => el.dispatchEvent(pointer('pointerup', { x: 300, y: 250 })))
    expect(box.style.display).toBe('none')
    expect(onMarquee).toHaveBeenCalledWith({ x: 100, y: 100, w: 200, h: 150 }, false)
    expect(onViewportChange).not.toHaveBeenCalled()
    expect(panEvents).toBe(0)
  })

  it('converts the box to world coordinates at the current zoom', () => {
    render({ viewport: { x: 50, y: 20, zoom: 2 } })
    drag(canvas(), { x: 150, y: 120 }, { x: 350, y: 320 })
    expect(onMarquee).toHaveBeenCalledWith({ x: 50, y: 50, w: 100, h: 100 }, false)
  })

  it('Shift+drag reports an additive marquee', () => {
    render()
    drag(canvas(), { x: 10, y: 10, shiftKey: true }, { x: 60, y: 90 })
    expect(onMarquee).toHaveBeenCalledWith({ x: 10, y: 10, w: 50, h: 80 }, true)
  })

  it('a plain click on empty canvas reports the press but no marquee', () => {
    render()
    drag(canvas(), { x: 10, y: 10 }, { x: 10, y: 10 })
    expect(onEmptyPointerDown).toHaveBeenCalledTimes(1)
    expect(onMarquee).not.toHaveBeenCalled()
  })

  it('middle-button drag pans and counts as a user camera move', () => {
    render()
    const el = canvas()
    act(() => el.dispatchEvent(pointer('pointerdown', { x: 100, y: 100, button: 1 })))
    expect(el.hasAttribute('data-board-panning')).toBe(true)
    act(() => el.dispatchEvent(pointer('pointermove', { x: 130, y: 90, button: 1 })))
    expect(onViewportChange).toHaveBeenCalledWith({ x: 30, y: -10, zoom: 1 })
    act(() => el.dispatchEvent(pointer('pointerup', { x: 130, y: 90, button: 1 })))
    expect(el.hasAttribute('data-board-panning')).toBe(false)
    expect(onMarquee).not.toHaveBeenCalled()
    expect(panEvents).toBe(1)
  })

  it('Space+drag pans from anywhere, even over a card', () => {
    const onSpacePanStart = vi.fn()
    render({ spaceHeld: true, onSpacePanStart })
    canvas()
    const card = container.querySelector('[data-testid="card"]')!
    drag(card, { x: 100, y: 100 }, { x: 60, y: 120 })
    expect(onSpacePanStart).toHaveBeenCalledTimes(1)
    expect(onViewportChange).toHaveBeenCalledWith({ x: -40, y: 20, zoom: 1 })
    expect(onMarquee).not.toHaveBeenCalled()
    expect(panEvents).toBe(1)
  })

  it('a drag that starts on a card neither pans nor selects (the card handles its move)', () => {
    render()
    canvas()
    const card = container.querySelector('[data-testid="card"]')!
    drag(card, { x: 100, y: 100 }, { x: 200, y: 200 })
    expect(onViewportChange).not.toHaveBeenCalled()
    expect(onMarquee).not.toHaveBeenCalled()
    expect(onEmptyPointerDown).not.toHaveBeenCalled()
  })

  it('drawing tools (selectOnEmptyDrag=false) only report the press', () => {
    render({ selectOnEmptyDrag: false })
    drag(canvas(), { x: 10, y: 10 }, { x: 80, y: 80 })
    expect(onEmptyPointerDown).toHaveBeenCalledTimes(1)
    expect(onMarquee).not.toHaveBeenCalled()
    expect(onViewportChange).not.toHaveBeenCalled()
  })
})
