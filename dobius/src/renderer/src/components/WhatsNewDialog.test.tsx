// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isWhatsNewOpen } from '@/lib/whats-new-open-state'

const { fetchPendingMock, dismissMock, captureReturnFocusMock, returnFocusVisible } = vi.hoisted(
  () => ({
    fetchPendingMock: vi.fn(),
    dismissMock: vi.fn(),
    captureReturnFocusMock: vi.fn(),
    returnFocusVisible: [] as boolean[]
  })
)

vi.mock('@/lib/whats-new-api', () => ({
  fetchPendingWhatsNew: fetchPendingMock,
  dismissWhatsNew: dismissMock
}))

vi.mock('@/hooks/useModalReturnFocus', () => ({
  useModalReturnFocus: (visible: boolean) => {
    returnFocusVisible.push(visible)
    return { captureReturnFocus: captureReturnFocusMock, skipReturnFocus: vi.fn() }
  }
}))

const { WhatsNewDialog } = await import('./WhatsNewDialog')

let root: Root | null = null
let container: HTMLDivElement | null = null

async function openPopup(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<WhatsNewDialog enabled />)
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2100)
  })
}

function continueButton(): HTMLButtonElement | null {
  return document.querySelector('[data-testid="whats-new-continue"]')
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  fetchPendingMock.mockResolvedValue({ sections: [{ version: '2.1.10', bullets: ['Ten.'] }] })
  dismissMock.mockResolvedValue(undefined)
  captureReturnFocusMock.mockClear()
  returnFocusVisible.length = 0
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('WhatsNewDialog', () => {
  it('flags itself open so window-level shortcuts stand down, and clears the flag on Continue', async () => {
    expect(isWhatsNewOpen()).toBe(false)
    await openPopup()
    expect(continueButton()).not.toBeNull()
    expect(isWhatsNewOpen()).toBe(true)

    await act(async () => {
      continueButton()?.click()
    })
    expect(isWhatsNewOpen()).toBe(false)
    expect(dismissMock).toHaveBeenCalledTimes(1)
  })

  it('clears the flag if it unmounts while open', async () => {
    await openPopup()
    expect(isWhatsNewOpen()).toBe(true)
    act(() => root?.unmount())
    root = null
    expect(isWhatsNewOpen()).toBe(false)
  })

  it('captures the prior focus on open and hands focus back on close', async () => {
    await openPopup()
    expect(captureReturnFocusMock).toHaveBeenCalled()
    expect(returnFocusVisible.at(-1)).toBe(true)
    expect(document.activeElement).toBe(continueButton())

    await act(async () => {
      continueButton()?.click()
    })
    // The return-focus hook restores focus when its flag goes true to false.
    expect(returnFocusVisible.at(-1)).toBe(false)
  })

  it('stays closed when there is nothing to show', async () => {
    fetchPendingMock.mockResolvedValue(null)
    await openPopup()
    expect(continueButton()).toBeNull()
    expect(isWhatsNewOpen()).toBe(false)
  })
})
