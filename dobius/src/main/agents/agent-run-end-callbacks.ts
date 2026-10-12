// A run's end callbacks, made exactly-once and non-throwing.
//
// Why: consumeRun's catch handles stream errors. A throw from a caller's
// onResult (or from bookkeeping after it) used to land there and fire
// onRunEnded as a second, contradictory end. onSettled fires last, after the
// runner has released the run's session lease and slot.

import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentRun, CustomAgent } from '../../shared/agents'
import { appendAgentRunNotification } from './agent-notification-store'

export type RunEndCallbacks = {
  onResult?: (message: SDKResultMessage) => void
  onRunEnded?: (status: 'error' | 'cancelled', summary: string) => void
  onSettled?: () => void
}

export type GuardedRunEndCallbacks = {
  onResult: (message: SDKResultMessage) => void
  onRunEnded: (status: 'error' | 'cancelled', summary: string) => void
  onSettled: () => void
}

function logCallbackError(name: string, error: unknown): void {
  console.error(
    `[agents] run ${name} callback failed:`,
    error instanceof Error ? error.message : String(error)
  )
}

export function guardRunEndCallbacks(callbacks: RunEndCallbacks | undefined): GuardedRunEndCallbacks {
  let ended = false
  let settled = false
  return {
    onResult: (message) => {
      if (ended) {
        return
      }
      ended = true
      try {
        callbacks?.onResult?.(message)
      } catch (error) {
        logCallbackError('onResult', error)
      }
    },
    onRunEnded: (status, summary) => {
      if (ended) {
        return
      }
      ended = true
      try {
        callbacks?.onRunEnded?.(status, summary)
      } catch (error) {
        logCallbackError('onRunEnded', error)
      }
    },
    onSettled: () => {
      if (settled) {
        return
      }
      settled = true
      try {
        callbacks?.onSettled?.()
      } catch (error) {
        logCallbackError('onSettled', error)
      }
    }
  }
}

/** A failed notification write must not turn a finished run into an error. */
export function appendRunNotificationSafely(agent: CustomAgent, run: AgentRun): void {
  try {
    appendAgentRunNotification(agent, run)
  } catch (error) {
    console.error(
      '[agents] could not record the run notification:',
      error instanceof Error ? error.message : String(error)
    )
  }
}
