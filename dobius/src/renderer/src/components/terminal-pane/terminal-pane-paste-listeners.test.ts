// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const storeState: { settings: { terminalPasteConfirm?: boolean }; [key: string]: unknown } = {
  settings: {},
  boardsByWorktree: {},
  tabsByWorktree: {},
  updateSettings: vi.fn()
}
vi.mock('@/store', () => ({ useAppStore: { getState: () => storeState } }))
vi.mock('./TerminalPasteConfirmDialog', () => ({ TerminalPasteConfirmDialog: () => null }))

import { dispatchAppMenuPasteEvent } from '@/lib/app-menu-paste'
import { installTerminalPanePasteListeners } from './terminal-pane-paste-listeners'
import { activeTerminalPasteConfirm, confirmTerminalPaste } from './terminal-paste-confirm-host'
import type { TerminalPaneClipboardSource } from './terminal-pane-paste-listeners'

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
  }
}

function setup(opts: { clipboard: string; bracketed?: boolean }) {
  const container = document.createElement('div')
  const textarea = document.createElement('textarea')
  textarea.className = 'xterm-helper-textarea'
  container.appendChild(textarea)
  document.body.appendChild(container)
  textarea.focus()
  const written: string[] = []
  const sources: TerminalPaneClipboardSource[] = []
  // Mirrors TerminalPane: read clipboard -> confirmation gate -> PTY write.
  const paste = async (source: TerminalPaneClipboardSource): Promise<void> => {
    sources.push(source)
    const text = await confirmTerminalPaste({
      text: opts.clipboard,
      source,
      bracketedPasteMode: opts.bracketed ?? false,
      tabId: 'tab-1',
      restoreFocus: textarea
    })
    if (text !== null) {
      written.push(text)
    }
  }
  const uninstall = installTerminalPanePasteListeners({
    container,
    isMac: true,
    matchesPasteChord: (e) => e.metaKey && e.key.toLowerCase() === 'v',
    isForeignTarget: () => false,
    hasPane: () => true,
    paste
  })
  return { container, textarea, written, sources, uninstall }
}

const cmdV = (): KeyboardEvent =>
  new KeyboardEvent('keydown', { key: 'v', metaKey: true, bubbles: true, cancelable: true })
const pasteEvent = (): Event => new Event('paste', { bubbles: true, cancelable: true })

describe('terminal pane paste entry points', () => {
  let cleanup: (() => void) | null = null
  beforeEach(() => {
    storeState.settings = {}
  })
  afterEach(() => {
    cleanup?.()
    cleanup = null
    activeTerminalPasteConfirm()?.resolve('cancel', false)
    document.body.replaceChildren()
  })

  it('Cmd+V of multi-line text in a plain shell asks first and writes once after Paste', async () => {
    const t = setup({ clipboard: 'echo one\necho two\necho three' })
    cleanup = t.uninstall
    const key = cmdV()
    t.textarea.dispatchEvent(key)
    // Chromium follows the chord with a native paste event: same gesture.
    t.textarea.dispatchEvent(pasteEvent())
    await flush()
    expect(key.defaultPrevented).toBe(true)
    expect(t.sources).toEqual(['keyboard'])
    expect(activeTerminalPasteConfirm()?.lineCount).toBe(3)
    expect(t.written).toEqual([])
    await vi.waitFor(() =>
      expect(document.querySelector('[data-terminal-paste-confirm-host]')).not.toBeNull()
    )
    activeTerminalPasteConfirm()?.resolve('paste', false)
    await flush()
    expect(t.written).toEqual(['echo one\necho two\necho three'])
  })

  it('a DOM paste event (Edit menu / xterm textarea) is intercepted and gated', async () => {
    const t = setup({ clipboard: 'a\nb' })
    cleanup = t.uninstall
    const ev = pasteEvent()
    t.textarea.dispatchEvent(ev)
    await flush()
    expect(ev.defaultPrevented).toBe(true)
    expect(t.sources).toEqual(['paste-event'])
    expect(activeTerminalPasteConfirm()).not.toBeNull()
    activeTerminalPasteConfirm()?.resolve('cancel', false)
    await flush()
    expect(t.written).toEqual([])
  })

  it('the macOS Cmd+V relay (app-menu event) reaches the focused pane once', async () => {
    const t = setup({ clipboard: 'a\nb' })
    cleanup = t.uninstall
    expect(dispatchAppMenuPasteEvent()).toBe(true)
    // A second relay of the same gesture while the dialog is open is dropped.
    expect(dispatchAppMenuPasteEvent()).toBe(true)
    await flush()
    expect(t.sources).toEqual(['app-menu'])
    activeTerminalPasteConfirm()?.resolve('one-line', false)
    await flush()
    expect(t.written).toEqual(['a b'])
  })

  it('ignores the app-menu relay when focus is outside the pane', async () => {
    const t = setup({ clipboard: 'a\nb' })
    cleanup = t.uninstall
    const other = document.createElement('input')
    document.body.appendChild(other)
    other.focus()
    expect(dispatchAppMenuPasteEvent()).toBe(false)
    await flush()
    expect(t.sources).toEqual([])
  })

  it('skips the dialog for bracketed-paste terminals and writes exactly once', async () => {
    const t = setup({ clipboard: 'line one\nline two', bracketed: true })
    cleanup = t.uninstall
    t.textarea.dispatchEvent(cmdV())
    t.textarea.dispatchEvent(pasteEvent())
    dispatchAppMenuPasteEvent()
    await flush()
    expect(activeTerminalPasteConfirm()).toBeNull()
    expect(t.written).toEqual(['line one\nline two'])
  })

  it('skips the dialog for a single line and writes exactly once', async () => {
    const t = setup({ clipboard: 'ls -la\n' })
    cleanup = t.uninstall
    t.textarea.dispatchEvent(cmdV())
    await flush()
    expect(activeTerminalPasteConfirm()).toBeNull()
    expect(t.written).toEqual(['ls -la\n'])
  })

  it('a new gesture after the previous one finished pastes again', async () => {
    const t = setup({ clipboard: 'pwd' })
    cleanup = t.uninstall
    t.textarea.dispatchEvent(cmdV())
    await flush()
    await new Promise((r) => setTimeout(r, 0))
    t.textarea.dispatchEvent(cmdV())
    await flush()
    expect(t.written).toEqual(['pwd', 'pwd'])
  })
})
