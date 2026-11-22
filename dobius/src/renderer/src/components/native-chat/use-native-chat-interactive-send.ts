import { useCallback, useEffect, useRef } from 'react'
import { sendRuntimePtyInput } from '@/runtime/runtime-terminal-inspection'
import { getSettingsForAgentTabRuntimeOwner } from '@/lib/agent-paste-draft'
import type { AgentType } from '../../../../shared/native-chat-types'
import {
  NATIVE_CHAT_QUESTION_STEP_MS,
  NATIVE_CHAT_SUBMIT_DELAY_MS,
  sendNativeChatAnswer,
  sendNativeChatMessage,
  type NativeChatSendHandle
} from './native-chat-runtime-send'

// ESC is the agent-TUI interrupt/cancel key over the PTY (matches how the
// composer forwards Escape). Used to cancel a question or deny an approval.
const ESC = '\x1b'

export type NativeChatInteractiveSend = {
  /** Send answer text (bracketed-paste wrapped + Enter, like the composer). */
  sendAnswer: (text: string) => void
  /** Send a raw control string (e.g. an approval option number or ESC) as-is. */
  sendRaw: (raw: string) => void
  /** Send ESC to interrupt — cancels a question / denies an approval. */
  cancel: () => void
  /** True while an answer's paste/Enter writes are still scheduled. */
  isAnswering: () => boolean
}

/** How long an answer's scheduled writes run: one body+Enter for a single
 *  line, a full question step per line for Claude's multi-step prompt. */
export function nativeChatAnswerDurationMs(lineCount: number, stepped: boolean): number {
  return stepped && lineCount > 1
    ? lineCount * NATIVE_CHAT_QUESTION_STEP_MS
    : NATIVE_CHAT_SUBMIT_DELAY_MS
}

/**
 * Reuse the desktop composer's exact send path for the interactive cards:
 * resolve this tab's live ptyId + runtime owner settings, then write bytes via
 * `sendRuntimePtyInput` (which branches local pty:write vs remote runtime RPC,
 * so SSH panes work unchanged). Answers go through `sendNativeChatMessage`
 * (bracketed-paste framed body, then a separate delayed Enter); control strings
 * (option digits, ESC) are written raw so the agent reads them as keystrokes.
 */
export function useNativeChatInteractiveSend(
  terminalTabId: string,
  targetPtyId: string | null,
  agent: AgentType
): NativeChatInteractiveSend {
  // The in-flight answer's cancel handle; cleared on a new send, on Stop, and on
  // unmount so a detached setTimeout chain can't keep writing PTY bytes after
  // the view is gone / the user switched away.
  const inFlightRef = useRef<NativeChatSendHandle | null>(null)
  const busyUntilRef = useRef(0)
  const cancelInFlight = useCallback(() => {
    inFlightRef.current?.cancel()
    inFlightRef.current = null
    busyUntilRef.current = 0
  }, [])
  useEffect(() => cancelInFlight, [cancelInFlight])

  const sendRaw = useCallback(
    (raw: string) => {
      if (!targetPtyId) {
        return
      }
      sendRuntimePtyInput(getSettingsForAgentTabRuntimeOwner(terminalTabId), targetPtyId, raw)
    },
    [terminalTabId, targetPtyId]
  )

  const sendAnswer = useCallback(
    (text: string) => {
      if (text.trim() === '') {
        return
      }
      if (!targetPtyId) {
        return
      }
      // Cancel any prior in-flight answer before starting a new one.
      cancelInFlight()
      const settings = getSettingsForAgentTabRuntimeOwner(terminalTabId)
      // Only Claude's AskUserQuestion is a MULTI-STEP prompt: one question per
      // step, each Enter advances to the next, the final Enter submits. So a
      // multi-line answer (one line per question, as `formatAskAnswer` builds
      // it) is sent as a per-question sequence — body then its own Enter, paced
      // so each Enter lands on its rendered question and only the last submits.
      // Other agents (e.g. Codex) submit the whole answer with one Enter, so
      // gate the stepping on Claude and send a single body + Enter otherwise.
      const lines = text.split('\n')
      busyUntilRef.current =
        Date.now() + nativeChatAnswerDurationMs(lines.length, agent === 'claude')
      inFlightRef.current =
        agent === 'claude'
          ? sendNativeChatAnswer(settings, targetPtyId, lines)
          : sendNativeChatMessage(settings, targetPtyId, text)
    },
    [terminalTabId, targetPtyId, agent, cancelInFlight]
  )

  // Stop/cancel: drop any pending answer writes, then send ESC to interrupt.
  const cancel = useCallback(() => {
    cancelInFlight()
    sendRaw(ESC)
  }, [cancelInFlight, sendRaw])

  const isAnswering = useCallback(() => Date.now() < busyUntilRef.current, [])

  return { sendAnswer, sendRaw, cancel, isAnswering }
}
