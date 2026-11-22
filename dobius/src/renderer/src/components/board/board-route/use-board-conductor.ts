import { useCallback, useEffect, useRef, useState } from 'react'
import { translate } from '@/i18n/i18n'
import type { BoardThreadMessage, BoardThreadReport } from '../board-command-bar/BoardThread'
import {
  appendToBoardThread,
  onBoardThreadAppend,
  readStoredThread,
  writeStoredThread
} from './board-thread-store'

const POLL_MS = 1500
const POLL_FOR_MS = 3 * 60 * 1000

type NewMessage = Omit<BoardThreadMessage, 'id'>

export type BoardConductor = {
  messages: BoardThreadMessage[]
  busy: boolean
  append: (message: NewMessage) => void
  /** `shown` goes in the thread; `transcript` (with board context) goes to the conductor. */
  ask: (shown: string, transcript: string) => Promise<void>
  /** Appends a finished-agent reply as a compact report row (see `BoardThreadReport`). */
  appendReport: (report: BoardThreadReport) => void
  /** Empties the active repo's thread, local to this repo only. */
  clearThread: () => void
  /** Appends to one repo's thread, whether or not it is the thread on screen. */
  appendTo: (repoId: string | null, message: NewMessage) => void
  /** Shows a waiting row (never saved) in one repo's thread; call the returned function to take it away. */
  showThinkingIn: (repoId: string | null, text: string) => () => void
}

export function useBoardConductor(
  onOpenSettings: () => void,
  repoId: string | null
): BoardConductor {
  const [messages, setMessages] = useState<BoardThreadMessage[]>(() => readStoredThread(repoId))
  const [busy, setBusy] = useState(false)
  const timers = useRef(new Set<ReturnType<typeof setInterval>>())
  const openSettingsRef = useRef(onOpenSettings)
  openSettingsRef.current = onOpenSettings
  const loadedRepoId = useRef(repoId)
  const waiting = useRef(new Map<string, { repoId: string | null; row: BoardThreadMessage }>())

  useEffect(() => {
    const active = timers.current
    return () => {
      active.forEach(clearInterval)
      active.clear()
    }
  }, [])

  // A tab switch within one repo keeps its thread; switching repos loads that
  // repo's own persisted thread (never a never-chatted repo's placeholder text).
  useEffect(() => {
    if (loadedRepoId.current === repoId) {
      return
    }
    loadedRepoId.current = repoId
    // Waiting rows are never stored, so a reply still in flight for this repo is put back.
    const stillWaiting = [...waiting.current.values()].flatMap((w) =>
      w.repoId === repoId ? [w.row] : []
    )
    setMessages([...readStoredThread(repoId), ...stillWaiting])
  }, [repoId])

  useEffect(() => {
    if (loadedRepoId.current === repoId) {
      writeStoredThread(repoId, messages)
    }
  }, [repoId, messages])

  const append = useCallback((message: NewMessage) => {
    setMessages((prev) => [...prev, { ...message, id: crypto.randomUUID() }])
  }, [])

  const appendReport = useCallback(
    (report: BoardThreadReport) => {
      append({ role: 'assistant', text: report.excerpt, report })
    },
    [append]
  )

  const clearThread = useCallback(() => {
    setMessages([])
  }, [])

  // Rows for the thread on screen go into state (and are saved from there); the
  // store saves rows for any other repo itself.
  useEffect(
    () =>
      onBoardThreadAppend((target, row) => {
        if (loadedRepoId.current !== target) {
          return false
        }
        setMessages((prev) => [...prev, row])
        return true
      }),
    []
  )

  const appendTo = useCallback(
    (target: string | null, message: NewMessage) => appendToBoardThread(target, message),
    []
  )

  const showThinkingIn = useCallback((target: string | null, text: string) => {
    const row: BoardThreadMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      text,
      transient: true
    }
    waiting.current.set(row.id, { repoId: target, row })
    if (loadedRepoId.current === target) {
      setMessages((prev) => [...prev, row])
    }
    return () => {
      waiting.current.delete(row.id)
      setMessages((prev) => prev.filter((message) => message.id !== row.id))
    }
  }, [])

  const poll = useCallback(
    (requestId: string) => {
      const startedAt = Date.now()
      let sinceTs = 0
      let inFlight = false
      const timer = setInterval(() => {
        if (Date.now() - startedAt > POLL_FOR_MS) {
          clearInterval(timer)
          timers.current.delete(timer)
          return
        }
        if (inFlight) {
          return
        }
        inFlight = true
        window.api.agents
          .conductorReply({ requestId, sinceTs })
          .then((reply) => {
            // Why: the reply store keeps only the latest reply per request, so
            // each newer ts is a fresh update worth showing.
            if (reply && reply.ts > sinceTs) {
              sinceTs = reply.ts
              append({ role: 'assistant', text: reply.message })
            }
          })
          .catch((error: unknown) => console.warn('Board conductor reply poll failed:', error))
          .finally(() => {
            inFlight = false
          })
      }, POLL_MS)
      timers.current.add(timer)
    },
    [append]
  )

  const ask = useCallback(
    async (shown: string, transcript: string) => {
      append({ role: 'user', text: shown })
      const requestId = crypto.randomUUID()
      setBusy(true)
      let result: { ok: true } | { ok: false; error: string }
      try {
        result = await window.api.agents.conductorCommand({ requestId, transcript })
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : String(error) }
      } finally {
        setBusy(false)
      }
      if (!result.ok) {
        append({
          role: 'system',
          tone: 'error',
          text: result.error,
          action: {
            label: translate('board.conductor.enable', 'Turn on Voice Conductor in Settings'),
            onClick: () => openSettingsRef.current()
          }
        })
        return
      }
      poll(requestId)
    },
    [append, poll]
  )

  return { messages, busy, append, ask, appendReport, clearThread, appendTo, showThinkingIn }
}
