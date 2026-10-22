import type {
  TelegramHistoryPage,
  TelegramTerminalSendResult
} from '../../shared/telegram-account-api'
import type { CommandHandler } from '../dispatch'
import {
  getOptionalNonNegativeIntegerFlag,
  getOptionalPositiveIntegerFlag,
  getRequiredStringFlag
} from '../flags'
import { printResult } from '../format'

type TelegramStatus = {
  connected: boolean
  listening: boolean
  bridge: string
  groups: string[]
  drafts: { id: string; group: string; state: string; body: string }[]
  needsManualReview: { group: string; messageId: string }[]
}

function formatStatus(status: TelegramStatus): string {
  const lines = [
    `Account: ${status.connected ? 'connected' : 'not connected'}`,
    `Adam listening: ${status.listening ? 'yes' : 'no'} (bridge ${status.bridge})`,
    `Groups: ${status.groups.join(', ') || 'none selected'}`,
    `Drafts: ${status.drafts.length}`
  ]
  for (const draft of status.drafts) {
    lines.push(`  ${draft.id} [${draft.state}] ${draft.group}: ${draft.body}`)
  }
  if (status.needsManualReview.length > 0) {
    lines.push(`Needs manual review: ${status.needsManualReview.length}`)
  }
  return lines.join('\n')
}

const SEND_OUTCOME: Record<TelegramTerminalSendResult['outcome'], string> = {
  sent: 'Sent. Telegram confirmed delivery.',
  unknown: 'Send started, but Telegram did not confirm delivery. Check the group before retrying.',
  declined: 'Carson cancelled the send. Nothing was sent.'
}

function formatHistory(page: TelegramHistoryPage): string {
  if (page.count === 0) {
    return `${page.groupTitle}: no earlier messages.`
  }
  const more =
    page.oldestMessageId === null ? '' : `\n\nOlder messages: --before ${page.oldestMessageId}`
  return `${page.groupTitle} (${page.count} messages, oldest first)\n\n${page.text}${more}`
}

export const TELEGRAM_HANDLERS: Record<string, CommandHandler> = {
  'telegram status': async ({ client, json }) => {
    printResult(await client.call<TelegramStatus>('telegram.status'), json, formatStatus)
  },
  'telegram send': async ({ client, flags, json }) => {
    const result = await client.call<TelegramTerminalSendResult>('telegram.send', {
      draft: getRequiredStringFlag(flags, 'draft')
    })
    printResult(result, json, (value) => SEND_OUTCOME[value.outcome])
  },
  'telegram history': async ({ client, flags, json }) => {
    const result = await client.call<TelegramHistoryPage>('telegram.history', {
      group: getRequiredStringFlag(flags, 'group'),
      limit: getOptionalPositiveIntegerFlag(flags, 'limit'),
      before: getOptionalNonNegativeIntegerFlag(flags, 'before')
    })
    printResult(result, json, formatHistory)
  }
}
