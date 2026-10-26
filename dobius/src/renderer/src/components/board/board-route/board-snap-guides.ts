// Why: snap guides change on drag frames. Kept out of the Board route's React
// state so a snapping drag re-renders the cards layer only, never the chrome.
import { create } from 'zustand'
import type { SnapGuide } from '../board-canvas/board-snap'

export const NO_GUIDES: readonly SnapGuide[] = []

type BoardSnapGuidesStore = {
  guides: readonly SnapGuide[]
  set: (guides: readonly SnapGuide[]) => void
}

export const useBoardSnapGuides = create<BoardSnapGuidesStore>((set) => ({
  guides: NO_GUIDES,
  set: (guides) => set((s) => (s.guides === guides ? s : { guides }))
}))

/** Module-level setter so drag callbacks need no hook dependency on the store. */
export function setBoardSnapGuides(guides: readonly SnapGuide[]): void {
  useBoardSnapGuides.getState().set(guides)
}
