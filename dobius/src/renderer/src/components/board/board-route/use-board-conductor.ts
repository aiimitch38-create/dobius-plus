import { useCallback, useEffect, useState } from 'react'
import type { BoardThreadMessage, BoardThreadReport } from '../board-command-bar/BoardThread'
import { ADAM_THREAD_STORAGE_KEY } from './board-thread-persistence'
import {
  appendToBoardThread,
  onBoardThreadAppend,
  readStoredThread,
  writeStoredThread
} from './board-thread-store'

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

/** ADAM's one thread, the same on every project's Board: its rows, and the ways to add to it. */
export function useBoardConductor(): BoardConductor {
  const [messages, setMessages] = useState<BoardThreadMessage[]>(readStoredThread)

  useEffect(() => {
    writeStoredThread(messages)
  }, [messages])

  useEffect(
    () =>
      onBoardThreadAppend((row) =>
        setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]))
      ),
    []
  )

  // Another window added to the thread: show its rows here too, keeping this window's waiting row.
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === ADAM_THREAD_STORAGE_KEY) {
        setMessages((prev) => [...readStoredThread(), ...prev.filter((m) => m.transient)])
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const append = useCallback((message: NewMessage) => appendToBoardThread(message), [])

  const appendReport = useCallback(
    (report: BoardThreadReport) => {
      append({ role: 'assistant', text: report.excerpt, report })
    },
    [append]
  )

  const clearThread = useCallback(() => {
    setMessages([])
  }, [])

  const showThinking = useCallback((text: string) => {
    const row: BoardThreadMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      text,
      transient: true
    }
    setMessages((prev) => [...prev, row])
    return () => {
      setMessages((prev) => prev.filter((message) => message.id !== row.id))
    }
  }, [])

  return { messages, append, appendReport, clearThread, showThinking }
}
