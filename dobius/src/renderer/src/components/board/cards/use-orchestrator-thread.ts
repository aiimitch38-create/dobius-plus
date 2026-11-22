import { useCallback, useEffect, useRef, useState } from 'react'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { callRuntimeRpc, type RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { useAppStore } from '@/store'
import { getBoard } from '@/store/slices/board'
import { goalTaskPrefix } from '../board-goal/goal-reminders'
import type { OrchestratorMessage } from './OrchestratorCard'
import {
  inboxToThread,
  orchestratorHandle,
  orchestratorRelayTargets,
  relaySubject,
  relayThreadId,
  type InboxRow
} from './orchestrator-relay'

type TerminalList = {
  terminals: {
    handle: string
    tabId: string
    originTabId?: string | null
    leafId: string
    connected: boolean
    ptyId: string | null
  }[]
}

const WAIT_MS = 25_000
const RETRY_MS = 5_000

function runtimeTarget(worktreeId: string): RuntimeClientTarget {
  const environmentId = getRuntimeEnvironmentIdForWorktree(useAppStore.getState(), worktreeId)
  return environmentId ? { kind: 'environment', environmentId } : { kind: 'local' }
}

/**
 * Thread for one orchestrator card. Sends go through orchestration.send to each
 * wired console's handle (never a group, never the focused terminal); replies
 * are collected from the card's own mailbox with blocking checks.
 */
export function useOrchestratorThread(
  worktreeId: string,
  cardId: string,
  wiredCardIds: readonly string[]
): {
  messages: OrchestratorMessage[]
  /** `onlyCardIds` narrows delivery to those wired consoles (an @mention). */
  send: (text: string, onlyCardIds?: readonly string[]) => Promise<void>
  /** Adds a card-side line (a refusal) to the thread without sending anything. */
  note: (text: string) => void
} {
  const [messages, setMessages] = useState<OrchestratorMessage[]>([])
  const titles = useRef(new Map<string, string>())
  const handle = orchestratorHandle(cardId)

  useEffect(() => {
    let stopped = false
    const poll = async (): Promise<void> => {
      while (!stopped) {
        try {
          const result = await callRuntimeRpc<{ messages: InboxRow[] }>(
            runtimeTarget(worktreeId),
            'orchestration.check',
            { terminal: handle, wait: true, timeoutMs: WAIT_MS },
            { timeoutMs: WAIT_MS + 5_000 }
          )
          if (!stopped && result.messages.length > 0) {
            setMessages((prev) => [...prev, ...inboxToThread(result.messages, titles.current)])
          }
        } catch (error) {
          console.debug('[board-orchestrator] check failed', error)
          await new Promise((resolve) => setTimeout(resolve, RETRY_MS))
        }
      }
    }
    void poll()
    return () => {
      stopped = true
    }
  }, [handle, worktreeId])

  const send = useCallback(
    async (text: string, onlyCardIds?: readonly string[]): Promise<void> => {
      const board = getBoard(useAppStore.getState(), worktreeId)
      const target = runtimeTarget(worktreeId)
      const { terminals } = await callRuntimeRpc<TerminalList>(target, 'terminal.list', {
        worktree: `id:${worktreeId}`
      })
      // Why: re-read wiring at send time so a console disconnected meanwhile gets nothing.
      const { targets } = orchestratorRelayTargets(
        board.cards,
        wiredCardIds,
        onlyCardIds,
        terminals,
        (tabId) => useAppStore.getState().terminalLayoutsByTabId[tabId]?.activeLeafId ?? null
      )
      for (const t of targets) {
        titles.current.set(t.terminal.handle, t.title)
      }
      if (targets.length === 0) {
        throw new Error('no_wired_consoles_running')
      }
      setMessages((prev) => [...prev, { id: `local-${Date.now()}`, role: 'user', text }])
      const threadId = relayThreadId(cardId, Date.now())
      const cardTabId = new Map(
        board.cards.flatMap((c) => (c.kind === 'console' ? [[c.id, c.tabId] as const] : []))
      )
      await Promise.all(
        targets.map((t) =>
          callRuntimeRpc(target, 'orchestration.send', {
            to: t.terminal.handle,
            from: handle,
            subject: relaySubject(text),
            // Why: a task handed out by the orchestrator carries the goals wired to that console.
            body: `${goalTaskPrefix(cardTabId.get(t.cardId) ?? t.terminal.tabId) ?? ''}${text}`,
            threadId
          })
        )
      )
    },
    [cardId, handle, wiredCardIds, worktreeId]
  )

  const note = useCallback((text: string) => {
    setMessages((prev) => [...prev, { id: `note-${Date.now()}`, role: 'orchestrator', text }])
  }, [])

  return { messages, send, note }
}
