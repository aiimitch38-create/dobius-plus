import { useCallback, useEffect, useRef, useState } from 'react'
import { translate } from '@/i18n/i18n'
import type { BoardThreadMessage, BoardThreadReport } from '../board-command-bar/BoardThread'
import {
  boardThreadStorageKey,
  deserializeBoardThread,
  serializeBoardThread
} from './board-thread-persistence'

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
}

/** Best-effort: a storage failure (private window, quota, hardened context) must never break the thread. */
function readStoredThread(repoId: string | null): BoardThreadMessage[] {
  if (!repoId) {
    return []
  }
  try {
    return deserializeBoardThread(window.localStorage.getItem(boardThreadStorageKey(repoId)))
  } catch {
    return []
  }
}

function writeStoredThread(repoId: string | null, messages: BoardThreadMessage[]): void {
  if (!repoId) {
    return
  }
  try {
    window.localStorage.setItem(boardThreadStorageKey(repoId), serializeBoardThread(messages))
  } catch {
    // Storage can be unavailable or full; the in-memory thread still works this session.
  }
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
    setMessages(readStoredThread(repoId))
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

  return { messages, busy, append, ask, appendReport, clearThread }
}
