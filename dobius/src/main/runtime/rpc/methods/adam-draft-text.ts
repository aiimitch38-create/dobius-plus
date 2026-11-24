// `dobius adam draft-text` over RPC (7.17): ADAM drafts a text to one of
// Carson's tracked contacts. It only ever makes a DRAFT; Carson sends it with
// his own click in Settings. Same caller proof as `adam notify`.
import { z } from 'zod'
import { TEXT_DRAFT_MAX_CHARS, TRACKED_CONTACT_NAME_MAX } from '../../../../shared/text-intake'
import { textIntake, type TextIntake } from '../../../text-intake/text-intake'
import { defineMethod, type RpcMethod } from '../core'
import { isAdamLocalCaller } from './adam-notify'
import { hasHiddenCharacters, HIDDEN_CHARACTERS_MESSAGE } from './confirm-gate'

const visible = (max: number, missing: string) =>
  z
    .string()
    .refine((value) => !hasHiddenCharacters(value), HIDDEN_CHARACTERS_MESSAGE)
    .transform((value) => value.trim())
    .pipe(z.string().min(1, missing).max(max, `Too long (over ${max} characters)`))

const DraftText = z
  .object({
    to: visible(TRACKED_CONTACT_NAME_MAX, 'Missing --to (a tracked contact name)'),
    text: visible(TEXT_DRAFT_MAX_CHARS, 'Missing --text'),
    caller: z.literal('adam', { message: 'Only ADAM can use dobius adam draft-text' }),
    callerId: z.string().max(200)
  })
  .strict()

export const ADAM_DRAFT_TEXT_ONLY_ADAM =
  'Only ADAM can use dobius adam draft-text (from his own Hermes session on this Mac).'

export type DraftTextResult = { draftId: string; toName: string; toHandle: string; sent: false }

export function buildAdamDraftTextMethods(intake: () => TextIntake | null = textIntake): RpcMethod[] {
  return [
    defineMethod({
      name: 'adam.draftText',
      params: DraftText,
      handler: (params, ctx): DraftTextResult => {
        if (!isAdamLocalCaller(ctx, params.callerId)) {
          throw new Error(ADAM_DRAFT_TEXT_ONLY_ADAM)
        }
        const current = intake()
        if (!current) {
          throw new Error('Dobius+ is still starting; try again in a minute.')
        }
        const draft = current.createDraft(params.to, params.text)
        return { draftId: draft.id, toName: draft.toName, toHandle: draft.toHandle, sent: false }
      }
    })
  ]
}

export const ADAM_DRAFT_TEXT_METHODS: RpcMethod[] = buildAdamDraftTextMethods()
