import type { TelegramVaultState } from './types'

/** Crash-left sends and inference admissions require manual reconciliation, never replay. */
export function recoverTelegramVaultState(state: TelegramVaultState): TelegramVaultState {
  const outbox = state.outbox.map((entry) =>
    entry.state === 'prepared' ? { ...entry, state: 'unknown' as const } : entry
  )
  const drafts = state.drafts.map((draft) =>
    draft.state === 'sending' ? { ...draft, state: 'unknown' as const } : draft
  )
  const inboundEvents = state.inboundEvents.map((event) =>
    event.state === 'processing' ? { ...event, state: 'manual-review' as const } : event
  )
  if (
    !outbox.some((entry, index) => entry !== state.outbox[index]) &&
    !drafts.some((draft, index) => draft !== state.drafts[index]) &&
    !inboundEvents.some((event, index) => event !== state.inboundEvents[index])
  ) {
    return state
  }
  return { ...state, outbox, drafts, inboundEvents }
}
