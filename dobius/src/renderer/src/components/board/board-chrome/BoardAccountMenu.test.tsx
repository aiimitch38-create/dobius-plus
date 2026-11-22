// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BoardAccountMenu } from './BoardAccountMenu'

vi.mock('@/components/sidebar/HelpMenuItems', () => ({ HelpMenuItems: () => null }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root.render(
      <BoardAccountMenu
        avatarLabel="Carson"
        onOpenAccounts={vi.fn()}
        onResetBoard={vi.fn()}
        onSendFeedback={vi.fn()}
      />
    )
  )
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

const trigger = (): HTMLButtonElement =>
  container.querySelector<HTMLButtonElement>('button[aria-label="Account and help"]')!
const menu = (): Element | null => document.querySelector('[role="menu"]')
const pressEscape = (target: EventTarget): void => {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    )
  })
}

function hoverOpen(): void {
  act(() => {
    trigger().dispatchEvent(
      new PointerEvent('pointerenter', { pointerType: 'mouse', bubbles: false })
    )
    trigger().dispatchEvent(
      new PointerEvent('pointerover', { pointerType: 'mouse', bubbles: true })
    )
  })
  act(() => vi.advanceTimersByTime(200))
}

describe('BoardAccountMenu Escape', () => {
  it('opens on hover', () => {
    hoverOpen()
    expect(menu()).not.toBeNull()
  })

  it('Escape closes it when the keyboard is elsewhere (hover never moved focus)', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    hoverOpen()
    expect(menu()).not.toBeNull()
    pressEscape(document.activeElement ?? document.body)
    act(() => vi.advanceTimersByTime(500))
    expect(menu()).toBeNull()
    input.remove()
  })
})
