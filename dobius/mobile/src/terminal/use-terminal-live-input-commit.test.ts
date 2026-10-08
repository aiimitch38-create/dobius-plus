import { createElement, type RefObject } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { TextInput } from 'react-native'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalLiveInputSender } from './terminal-live-input-sender'
import { TERMINAL_LIVE_HELD_SYLLABLE_COMMIT_DELAY_MS } from './terminal-live-hangul-mirror'
import { useTerminalLiveInputCommit } from './use-terminal-live-input-commit'

type TerminalLiveInputCommitHarness = {
  readonly captures: readonly string[]
  readonly handlers: ReturnType<typeof useTerminalLiveInputCommit<string>>
  readonly sent: readonly string[]
  readonly sentRequests: readonly { handle: string; bytes: string }[]
  readonly setActiveHandle: (next: string) => void
  readonly setActiveSessionTabType: (next: string | undefined) => void
  readonly unmount: () => void
}

type TerminalLiveInputCommitHarnessOptions = {
  readonly activeHandle?: string
  readonly sendResult?: boolean
  readonly sendResults?: readonly boolean[]
  readonly sendPromises?: readonly Promise<boolean>[]
}

function suppressReactTestRendererDeprecationWarning(): () => void {
  const originalConsoleError = console.error
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    const firstArg = args[0]
    if (typeof firstArg === 'string' && firstArg.includes('react-test-renderer is deprecated')) {
      return
    }
    originalConsoleError(...args)
  })
  return () => consoleErrorSpy.mockRestore()
}

function createTerminalLiveInputCommitHarness({
  activeHandle: initialActiveHandle = 'terminal-a',
  sendResult = true,
  sendResults = [],
  sendPromises = []
}: TerminalLiveInputCommitHarnessOptions = {}): TerminalLiveInputCommitHarness {
  let activeHandle = initialActiveHandle
  const activeHandleRef: RefObject<string | null> = { current: activeHandle }
  const activeSessionTabTypeRef: RefObject<string | null> = { current: 'terminal' }
  const captures: string[] = []
  const setLiveInputCapture = (text: string): void => {
    captures.push(text)
  }
  const liveInputRef: RefObject<TextInput | null> = { current: null }
  const liveInputTerminalHandles = new Set([activeHandle, 'terminal-b'])
  const liveInputTerminalHandlesRef: RefObject<Set<string>> = {
    current: liveInputTerminalHandles
  }
  const sent: string[] = []
  const sentRequests: { handle: string; bytes: string }[] = []
  const queuedSendResults = [...sendResults]
  const queuedSendPromises = [...sendPromises]
  const sendLiveTerminalInputRef: RefObject<TerminalLiveInputSender> = {
    current: async (handle, bytes) => {
      sent.push(bytes)
      sentRequests.push({ handle, bytes })
      const pendingResult = queuedSendPromises.shift()
      if (pendingResult) {
        return pendingResult
      }
      return queuedSendResults.shift() ?? sendResult
    }
  }
  // The hook keeps live-input state in refs, so a change handler alone never
  // re-renders; only a prop change (this variable) re-runs the pending-clear effect.
  let currentActiveSessionTabType: string | undefined = 'terminal'
  let handlers: ReturnType<typeof useTerminalLiveInputCommit<string>> | null = null
  let renderer: ReactTestRenderer | null = null

  function Harness(): null {
    handlers = useTerminalLiveInputCommit({
      activeHandle,
      activeHandleRef,
      activeSessionTabType: currentActiveSessionTabType,
      activeSessionTabTypeRef,
      liveInputRef,
      liveInputTerminalHandles,
      liveInputTerminalHandlesRef,
      sendLiveTerminalInputRef,
      setLiveInputCapture
    })
    return null
  }

  const restoreConsoleError = suppressReactTestRendererDeprecationWarning()
  try {
    act(() => {
      renderer = create(createElement(Harness))
    })
  } finally {
    restoreConsoleError()
  }
  if (!handlers || !renderer) {
    throw new Error('terminal live input hook did not render')
  }

  return {
    captures,
    handlers,
    sent,
    sentRequests,
    setActiveHandle: (next: string): void => {
      activeHandle = next
      activeHandleRef.current = next
      act(() => {
        renderer?.update(createElement(Harness))
      })
    },
    setActiveSessionTabType: (next: string | undefined): void => {
      currentActiveSessionTabType = next
      // Ref and prop derive from the same activeSessionTab in the real route, so
      // they go null together during tab-list lag — keep the harness coupled.
      activeSessionTabTypeRef.current = next ?? null
      act(() => {
        renderer?.update(createElement(Harness))
      })
    },
    unmount: () => {
      act(() => renderer?.unmount())
    }
  }
}

