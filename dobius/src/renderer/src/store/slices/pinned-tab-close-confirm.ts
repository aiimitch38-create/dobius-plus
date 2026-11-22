import type { StateCreator } from 'zustand'
import type { AppState } from '../types'

/** A pending request to confirm closing a pinned tab. `onConfirm` runs the
 *  original close once the user accepts; the label is shown in the dialog. */
export type PinnedTabCloseConfirmRequest = {
  tabLabel: string
  onConfirm: () => void
  onCancel?: () => void
}

export type PinnedTabCloseConfirmSlice = {
  pinnedTabCloseConfirm: PinnedTabCloseConfirmRequest | null
  /** Requests made while one is showing; each is shown once the one before it is answered. */
  pinnedTabCloseConfirmQueue: PinnedTabCloseConfirmRequest[]
  requestPinnedTabCloseConfirm: (request: PinnedTabCloseConfirmRequest) => void
  confirmPinnedTabClose: () => void
  dismissPinnedTabClose: () => void
}

function showNextRequest(
  state: PinnedTabCloseConfirmSlice
): Pick<PinnedTabCloseConfirmSlice, 'pinnedTabCloseConfirm' | 'pinnedTabCloseConfirmQueue'> {
  const [next = null, ...rest] = state.pinnedTabCloseConfirmQueue
  return { pinnedTabCloseConfirm: next, pinnedTabCloseConfirmQueue: rest }
}

export const createPinnedTabCloseConfirmSlice: StateCreator<
  AppState,
  [],
  [],
  PinnedTabCloseConfirmSlice
> = (set, get) => ({
  pinnedTabCloseConfirm: null,
  pinnedTabCloseConfirmQueue: [],

  // Why a queue: one action can ask about several pinned tabs at once (the
  // Board's Reset). Replacing the showing request dropped the earlier ones
  // without an answer, so their tabs stayed open and their onCancel never ran.
  requestPinnedTabCloseConfirm: (request) =>
    set((state) =>
      state.pinnedTabCloseConfirm
        ? { pinnedTabCloseConfirmQueue: [...state.pinnedTabCloseConfirmQueue, request] }
        : { pinnedTabCloseConfirm: request }
    ),

  confirmPinnedTabClose: () => {
    const request = get().pinnedTabCloseConfirm
    if (!request) {
      return
    }
    // Why: clear before running onConfirm so a re-entrant close path can't see
    // the stale request and re-open the dialog.
    set(showNextRequest)
    request.onConfirm()
  },

  dismissPinnedTabClose: () => {
    const request = get().pinnedTabCloseConfirm
    if (!request) {
      return
    }
    // Why: CLI close requests wait for a response even when the user cancels.
    set(showNextRequest)
    request.onCancel?.()
  }
})
