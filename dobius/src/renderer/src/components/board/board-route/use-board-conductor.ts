import { useCallback, useEffect, useRef, useState } from 'react'
import type { BoardThreadMessage, BoardThreadReport } from '../board-command-bar/BoardThread'
import {
  appendToBoardThread,
  onBoardThreadAppend,
  readStoredThread,
  writeStoredThread
} from './board-thread-store'

type NewMessage = Omit<BoardThreadMessage, 'id'>

export type BoardConductor = {
  messages: BoardThreadMessage[]
  append: (message: NewMessage) => void
  /** Appends a finished-agent reply as a compact report row (see `BoardThreadReport`). */
  appendReport: (report: BoardThreadReport) => void
  /** Empties the active repo's thread, local to this repo only. */
  clearThread: () => void
  /** Appends to one repo's thread, whether or not it is the thread on screen. */
  appendTo: (repoId: string | null, message: NewMessage) => void
  /** Shows a waiting row (never saved) in one repo's thread; call the returned function to take it away. */
  showThinkingIn: (repoId: string | null, text: string) => () => void
}

/** The Board thread for one repo: its rows, and the ways to add to it. */
export function useBoardConductor(repoId: string | null): BoardConductor {
  const [messages, setMessages] = useState<BoardThreadMessage[]>(() => readStoredThread(repoId))
  const loadedRepoId = useRef(repoId)
  const waiting = useRef(new Map<string, { repoId: string | null; row: BoardThreadMessage }>())

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

  return { messages, append, appendReport, clearThread, appendTo, showThinkingIn }
}
