// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BoardCardFrame } from './BoardCardFrame'
import { ShapeCard } from './ShapeCard'

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

const pointer = (type: string, x: number, y: number, buttons = 1): PointerEvent =>
  new PointerEvent(type, {
    bubbles: true,
    button: 0,
    buttons,
    pointerId: 1,
    clientX: x,
    clientY: y
  })

function renderPanel(props: { onDragBy?: () => void; onRename?: (t: string) => void } = {}): void {
  act(() =>
    root.render(
      <BoardCardFrame
        rect={{ x: 0, y: 0, w: 300, h: 200 }}
        z={1}
        zoom={1}
        title="Kanban"
        icon={null}
        selected={false}
        onSelect={() => {}}
        onDragBy={props.onDragBy ?? (() => {})}
        onRename={props.onRename}
        onResize={() => {}}
      >
        <div />
      </BoardCardFrame>
    )
  )
}

describe('BoardCardFrame resize', () => {
  it('bare card: dragging the se handle resizes', () => {
    const onResize = vi.fn()
    const onDragBy = vi.fn()
    act(() =>
      root.render(
        <BoardCardFrame
          rect={{ x: 0, y: 0, w: 160, h: 120 }}
          z={1}
          zoom={1}
          title="Shape"
          icon={null}
          selected
          bare
          onSelect={() => {}}
          onDragBy={onDragBy}
          onResize={onResize}
        >
          <svg />
        </BoardCardFrame>
      )
    )
    const handles = container.querySelectorAll('[aria-hidden]')
    const se = handles[6] as HTMLElement
    act(() => {
      se.dispatchEvent(pointer('pointerdown', 160, 120))
      se.dispatchEvent(pointer('pointermove', 200, 150))
      se.dispatchEvent(pointer('pointerup', 200, 150))
    })
    expect(onDragBy).not.toHaveBeenCalled()
    expect(onResize).toHaveBeenLastCalledWith({ x: 0, y: 0, w: 200, h: 150 })
  })

  it('a press without movement never captures the pointer (so dblclick reaches the title)', () => {
    const capture = vi.spyOn(Element.prototype, 'setPointerCapture')
    const onDragBy = vi.fn()
    renderPanel({ onDragBy })
    const title = [...container.querySelectorAll('span')].find((n) => n.textContent === 'Kanban')!
    act(() => {
      title.dispatchEvent(pointer('pointerdown', 10, 10))
      title.dispatchEvent(pointer('pointermove', 11, 10))
      title.dispatchEvent(pointer('pointerup', 11, 10, 0))
    })
    expect(capture).not.toHaveBeenCalled()
    expect(onDragBy).not.toHaveBeenCalled()
    capture.mockRestore()
  })

  it('a real drag captures after the threshold and applies the full distance', () => {
    const capture = vi.spyOn(Element.prototype, 'setPointerCapture')
    const onDragBy = vi.fn()
    renderPanel({ onDragBy })
    const title = [...container.querySelectorAll('span')].find((n) => n.textContent === 'Kanban')!
    act(() => {
      title.dispatchEvent(pointer('pointerdown', 10, 10))
      title.dispatchEvent(pointer('pointermove', 20, 14))
    })
    expect(capture).toHaveBeenCalledTimes(1)
    expect(onDragBy).toHaveBeenCalledWith(10, 4)
    capture.mockRestore()
  })

  it('double-clicking the title opens the rename editor and Enter commits', () => {
    const onRename = vi.fn()
    renderPanel({ onRename })
    const title = [...container.querySelectorAll('span')].find((n) => n.textContent === 'Kanban')!
    act(() => {
      title.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Rename"]')
    expect(input).not.toBeNull()
  })
})

describe('ShapeCard text', () => {
  it('double-click opens an editor inside the shape; typing sets the label', () => {
    const onChange = vi.fn()
    const shape = {
      id: 's1',
      kind: 'shape',
      shape: 'rect',
      fill: 'blue',
      title: 'Shape',
      x: 0,
      y: 0,
      w: 160,
      h: 120,
      z: 1
    } as const
    act(() => root.render(<ShapeCard card={shape as never} onChange={onChange} />))
    expect(container.querySelector('textarea')).toBeNull()
    act(() => {
      container.firstElementChild!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    const editor = container.querySelector('textarea')!
    expect(editor).not.toBeNull()
    expect(editor.hasAttribute('data-board-card-control')).toBe(true)
  })

  it('lines and arrows have no text editor', () => {
    const line = {
      id: 'l',
      kind: 'shape',
      shape: 'line',
      fill: 'blue',
      title: '',
      x: 0,
      y: 0,
      w: 100,
      h: 1,
      z: 1
    }
    act(() => root.render(<ShapeCard card={line as never} onChange={() => {}} />))
    act(() => {
      container.firstElementChild!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    expect(container.querySelector('textarea')).toBeNull()
  })
})
