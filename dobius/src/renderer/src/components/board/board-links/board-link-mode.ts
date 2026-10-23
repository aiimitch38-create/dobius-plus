// Board-wide "pick a target" mode. While set, clicks on cards wire them to an
// orchestrator or finish an arrow instead of selecting. Session-only.
import { create } from 'zustand'

export type BoardLinkMode =
  | { kind: 'wire'; worktreeId: string; orchestratorId: string }
  | { kind: 'arrow'; worktreeId: string; fromCardId: string }

export const useBoardLinkMode = create<{
  mode: BoardLinkMode | null
  start: (mode: BoardLinkMode) => void
  stop: () => void
}>((set) => ({
  mode: null,
  start: (mode) => set({ mode }),
  stop: () => set({ mode: null })
}))
