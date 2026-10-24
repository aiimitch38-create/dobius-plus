// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBoardCodeTheme } from './use-board-code-theme'

const editor = vi.hoisted(() => ({ defineTheme: vi.fn(), setTheme: vi.fn() }))
vi.mock('@/lib/monaco-setup', () => ({ monaco: { editor } }))

beforeEach(() => vi.clearAllMocks())

describe('useBoardCodeTheme', () => {
  it('does not restore Classic over another Board editor during a file switch', async () => {
    const first = renderHook(() => useBoardCodeTheme({ current: null }, true, false))
    const second = renderHook(() => useBoardCodeTheme({ current: null }, true, false))
    first.unmount()
    await act(async () => {
      await Promise.resolve()
    })
    expect(editor.setTheme).not.toHaveBeenCalled()
    second.unmount()
    await act(async () => {
      await Promise.resolve()
    })
    expect(editor.setTheme).toHaveBeenCalledExactlyOnceWith('vs')
  })

  it('restores the latest app theme after the Code editor closes', async () => {
    const view = renderHook(({ dark }) => useBoardCodeTheme({ current: null }, true, dark), {
      initialProps: { dark: false }
    })
    view.rerender({ dark: true })
    view.unmount()
    await act(async () => {
      await Promise.resolve()
    })
    expect(editor.setTheme).toHaveBeenCalledExactlyOnceWith('vs-dark')
  })

  it('leaves Classic theme ownership alone outside the Code studio', async () => {
    const view = renderHook(() => useBoardCodeTheme({ current: null }, false, false))
    view.unmount()
    await act(async () => {
      await Promise.resolve()
    })
    expect(editor.setTheme).not.toHaveBeenCalled()
  })
})
