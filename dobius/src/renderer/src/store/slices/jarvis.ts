import type { StateCreator } from 'zustand'
import type { AppState } from '../types'

export type JarvisHudPhase = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'

export type JarvisSlice = {
  /**
   * Mirrors the voice controller's merged phase (local turn machine + main's
   * broadcasts) so the orb renders the SAME state the controller computes —
   * including manual ⌘T listening, which main never broadcasts.
   */
  jarvisHud: { state: JarvisHudPhase; reason?: string }
  setJarvisHud: (state: JarvisHudPhase, reason?: string) => void
}

export const createJarvisSlice: StateCreator<AppState, [], [], JarvisSlice> = (set) => ({
  jarvisHud: { state: 'idle' },
  setJarvisHud: (state, reason) => set({ jarvisHud: { state, reason } })
})
