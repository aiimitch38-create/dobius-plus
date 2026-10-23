// Which existing card the style editor is editing (one at a time, session only).
import { create } from 'zustand'

export type CardStyleEditorTarget = { worktreeId: string; cardId: string }

export const useCardStyleEditor = create<{
  target: CardStyleEditorTarget | null
  open: (target: CardStyleEditorTarget) => void
  close: () => void
}>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null })
}))
