import { useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import type { BoardTool } from '@/store/slices/board'

/**
 * Tool selection plus its options panel: picking Shapes/Text/Pen opens the panel,
 * picking the active tool again toggles it, Esc closes it.
 */
export function useBoardToolPanel(
  worktreeId: string | null,
  activeTool: BoardTool
): { toolPanelOpen: boolean; setTool: (tool: BoardTool) => void } {
  const [toolPanelOpen, setToolPanelOpen] = useState(false)

  useEffect(() => {
    if (!toolPanelOpen) {
      return
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setToolPanelOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toolPanelOpen])

  const setTool = (tool: BoardTool): void => {
    if (!worktreeId) {
      return
    }
    const hasPanel = tool === 'shape' || tool === 'text' || tool === 'pen' || tool === 'screen'
    if (tool === activeTool) {
      setToolPanelOpen((open) => hasPanel && !open)
      return
    }
    useAppStore.getState().setTool(worktreeId, tool)
    setToolPanelOpen(hasPanel)
  }

  return { toolPanelOpen, setTool }
}
