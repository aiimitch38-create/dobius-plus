import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { TextInput } from 'react-native'
import type { TerminalLiveInputSender } from './terminal-live-input-sender'
import {
  buildTerminalLiveMirrorPayload,
  computeTerminalLiveMirrorStep,
  TERMINAL_LIVE_HELD_SYLLABLE_COMMIT_DELAY_MS
} from './terminal-live-hangul-mirror'
import {
  queueTerminalLiveMirrorSend,
  waitForTerminalLivePendingFlush
} from './terminal-live-pending-flush-state'

type TerminalLivePendingInputFlushOptions<TTabType extends string> = {
  readonly activeHandleRef: RefObject<string | null>
  readonly activeSessionTabTypeRef: RefObject<TTabType | null>
  readonly liveInputRef: RefObject<TextInput | null>
  readonly liveInputTerminalHandlesRef: RefObject<Set<string>>
  readonly sendLiveTerminalInputRef: RefObject<TerminalLiveInputSender>
  readonly setLiveInputCapture: (text: string) => void
}

type TerminalLivePendingInputFlush = {
  readonly applyLiveInputMirror: (handle: string, fieldText: string) => void
  readonly clearPendingLiveInputCommit: (options?: { detachPendingSends?: boolean }) => void
  readonly flushPendingLiveInputText: (expectedHandle: string | null) => Promise<boolean>
  readonly heldLiveInputTextRef: RefObject<string>
  readonly pendingLiveInputHandleRef: RefObject<string | null>
  readonly sentLiveInputTextRef: RefObject<string>
  readonly waitForPendingLiveInputFlush: () => Promise<boolean>
}

