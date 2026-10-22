import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { telegramTerminalAccess } from '../../../telegram-account/terminal-access'

const Send = z.object({ draft: z.string().min(1).max(128) })

const History = z.object({
  group: z.string().min(1).max(256),
  before: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(200).default(50)
})

// Terminal Adam can read status, drafts and history. Sending a draft always waits for Carson's
// confirmation in a Dobius+ dialog, so the CLI alone can never deliver a message.
export const TELEGRAM_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'telegram.status',
    params: null,
    handler: async () => {
      const view = await telegramTerminalAccess().view()
      return {
        connected: view.account.connected,
        phase: view.account.phase,
        listening: view.replyHandling?.listening ?? false,
        bridge: view.replyHandling?.bridge ?? 'unavailable',
        groups: view.account.selectedGroups.map((group) => group.title),
        drafts: view.account.drafts.map((draft) => ({
          id: draft.id,
          group: draft.groupTitle,
          state: draft.state,
          createdAt: draft.createdAt,
          body: draft.body
        })),
        needsManualReview: (view.manualReview ?? []).map((item) => ({
          group: item.groupTitle,
          messageId: item.messageId
        })),
        recentActivity: view.audit.slice(-10)
      }
    }
  }),
  defineMethod({
    name: 'telegram.send',
    params: Send,
    handler: async (params) => telegramTerminalAccess().send(params.draft)
  }),
  defineMethod({
    name: 'telegram.history',
    params: History,
    handler: async (params) =>
      telegramTerminalAccess().history(params.group, params.before, params.limit)
  })
]
