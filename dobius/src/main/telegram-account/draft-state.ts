import type { TelegramVaultState } from './types'

export function findTelegramDraft(
  state: TelegramVaultState,
  id: unknown,
  expectedRevision: unknown,
  states:
    | TelegramVaultState['drafts'][number]['state']
    | TelegramVaultState['drafts'][number]['state'][]
): TelegramVaultState['drafts'][number] | null {
  if (
    typeof id !== 'string' ||
    typeof expectedRevision !== 'number' ||
    !Number.isSafeInteger(expectedRevision)
  ) {
    return null
  }
  const allowedStates = Array.isArray(states) ? states : [states]
  return (
    state.drafts.find(
      (draft) =>
        draft.id === id &&
        draft.revision === expectedRevision &&
        allowedStates.includes(draft.state)
    ) ?? null
  )
}