export function useTerminalLivePendingInputFlush<TTabType extends string>({
  activeHandleRef,
  activeSessionTabTypeRef,
  liveInputRef,
  liveInputTerminalHandlesRef,
  sendLiveTerminalInputRef,
  setLiveInputCapture
}: TerminalLivePendingInputFlushOptions<TTabType>): TerminalLivePendingInputFlush {
  const heldCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingLiveInputFlushRef = useRef<Promise<boolean> | null>(null)
  const heldLiveInputTextRef = useRef('')
  const sentLiveInputTextRef = useRef('')
  const pendingLiveInputHandleRef = useRef<string | null>(null)
  const mirrorSendFailedRef = useRef(false)
  const liveInputSessionGenerationRef = useRef(0)
  const currentLiveInputTextRef = useRef('')
  const runMirrorStepRef = useRef<
    (handle: string, fieldText: string, commitHeld: boolean) => Promise<boolean>
  >(async () => false)

  const clearHeldCommitTimer = useCallback(() => {
    if (heldCommitTimerRef.current) {
      clearTimeout(heldCommitTimerRef.current)
      heldCommitTimerRef.current = null
    }
  }, [])

  const resetMirrorState = useCallback(() => {
    clearHeldCommitTimer()
    heldLiveInputTextRef.current = ''
    sentLiveInputTextRef.current = ''
    pendingLiveInputHandleRef.current = null
    mirrorSendFailedRef.current = false
    currentLiveInputTextRef.current = ''
    liveInputSessionGenerationRef.current += 1
  }, [clearHeldCommitTimer])

  const resetFailedEmptyInputSession = useCallback(() => {
    resetMirrorState()
    // Why: any queued dependent deltas have already been suppressed behind the
    // failed send. Detach their settled chain so fresh input after an explicit
    // clear starts an independent send instead of inheriting the old failure.
    pendingLiveInputFlushRef.current = null
  }, [resetMirrorState])

  const clearPendingLiveInputCommit = useCallback(
    (options?: { detachPendingSends?: boolean }) => {
      resetMirrorState()
      if (options?.detachPendingSends) {
        // Why: mirror deltas on another terminal are independent. A rejected
        // request for the previous handle must not suppress the new handle's
        // first input while its old network request is still settling.
        pendingLiveInputFlushRef.current = null
      }
      setLiveInputCapture('')
      liveInputRef.current?.setNativeProps({ text: '' })
    },
    [liveInputRef, resetMirrorState, setLiveInputCapture]
  )

  const waitForPendingLiveInputFlush = useCallback(async (): Promise<boolean> => {
    if (mirrorSendFailedRef.current) {
      return false
    }
    return waitForTerminalLivePendingFlush(pendingLiveInputFlushRef)
  }, [])

  const runMirrorStep = useCallback(
    async (handle: string, fieldText: string, commitHeld: boolean): Promise<boolean> => {
      currentLiveInputTextRef.current = fieldText
      if (
        handle !== activeHandleRef.current ||
        (activeSessionTabTypeRef.current != null &&
          activeSessionTabTypeRef.current !== 'terminal') ||
        !liveInputTerminalHandlesRef.current.has(handle)
      ) {
        // Why: a stale handle must not keep local mirror state alive — the next
        // active terminal would inherit wrong erase counts. A null tab type is
        // "unknown" during tab-list lag, not "left the terminal", so it must not trip.
        resetMirrorState()
        return false
      }

      if (mirrorSendFailedRef.current) {
        // A failed delta leaves it unknown which bytes reached the PTY. Keep
        // later edits local until the user clears this input session; never
        // replay uncertain commands automatically after reconnect.
        clearHeldCommitTimer()
        if (fieldText.length === 0) {
          resetFailedEmptyInputSession()
          return true
        }
        return false
      }

      const step = computeTerminalLiveMirrorStep(sentLiveInputTextRef.current, fieldText, {
        commitHeld
      })
      sentLiveInputTextRef.current = step.nextSentText
      heldLiveInputTextRef.current = step.heldText
      pendingLiveInputHandleRef.current =
        step.heldText.length > 0 || step.nextSentText.length > 0 ? handle : null

      clearHeldCommitTimer()
      if (step.heldText.length > 0) {
        heldCommitTimerRef.current = setTimeout(() => {
          heldCommitTimerRef.current = null
          const heldField = sentLiveInputTextRef.current + heldLiveInputTextRef.current
          void runMirrorStepRef.current(handle, heldField, true)
        }, TERMINAL_LIVE_HELD_SYLLABLE_COMMIT_DELAY_MS)
      }

      const payload = buildTerminalLiveMirrorPayload(step)
      if (payload.length === 0) {
        return waitForPendingLiveInputFlush()
      }
      const sendSessionGeneration = liveInputSessionGenerationRef.current
      const sendPromise = queueTerminalLiveMirrorSend(pendingLiveInputFlushRef, () =>
        sendLiveTerminalInputRef.current(handle, payload)
      )
      void sendPromise.then((accepted) => {
        if (!accepted && sendSessionGeneration === liveInputSessionGenerationRef.current) {
          if (currentLiveInputTextRef.current.length === 0) {
            // An explicit clear may happen while this RPC is pending. Once the
            // failed chain settles, reset that empty session so the next edit
            // starts fresh; an old completion must not poison a newer session.
            resetFailedEmptyInputSession()
            return
          }
          mirrorSendFailedRef.current = true
          clearHeldCommitTimer()
        }
      })
      return sendPromise
    },
    [
      activeHandleRef,
      activeSessionTabTypeRef,
      clearHeldCommitTimer,
      liveInputTerminalHandlesRef,
      resetMirrorState,
      resetFailedEmptyInputSession,
      sendLiveTerminalInputRef,
      waitForPendingLiveInputFlush
    ]
  )
  runMirrorStepRef.current = runMirrorStep

  const applyLiveInputMirror = useCallback(
    (handle: string, fieldText: string): void => {
      void runMirrorStep(handle, fieldText, false)
    },
    [runMirrorStep]
  )

  const flushPendingLiveInputText = useCallback(
    async (expectedHandle: string | null): Promise<boolean> => {
      const handle = pendingLiveInputHandleRef.current
      if (!handle) {
        return waitForPendingLiveInputFlush()
      }
      if (expectedHandle !== null && handle !== expectedHandle) {
        clearPendingLiveInputCommit()
        return waitForPendingLiveInputFlush()
      }
      if (mirrorSendFailedRef.current) {
        return false
      }

      const heldText = heldLiveInputTextRef.current
      const result =
        heldText.length > 0
          ? await runMirrorStep(handle, sentLiveInputTextRef.current + heldText, true)
          : await waitForPendingLiveInputFlush()

      if (!result) {
        mirrorSendFailedRef.current = true
        clearHeldCommitTimer()
        return false
      }

      // Why: an explicit flush ends the field's editing session; the echoed PTY
      // text stays, so local mirror state must restart from empty.
      clearPendingLiveInputCommit()
      return result
    },
    [clearHeldCommitTimer, clearPendingLiveInputCommit, runMirrorStep, waitForPendingLiveInputFlush]
  )

  useEffect(() => {
    return () => {
      if (heldCommitTimerRef.current) {
        clearTimeout(heldCommitTimerRef.current)
        heldCommitTimerRef.current = null
      }
      heldLiveInputTextRef.current = ''
      sentLiveInputTextRef.current = ''
      pendingLiveInputHandleRef.current = null
      pendingLiveInputFlushRef.current = null
    }
  }, [])

  return {
    applyLiveInputMirror,
    clearPendingLiveInputCommit,
    flushPendingLiveInputText,
    heldLiveInputTextRef,
    pendingLiveInputHandleRef,
    sentLiveInputTextRef,
    waitForPendingLiveInputFlush
  }
}