describe('terminal live input commit hook', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('Given Hangul composition When steps arrive Then streams the stable prefix and never leaks jamo', async () => {
    // Given
    vi.useFakeTimers()
    const { handlers, sent } = createTerminalLiveInputCommitHarness()

    // When: ㅎ→하→한→한ㄱ→한그→한글 (no settle pause between steps)
    for (const fieldText of ['ㅎ', '하', '한', '한ㄱ', '한그', '한글']) {
      handlers.handleLiveInputChange(fieldText)
      await vi.advanceTimersByTimeAsync(50)
    }

    // Then: only the stable prefix went out; the trailing syllable is held
    await vi.waitFor(() => expect(sent).toEqual(['한']))
  })

  it('Given a held syllable When the settle timer elapses Then commits it to the terminal', async () => {
    // Given
    vi.useFakeTimers()
    const { handlers, sent } = createTerminalLiveInputCommitHarness()
    handlers.handleLiveInputChange('한')

    // When
    await vi.advanceTimersByTimeAsync(TERMINAL_LIVE_HELD_SYLLABLE_COMMIT_DELAY_MS)

    // Then
    await vi.waitFor(() => expect(sent).toEqual(['한']))
  })

  it('Given a timer-committed syllable When composition continues Then corrects with DEL and recommits', async () => {
    // Given
    vi.useFakeTimers()
    const { handlers, sent } = createTerminalLiveInputCommitHarness()
    handlers.handleLiveInputChange('하')
    await vi.advanceTimersByTimeAsync(TERMINAL_LIVE_HELD_SYLLABLE_COMMIT_DELAY_MS)
    await vi.waitFor(() => expect(sent).toEqual(['하']))

    // When
    handlers.handleLiveInputChange('한')
    await vi.advanceTimersByTimeAsync(TERMINAL_LIVE_HELD_SYLLABLE_COMMIT_DELAY_MS)

    // Then
    await vi.waitFor(() => expect(sent).toEqual(['하', '\x7f', '한']))
  })

  it('Given Hangul pending text When submit is requested Then sends composed text before carriage return', async () => {
    // Given
    const { handlers, sent } = createTerminalLiveInputCommitHarness()
    handlers.handleLiveInputChange('한')

    // When
    handlers.handleLiveInputSubmit()

    // Then
    await vi.waitFor(() => expect(sent).toEqual(['한', '\r']))
  })

  it('Given no pending text When submit is requested Then sends only carriage return', async () => {
    // Given
    const { handlers, sent } = createTerminalLiveInputCommitHarness()

    // When
    handlers.handleLiveInputSubmit()

    // Then
    await vi.waitFor(() => expect(sent).toEqual(['\r']))
  })

  it('Given a rejected held-text send When submit is requested Then suppresses the carriage return', async () => {
    // Given
    const { handlers, sent } = createTerminalLiveInputCommitHarness({ sendResult: false })
    handlers.handleLiveInputChange('한')

    // When
    handlers.handleLiveInputSubmit()
    await Promise.resolve()
    await Promise.resolve()

    // Then: the held commit went out but was not accepted, so no \r follows
    await vi.waitFor(() => expect(sent).toEqual(['한']))
  })

  it('Given ASCII typing When changes arrive Then mirrors immediately', async () => {
    // Given
    const { handlers, sent } = createTerminalLiveInputCommitHarness()

    // When
    handlers.handleLiveInputChange('a')
    handlers.handleLiveInputChange('ab')

    // Then
    await vi.waitFor(() => expect(sent).toEqual(['a', 'b']))
  })

  it('Given a mirror delta fails during reconnect When input continues Then it blocks dependent controls and retains the field', async () => {
    // Given: the first byte was not accepted while the channel was interrupted;
    // the next request could succeed after reconnect, but its diff depends on it.
    const { captures, handlers, sent } = createTerminalLiveInputCommitHarness({
      sendResults: [false, true]
    })
    handlers.handleLiveInputChange('a')
    await vi.waitFor(() => expect(sent).toEqual(['a']))

    // When: the connection is back before more typing, a key event, or paste.
    handlers.handleLiveInputKeyPress({ nativeEvent: { key: 'Backspace' } })
    await expect(handlers.handleLiveInputAccessoryBytes({ bytes: 'paste' })).resolves.toEqual({
      kind: 'suppress-raw'
    })
    handlers.handleLiveInputChange('ab')
    handlers.handleLiveInputSubmit()
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Then: dependent bytes and Enter are suppressed, and the user can still
    // see the complete unsent text to decide how to recover safely.
    expect(sent).toEqual(['a'])
    expect(captures.at(-1)).toBe('ab')
  })

  it('Given a failed mirror delta When the user clears the field Then a new input session can send', async () => {
    // Given
    const { handlers, sent } = createTerminalLiveInputCommitHarness({
      sendResults: [false, true]
    })
    handlers.handleLiveInputChange('a')
    await vi.waitFor(() => expect(sent).toEqual(['a']))

    // When
    handlers.handleLiveInputChange('')
    handlers.handleLiveInputChange('b')

    // Then
    await vi.waitFor(() => expect(sent).toEqual(['a', 'b']))
  })

  it('Given a send is pending When the user clears before it fails Then the empty session resets after failure', async () => {
    // Given: the first send remains unresolved while the user clears the field.
    let resolveFirstSend: ((accepted: boolean) => void) | null = null
    const firstSend = new Promise<boolean>((resolve) => {
      resolveFirstSend = resolve
    })
    const { handlers, sent } = createTerminalLiveInputCommitHarness({
      sendPromises: [firstSend]
    })
    handlers.handleLiveInputChange('a')
    await vi.waitFor(() => expect(sent).toEqual(['a']))

    // When: clear first, then learn that the in-flight send was not accepted.
    handlers.handleLiveInputChange('')
    resolveFirstSend?.(false)
    await firstSend
    await expect(handlers.flushPendingLiveInputBeforeExternalSend('terminal-a')).resolves.toBe(
      false
    )
    handlers.handleLiveInputChange('b')

    // Then: the failed old completion does not poison the newly cleared session.
    await vi.waitFor(() => expect(sent).toEqual(['a', 'b']))
  })

  it('Given a send is pending on another terminal When the active terminal changes Then its failure does not block new input', async () => {
    // Given: terminal A has an unresolved input send.
    let resolveOldSend: ((accepted: boolean) => void) | null = null
    const oldSend = new Promise<boolean>((resolve) => {
      resolveOldSend = resolve
    })
    const { handlers, sentRequests, setActiveHandle } = createTerminalLiveInputCommitHarness({
      sendPromises: [oldSend]
    })
    handlers.handleLiveInputChange('a')
    await vi.waitFor(() => expect(sentRequests).toEqual([{ handle: 'terminal-a', bytes: 'a' }]))

    // When: the user selects terminal B before A's result arrives.
    setActiveHandle('terminal-b')
    handlers.handleLiveInputChange('b')
    resolveOldSend?.(false)

    // Then: B's independent input is sent despite A's ambiguous failure.
    await vi.waitFor(() =>
      expect(sentRequests).toEqual([
        { handle: 'terminal-a', bytes: 'a' },
        { handle: 'terminal-b', bytes: 'b' }
      ])
    )
  })

  it('Given a send is pending When leaving the terminal tab before selecting another Then the old failure does not block its input', async () => {
    // Given: terminal A has an unresolved input send.
    let resolveOldSend: ((accepted: boolean) => void) | null = null
    const oldSend = new Promise<boolean>((resolve) => {
      resolveOldSend = resolve
    })
    const { handlers, sentRequests, setActiveHandle, setActiveSessionTabType } =
      createTerminalLiveInputCommitHarness({ sendPromises: [oldSend] })
    handlers.handleLiveInputChange('a')
    await vi.waitFor(() => expect(sentRequests).toEqual([{ handle: 'terminal-a', bytes: 'a' }]))

    // When: navigation clears the field while leaving terminal A, then selects B.
    setActiveSessionTabType('markdown')
    setActiveHandle('terminal-b')
    setActiveSessionTabType('terminal')
    handlers.handleLiveInputChange('b')
    resolveOldSend?.(false)

    // Then: the stale A failure cannot suppress B's independent input.
    await vi.waitFor(() =>
      expect(sentRequests).toEqual([
        { handle: 'terminal-a', bytes: 'a' },
        { handle: 'terminal-b', bytes: 'b' }
      ])
    )
  })

  it('Given a trailing space after Hangul When the change arrives Then the space commits the held syllable', async () => {
    // Given
    const { handlers, sent } = createTerminalLiveInputCommitHarness()
    handlers.handleLiveInputChange('한')

    // When
    handlers.handleLiveInputChange('한 ')

    // Then
    await vi.waitFor(() => expect(sent).toEqual(['한 ']))
  })

  it('Given Hangul pending text When an external terminal send is requested Then flushes composed text first', async () => {
    // Given
    const { handlers, sent } = createTerminalLiveInputCommitHarness()
    handlers.handleLiveInputChange('한')

    // When
    const flushed = await handlers.flushPendingLiveInputBeforeExternalSend('terminal-a')

    // Then
    expect(flushed).toBe(true)
    expect(sent).toEqual(['한'])
  })

  it('Given pending text cannot be sent When an external terminal send is requested Then reports failure', async () => {
    // Given
    const { handlers, sent } = createTerminalLiveInputCommitHarness({ sendResult: false })
    handlers.handleLiveInputChange('한')

    // When
    const flushed = await handlers.flushPendingLiveInputBeforeExternalSend('terminal-a')

    // Then
    expect(flushed).toBe(false)
    expect(sent).toEqual(['한'])
  })

  it('Given non-Hangul IME text When changes arrive Then mirrors immediately without a settle window', async () => {
    // Given
    const { handlers, sent } = createTerminalLiveInputCommitHarness()

    // When
    handlers.handleLiveInputChange('你好')

    // Then
    await vi.waitFor(() => expect(sent).toEqual(['你好']))
  })

  it('Given a held syllable When the hook unmounts Then cancels the settle timer', async () => {
    // Given
    vi.useFakeTimers()
    const { handlers, sent, unmount } = createTerminalLiveInputCommitHarness()
    handlers.handleLiveInputChange('한')

    // When
    unmount()
    await vi.advanceTimersByTimeAsync(1_000)

    // Then
    expect(sent).toEqual([])
  })

  it('Given Backspace with field text When the key arrives Then edits locally without terminal bytes', async () => {
    // Given
    const { handlers, sent } = createTerminalLiveInputCommitHarness()
    handlers.handleLiveInputChange('한')

    // When
    handlers.handleLiveInputKeyPress({ nativeEvent: { key: 'Backspace' } })

    // Then
    await vi.waitFor(() => expect(sent).toEqual([]))
  })

  it('Given Tab with a held syllable When the key arrives Then commits the syllable before the tab bytes', async () => {
    // Given
    const { handlers, sent } = createTerminalLiveInputCommitHarness()
    handlers.handleLiveInputChange('한')

    // When
    handlers.handleLiveInputKeyPress({ nativeEvent: { key: 'Tab' } })

    // Then
    await vi.waitFor(() => expect(sent).toEqual(['한', '\t']))
  })

  it('Given Hangul pending When the tab type lags to undefined Then keeps the composition state', async () => {
    // Given: '한' held while the active tab is still a terminal
    const { handlers, sent, setActiveSessionTabType } = createTerminalLiveInputCommitHarness()
    handlers.handleLiveInputChange('한')

    // When: the mobile tab list momentarily yields no active tab object
    setActiveSessionTabType(undefined)
    handlers.handleLiveInputSubmit()

    // Then: an unknown tab type is not "left the terminal", so pending still flushes
    await vi.waitFor(() => expect(sent).toEqual(['한', '\r']))
  })

  it('Given Hangul pending When the tab genuinely changes to non-terminal Then clears the composition state', async () => {
    // Given: '한' held while the active tab is still a terminal
    const { handlers, sent, setActiveSessionTabType } = createTerminalLiveInputCommitHarness()
    handlers.handleLiveInputChange('한')

    // When: the active tab actually becomes a non-terminal (chat) tab
    setActiveSessionTabType('chat')
    handlers.handleLiveInputSubmit()

    // Then: pending was dropped, so submit sends only the carriage return
    await vi.waitFor(() => expect(sent).toEqual(['\r']))
  })
})
