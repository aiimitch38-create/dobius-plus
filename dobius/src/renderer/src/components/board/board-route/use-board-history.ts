import { useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import { getBoard, type BoardState } from '@/store/slices/board'
import {
  EMPTY_BOARD_HISTORY,
  boardContentOf,
  reconcileConsoleCards,
  recordBoardChange,
  redoBoardStep,
  sameBoardContent,
  undoBoardStep,
  type BoardContent,
  type BoardHistory
} from './board-history'

// A drag fires a store update per frame; changes closer together than this
// collapse into one undo step.
const BURST_MS = 400

// Session-scoped per worktree, so leaving the Board for Classic keeps the stack.
const histories = new Map<string, BoardHistory>()

type RestoreAction = (worktreeId: string, content: BoardContent) => void

// Why: another window's edits arrive through hydrateBoards (main rebroadcasts
// ui.set). They are not this window's undo steps, and replaying old snapshots
// over them would erase that window's work, so they rebase and clear history.
let applyingRemote = false
let remoteGuardInstalled = false

function installRemoteGuard(): void {
  if (remoteGuardInstalled) {
    return
  }
  remoteGuardInstalled = true
  const original = useAppStore.getState().hydrateBoards
  useAppStore.setState({
    hydrateBoards: (raw: unknown) => {
      applyingRemote = true
      try {
        original(raw)
      } finally {
        applyingRemote = false
      }
    }
  })
}

function applyContent(worktreeId: string, content: BoardContent): void {
  const state = useAppStore.getState() as ReturnType<typeof useAppStore.getState> & {
    restoreBoardContent?: RestoreAction
  }
  if (state.restoreBoardContent) {
    state.restoreBoardContent(worktreeId, content)
    return
  }
  // ponytail: until the store exposes restoreBoardContent (requested from Builder 2),
  // the restored board applies in-session and is saved by the next edit.
  useAppStore.setState((s) => {
    const board: BoardState = getBoard(s, worktreeId)
    return { boardsByWorktree: { ...s.boardsByWorktree, [worktreeId]: { ...board, ...content } } }
  })
}

export function useBoardHistory(worktreeId: string | null): {
  undo: () => boolean
  redo: () => boolean
} {
  const last = useRef<BoardContent | null>(null)
  const burstBefore = useRef<BoardContent | null>(null)
  const burstTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const applying = useRef(false)

  const flush = useCallback(() => {
    if (burstTimer.current) {
      clearTimeout(burstTimer.current)
      burstTimer.current = null
    }
    if (worktreeId && burstBefore.current) {
      histories.set(
        worktreeId,
        recordBoardChange(histories.get(worktreeId) ?? EMPTY_BOARD_HISTORY, burstBefore.current)
      )
    }
    burstBefore.current = null
  }, [worktreeId])

  useEffect(() => {
    if (!worktreeId) {
      return
    }
    installRemoteGuard()
    last.current = boardContentOf(getBoard(useAppStore.getState(), worktreeId))
    const unsubscribe = useAppStore.subscribe((state) => {
      const current = boardContentOf(getBoard(state, worktreeId))
      const previous = last.current
      if (!previous || sameBoardContent(previous, current)) {
        return
      }
      last.current = current
      if (applyingRemote) {
        if (burstTimer.current) {
          clearTimeout(burstTimer.current)
          burstTimer.current = null
        }
        burstBefore.current = null
        histories.delete(worktreeId)
        return
      }
      if (applying.current) {
        return
      }
      if (!burstBefore.current) {
        burstBefore.current = previous
      }
      if (burstTimer.current) {
        clearTimeout(burstTimer.current)
      }
      burstTimer.current = setTimeout(flush, BURST_MS)
    })
    return () => {
      unsubscribe()
      flush()
    }
  }, [flush, worktreeId])

  const step = useCallback(
    (direction: 'undo' | 'redo'): boolean => {
      if (!worktreeId) {
        return false
      }
      flush()
      const current = boardContentOf(getBoard(useAppStore.getState(), worktreeId))
      const history = histories.get(worktreeId) ?? EMPTY_BOARD_HISTORY
      const result =
        direction === 'undo' ? undoBoardStep(history, current) : redoBoardStep(history, current)
      if (!result) {
        return false
      }
      histories.set(worktreeId, result.history)
      const liveTabIds = new Set(
        Object.values(useAppStore.getState().tabsByWorktree).flatMap((tabs) =>
          tabs.map((t) => t.id)
        )
      )
      const content = reconcileConsoleCards(result.content, current, liveTabIds)
      applying.current = true
      try {
        applyContent(worktreeId, content)
      } finally {
        applying.current = false
      }
      last.current = boardContentOf(getBoard(useAppStore.getState(), worktreeId))
      return true
    },
    [flush, worktreeId]
  )

  return {
    undo: useCallback(() => step('undo'), [step]),
    redo: useCallback(() => step('redo'), [step])
  }
}
