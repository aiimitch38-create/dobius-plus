// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BoardToolOptionsPanel } from './BoardToolOptionsPanel'
import { getBoardToolStyle } from './board-tool-style-store'

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

const button = (label: string): HTMLButtonElement => {
  const el = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!el) {
    throw new Error(`no button ${label}`)
  }
  return el
}

describe('BoardToolOptionsPanel', () => {
  it('Shapes: picker first, then the style panel; picks flow into the store', () => {
    act(() => root.render(<BoardToolOptionsPanel tool="shape" />))
    expect(container.textContent).not.toContain('Stroke width')

    act(() => button('Diamond').click())
    expect(container.textContent).toContain('Stroke width')
    expect(container.textContent).toContain('Background')

    act(() => button('Dashed').click())
    act(() => button('Blue').click())
    expect(getBoardToolStyle('shape')).toMatchObject({
      shape: 'diamond',
      style: { strokeStyle: 'dashed', stroke: 'blue' }
    })

    act(() => button('Arrow').click())
    expect(container.textContent).not.toContain('Background')
  })

  it('renders nothing for tools without options', () => {
    act(() => root.render(<BoardToolOptionsPanel tool="select" />))
    expect(container.innerHTML).toBe('')
  })
})
