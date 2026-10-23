// Current pick in each tool panel. Card-creation code reads it with
// getBoardToolStyle() at the moment a shape, stroke or text card is made.
// ponytail: session-only; persist via the UI slice if users ask for sticky styles.
import { create } from 'zustand'
import {
  DEFAULT_BOARD_CARD_STYLE,
  type BoardCardStyle,
  type BoardToolShape
} from './board-tool-style'

export type BoardStyledTool = 'shape' | 'text' | 'pen'

type BoardToolStyleState = {
  shape: BoardToolShape
  styles: Record<BoardStyledTool, BoardCardStyle>
  setShape: (shape: BoardToolShape) => void
  setStyle: (tool: BoardStyledTool, patch: Partial<BoardCardStyle>) => void
}

export const useBoardToolStyle = create<BoardToolStyleState>((set) => ({
  shape: 'rect',
  styles: {
    shape: DEFAULT_BOARD_CARD_STYLE,
    text: DEFAULT_BOARD_CARD_STYLE,
    pen: { ...DEFAULT_BOARD_CARD_STYLE, sloppiness: 'architect' }
  },
  setShape: (shape) => set({ shape }),
  setStyle: (tool, patch) =>
    set((s) => ({ styles: { ...s.styles, [tool]: { ...s.styles[tool], ...patch } } }))
}))

/** Snapshot for card creation: the style for `tool` (and the picked shape kind). */
export function getBoardToolStyle(tool: BoardStyledTool): {
  shape: BoardToolShape
  style: BoardCardStyle
} {
  const s = useBoardToolStyle.getState()
  return { shape: s.shape, style: s.styles[tool] }
}
