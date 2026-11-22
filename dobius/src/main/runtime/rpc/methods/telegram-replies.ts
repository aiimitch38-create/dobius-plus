// Telegram reply handling and a fuller read-only snapshot over RPC (CLI
// `dobius telegram replies start|stop|pause|resume`, `dobius telegram
// snapshot`), through the same live account the Settings page owns
// (telegram-account/terminal-access.ts). Sign-in, consent, group choice and
// approving drafts stay desktop-only.
// Why start and resume are gated: both make the app talk to Telegram again
// (resume reconnects the account; start lets incoming messages reach ADAM for
// drafting), so a human must click in the app first. Stop and pause only
// switch things off.
import { z } from 'zod'
import { TELEGRAM_SAFE_ERRORS } from '../../../../shared/telegram-account'
import type { TelegramAccountView } from '../../../../shared/telegram-account-api'
import {
  telegramTerminalAccess,
  type TelegramTerminalAccess
} from '../../../telegram-account/terminal-access'
import { defineMethod, type RpcMethod } from '../core'
import { describeCaller, type ConfirmationGate } from './confirm-gate'
import { appConfirmationGate } from './crew-confirm'

const SAFE_ERRORS = new Set<string>([...TELEGRAM_SAFE_ERRORS, 'telegram-unavailable'])

const Replies = z.object({ action: z.enum(['start', 'stop', 'pause', 'resume']) }).strict()

type ReplyAction = z.infer<typeof Replies>['action']

const CONFIRM: Partial<Record<ReplyAction, { title: string; detail: string; label: string }>> = {
  start: {
    title: 'Start Telegram auto-replies?',
    detail:
      'New messages in your selected Telegram groups go to ADAM, who drafts replies. Nothing is sent until you approve each draft.',
    label: 'Start replies'
  },
  resume: {
    title: 'Reconnect your Telegram account?',
    detail: 'Dobius+ connects to Telegram again with your saved account.',
    label: 'Reconnect'
  }
}

// Why: SDK and crypto errors can carry credentials, so only the closed list
// of codes leaves main (same rule as the telegramAccount IPC handlers).
async function safely<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    const code =
      error instanceof Error && SAFE_ERRORS.has(error.message)
        ? error.message
        : 'authorization-failed'
    throw new Error(`Telegram: ${code}`)
  }
}

/** The account view without consent evidence or participant details. */
export function telegramSnapshot(view: TelegramAccountView): Record<string, unknown> {
  const { account } = view
  return {
    phase: account.phase,
    connected: account.connected,
    paused: account.paused,
    canResume: account.canResume ?? false,
    lastError: account.lastError,
    groups: account.selectedGroups.map((group) => ({ id: group.id, title: group.title })),
    drafts: account.drafts.map((draft) => ({
      id: draft.id,
      group: draft.groupTitle,
      state: draft.state,
      createdAt: draft.createdAt
    })),
    replyHandling: view.replyHandling ?? null,
    manualReviewCount: view.manualReview?.length ?? 0,
    consentCount: view.consents?.length ?? 0,
    recentActivity: view.audit.slice(-10)
  }
}

export function buildTelegramReplyMethods(
  requireConfirmation: ConfirmationGate,
  access: () => TelegramTerminalAccess = telegramTerminalAccess
): RpcMethod[] {
  return [
    defineMethod({
      name: 'telegram.snapshot',
      params: null,
      handler: () => safely(async () => telegramSnapshot(await access().view()))
    }),
    defineMethod({
      name: 'telegram.replies',
      params: Replies,
      handler: async (params, ctx) => {
        const telegram = await safely(async () => access())
        const confirm = CONFIRM[params.action]
        if (confirm) {
          await requireConfirmation(
            {
              title: confirm.title,
              message: 'Something outside the app asked to change Telegram reply handling.',
              detail: `${describeCaller(ctx)}\n\n${confirm.detail}`,
              confirmLabel: confirm.label
            },
            ctx
          )
        }
        await safely(() => telegram.replies[params.action]())
        return {
          action: params.action,
          ...telegramSnapshot(await safely(() => telegram.view()))
        }
      }
    })
  ]
}

export const TELEGRAM_REPLY_METHODS: RpcMethod[] = buildTelegramReplyMethods(appConfirmationGate)
