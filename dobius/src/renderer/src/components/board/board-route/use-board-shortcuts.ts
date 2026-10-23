import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import { getBoard } from '@/store/slices/board'
import { resolveBoardShortcut, type BoardShortcutAction } from '../board-chrome/board-shortcut-map'
import type { BoardChipId } from '../board-command-bar/board-command-chips'
import type { BoardStudioId } from '../board-studios/board-studio-ids'
import { duplicateBoardCards } from './board-duplicate'
import type { BoardSelection } from './use-board-selection'

const STUDIO_FOR: Partial<Record<BoardShortcutAction, BoardStudioId>> = {
  openLoops: 'loops',
  openDocs: 'markdown',
  openSkills: 'skills',
  openMemory: 'memory',
  openMissionMap: 'mission-map'
}

type BoardShortcutHandlers = {
  worktreeId: string | null
  selection: BoardSelection
  undo: () => boolean
  redo: () => boolean
  onChip: (id: BoardChipId) => void
  openStudio: (studio: BoardStudioId) => void
  openGitHub: () => void
}

/**
 * Board keyboard map (Cmd+G/A/D/Z, Shift+Cmd+Z, studio letters). Blocking inside
 * consoles, fields and studios lives in resolveBoardShortcut. Cmd+0 is left to
 * the canvas, which already owns zoom keys.
 */
export function useBoardShortcuts(handlers: BoardShortcutHandlers): void {
  const ref = useRef(handlers)
  ref.current = handlers

  useEffect(() => {
    const isMac = navigator.userAgent.includes('Mac')
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat) {
        return
      }
      const action = resolveBoardShortcut(event, isMac)
      if (!action || action === 'resetZoom') {
        return
      }
      const h = ref.current
      const studio = STUDIO_FOR[action]
      if (studio) {
        event.preventDefault()
        h.openStudio(studio)
        return
      }
      const worktreeId = h.worktreeId
      if (!worktreeId) {
        return
      }
      event.preventDefault()
      const board = getBoard(useAppStore.getState(), worktreeId)
      switch (action) {
        case 'undo':
          h.undo()
          return
        case 'redo':
          h.redo()
          return
        case 'group':
          h.onChip('group')
          return
        case 'selectAll':
          h.selection.selectOnly(board.cards.map((c) => c.id))
          return
        case 'openGitHub':
          h.openGitHub()
          return
        case 'duplicate': {
          const copies = duplicateBoardCards(worktreeId, h.selection.selectedIds)
          if (copies.length > 0) {
            h.selection.selectOnly(copies)
          }
          return
        }
        default:
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
