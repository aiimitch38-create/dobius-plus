import type { TelegramAccountService } from '../telegram-account/service'
import type { TelegramTerminalSendResult } from '../../shared/telegram-account-api'

type SendableDraft = { id: string; groupTitle: string; body: string }

/**
 * Terminal-initiated send. Carson still decides every message: the confirm callback is a
 * native dialog in Dobius+, so an agent running the CLI on its own cannot send anything.
 */
export async function sendDraftFromTerminal(
  service: TelegramAccountService,
  draftId: string,
  confirm: (draft: SendableDraft) => Promise<boolean>
): Promise<TelegramTerminalSendResult> {
  const find = () => service.snapshot().drafts.find((draft) => draft.id === draftId)
  const draft = find()
  if (!draft || (draft.state !== 'awaiting-approval' && draft.state !== 'approved')) {
    throw new Error('draft-not-sendable')
  }
  const seen = {
    id: draft.id,
    groupTitle: draft.groupTitle,
    body: draft.body,
    revision: draft.revision
  }
  if (!(await confirm(seen))) {
    return { draftId, outcome: 'declined' }
  }
  // Only the exact text Carson saw in the dialog may be sent.
  if (find()?.revision !== seen.revision || find()?.body !== seen.body) {
    throw new Error('stale-operation')
  }
  if (find()?.state === 'awaiting-approval') {
    const approved = service.approveDraft(draftId, find()?.revision)
    if (!approved.ok) {
      throw new Error(approved.error)
    }
  }
  const sent = await service.sendDraft(draftId, find()?.revision)
  if (!sent.ok) {
    throw new Error(sent.error)
  }
  return { draftId, outcome: sent.value }
}
