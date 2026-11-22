// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { setWhatsNewOpen } from '../lib/whats-new-open-state'
import { dispatchGlobalKeyboardShortcut } from './dispatch-global-keyboard-shortcut'
import {
  useGlobalKeyboardShortcuts,
  type UseGlobalKeyboardShortcutsParams
} from './useGlobalKeyboardShortcuts'

vi.mock('./dispatch-global-keyboard-shortcut', () => ({
  dispatchGlobalKeyboardShortcut: vi.fn()
}))

function Probe(): null {
  useGlobalKeyboardShortcuts({} as UseGlobalKeyboardShortcutsParams)
  return null
}

let root: Root | null = null

function pressCmdW(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', metaKey: true }))
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  setWhatsNewOpen(false)
  vi.mocked(dispatchGlobalKeyboardShortcut).mockClear()
})

describe('useGlobalKeyboardShortcuts while the What’s new popup is open', () => {
  it('ignores keys while open and handles them again once closed', () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    root = createRoot(document.createElement('div'))
    act(() => root?.render(<Probe />))

    pressCmdW()
    expect(dispatchGlobalKeyboardShortcut).toHaveBeenCalledTimes(1)

    setWhatsNewOpen(true)
    pressCmdW()
    expect(dispatchGlobalKeyboardShortcut).toHaveBeenCalledTimes(1)

    setWhatsNewOpen(false)
    pressCmdW()
    expect(dispatchGlobalKeyboardShortcut).toHaveBeenCalledTimes(2)
  })
})
