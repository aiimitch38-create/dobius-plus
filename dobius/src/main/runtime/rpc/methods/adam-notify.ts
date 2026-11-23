// `dobius adam notify` over RPC: ADAM taps Carson on the shoulder. Why no
// confirmation dialog (unlike adam.ask/say): only ADAM may call it, proven by
// the caller id his Hermes process alone carries (adam-caller-id.ts), and
// only over the local socket with the full key (never the agent key, never a
// phone). The notifier checks the setting, size, secrets and rate limits.
import { z } from 'zod'
import { ADAM_NOTIFY_MAX_CHARS } from '../../../../shared/adam-speaks-up'
import { isAdamCallerId } from '../../../jarvis/adam-caller-id'
import {
  adamNotifier,
  type AdamNotifier,
  type AdamNotifyResult
} from '../../../jarvis/adam-notify'
import { defineMethod, type RpcContext, type RpcMethod } from '../core'
import { hasHiddenCharacters, HIDDEN_CHARACTERS_MESSAGE } from './confirm-gate'

const Notify = z
  .object({
    text: z
      .string()
      .refine((value) => !hasHiddenCharacters(value), HIDDEN_CHARACTERS_MESSAGE)
      .transform((value) => value.trim())
      .pipe(
        z
          .string()
          .min(1, 'Missing --text')
          .max(ADAM_NOTIFY_MAX_CHARS, `Text is too long (over ${ADAM_NOTIFY_MAX_CHARS} characters)`)
      ),
    urgent: z.boolean().optional(),
    caller: z.literal('adam', { message: 'Only ADAM can use dobius adam notify' }),
    callerId: z.string().max(200)
  })
  .strict()

export const ADAM_NOTIFY_ONLY_ADAM =
  'Only ADAM can use dobius adam notify (from his own Hermes session on this Mac).'

/** True only for ADAM's own process on this Mac's private socket, with the full key. */
export function isAdamLocalCaller(ctx: RpcContext, callerId: unknown): boolean {
  return (
    ctx.authenticatedLocal === true &&
    ctx.agentKey !== true &&
    ctx.clientKind !== 'mobile' &&
    isAdamCallerId(callerId)
  )
}

export function buildAdamNotifyMethods(
  notifier: () => AdamNotifier | null = adamNotifier
): RpcMethod[] {
  return [
    defineMethod({
      name: 'adam.notify',
      params: Notify,
      handler: async (params, ctx): Promise<AdamNotifyResult> => {
        if (!isAdamLocalCaller(ctx, params.callerId)) {
          throw new Error(ADAM_NOTIFY_ONLY_ADAM)
        }
        const current = notifier()
        if (!current) {
          throw new Error('Dobius+ is still starting; try again in a minute.')
        }
        return current.notify(params.text, params.urgent === true)
      }
    })
  ]
}

export const ADAM_NOTIFY_METHODS: RpcMethod[] = buildAdamNotifyMethods()
