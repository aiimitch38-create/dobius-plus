import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BoardThreadMessage, BoardThreadReport } from '../board-command-bar/BoardThread'
import { appendToBoardThread, threadFromMain } from './board-thread-store'

type NewMessage = Omit<BoardThreadMessage, 'id'>

export type BoardConductor = {
  messages: BoardThreadMessage[]
  /** Adds a row to ADAM's thread; it is kept even if the Board has been closed meanwhile. */
  append: (message: NewMessage) => void
  /** Appends a finished-agent reply as a compact report row (see `BoardThreadReport`). */
  appendReport: (report: BoardThreadReport) => void
  clearThread: () => void
  /** Shows a waiting row (never saved); call the returned function to take it away. */
  showThinking: (text: string) => () => void
}

/**
 * ADAM's one thread, the same on every project's Board. The saved rows are
 * whatever main last sent (it keeps the latest 200); this window only adds its
 * own waiting rows on top and never writes the thread itself.
 */
export function useBoardConductor(): BoardConductor {
  const [saved, setSaved] = useState<BoardThreadMessage[]>([])
  const [waiting, setWaiting] = useState<BoardThreadMessage[]>([])

  useEffect(() => {
    let heard = false
    const off = window.api.jarvis.onAdamThread((rows) => {
      heard = true
      setSaved(threadFromMain(rows))
    })
    void window.api.jarvis
      .adamThreadGet()
      .then((rows) => {
        // A change that arrived while this was in flight is newer than the reply.
        if (!heard) {
          setSaved(threadFromMain(rows))
        }
      })
      .catch((error: unknown) => console.warn('ADAM thread could not be loaded:', error))
    return off
  }, [])

  const append = useCallback((message: NewMessage) => appendToBoardThread(message), [])

  const appendReport = useCallback(
    (report: BoardThreadReport) => {
      append({ role: 'assistant', text: report.excerpt, report })
    },
    [append]
  )

  const clearThread = useCallback(() => {
    void window.api.jarvis.adamThreadClear().catch((error: unknown) => {
      console.warn('ADAM thread could not be cleared:', error)
    })
  }, [])

  const showThinking = useCallback((text: string) => {
    const row: BoardThreadMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      text,
      transient: true
    }
    setWaiting((prev) => [...prev, row])
    return () => {
      setWaiting((prev) => prev.filter((message) => message.id !== row.id))
    }
  }, [])

  const messages = useMemo(() => [...saved, ...waiting], [saved, waiting])
  return { messages, append, appendReport, clearThread, showThinking }
}
