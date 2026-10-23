// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listenStudioEscape, studioOwnsEscape } from './studio-escape-guard'

function mountStudio(): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('role', 'dialog')
  document.body.appendChild(el)
  return el
}

const pressEscape = (target: EventTarget): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('studioOwnsEscape', () => {
  it('owns Esc when the studio is the top dialog with no popup open', () => {
    const studio = mountStudio()
    expect(studioOwnsEscape(studio, document)).toBe(true)
  })

  it('yields to a nested dialog or an open menu', () => {
    const studio = mountStudio()
    const nested = mountStudio()
    expect(studioOwnsEscape(studio, document)).toBe(false)
    nested.remove()
    const popper = document.createElement('div')
    popper.setAttribute('data-radix-popper-content-wrapper', '')
    document.body.appendChild(popper)
    expect(studioOwnsEscape(studio, document)).toBe(false)
  })

  it('does nothing once the studio is gone', () => {
    const studio = mountStudio()
    studio.remove()
    expect(studioOwnsEscape(studio, document)).toBe(false)
  })
})

describe('listenStudioEscape', () => {
  it('closes the studio and hides Esc from page listeners, even inside a field', () => {
    const studio = mountStudio()
    const input = document.createElement('input')
    studio.appendChild(input)
    const onClose = vi.fn()
    const unsubscribe = listenStudioEscape(window, () => studio, onClose)
    // Registered after the guard, like an embedded page's own capture listener.
    const pageListener = vi.fn()
    window.addEventListener('keydown', pageListener, { capture: true })

    const event = pressEscape(input)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(pageListener).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)

    unsubscribe()
    pressEscape(input)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(pageListener).toHaveBeenCalledTimes(1)
    window.removeEventListener('keydown', pageListener, { capture: true })
  })

  it('ignores other keys', () => {
    const studio = mountStudio()
    const onClose = vi.fn()
    const unsubscribe = listenStudioEscape(window, () => studio, onClose)
    studio.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(onClose).not.toHaveBeenCalled()
    unsubscribe()
  })
})
