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

type TelegramSnapshot = {
  phase: string
  connected: boolean
  paused: boolean
  lastError: string | null
  groups: { id: string; title: string }[]
  drafts: { id: string; group: string; state: string }[]
  replyHandling: { bridge: string; listening: boolean } | null
  manualReviewCount: number
}

const REPLY_DONE = {
  start: 'Auto-replies started.',
  stop: 'Auto-replies stopped.',
  pause: 'Telegram account paused.',
  resume: 'Telegram account reconnected.'
} as const

export function formatSnapshot(snapshot: TelegramSnapshot): string {
  const lines = [
    `Account: ${snapshot.phase}${snapshot.connected ? ', connected' : ''}${snapshot.paused ? ', paused' : ''}`,
    `Auto-replies: ${snapshot.replyHandling?.listening ? 'on' : 'off'} (bridge ${snapshot.replyHandling?.bridge ?? 'unavailable'})`,
    `Groups: ${snapshot.groups.map((group) => group.title).join(', ') || 'none selected'}`,
    `Drafts: ${snapshot.drafts.length}, waiting for manual review: ${snapshot.manualReviewCount}`
  ]
  if (snapshot.lastError) {
    lines.push(`Last problem: ${snapshot.lastError}`)
  }
  return lines.join('\n')
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
  },
  'telegram snapshot': async ({ client, json }) => {
    printResult(await client.call<TelegramSnapshot>('telegram.snapshot'), json, formatSnapshot)
  },
  ...Object.fromEntries(
    (['start', 'stop', 'pause', 'resume'] as const).map((action) => [
      `telegram replies ${action}`,
      (async ({ client, json }) => {
        if ((action === 'start' || action === 'resume') && !json) {
          process.stderr.write('Waiting up to 25 seconds for you to confirm in the Dobius+ app...\n')
        }
        const result = await client.call<TelegramSnapshot>('telegram.replies', { action })
        printResult(result, json, (value) => `${REPLY_DONE[action]}\n${formatSnapshot(value)}`)
      }) satisfies CommandHandler
    ])
  )
}
