import { telegramListenerDiagnostic } from './listener-diagnostics'

const RECENT_MESSAGE_LIMIT = 20
const MAX_LINE_CHARS = 500
// Keeps context plus the 4096-byte new message under the bridge's 16k-character request limit.
const MAX_CONTEXT_CHARS = 10_000

export type HistoryMessage = {
  id?: unknown
  date?: unknown
  out?: boolean
  message?: unknown
  sender?: unknown
}
export type HistoryClient = {
  getMessages: (
    entity: unknown,
    params: { limit: number; maxId: number }
  ) => Promise<HistoryMessage[]>
}

/** Recent text lines before `beforeId` (0 = newest), oldest first, so Adam sees the conversation. */
export async function readRecentContext(
  client: unknown,
  chat: unknown,
  beforeId: number,
  limit = RECENT_MESSAGE_LIMIT
): Promise<string> {
  if (!isHistoryClient(client)) {
    return ''
  }
  try {
    const messages = await client.getMessages(chat, {
      limit,
      maxId: beforeId
    })
    const lines = messages
      .toReversed()
      .flatMap((item) =>
        typeof item.message === 'string' && item.message.trim()
          ? [`${senderLabel(item)}: ${item.message.trim().slice(0, MAX_LINE_CHARS)}`]
          : []
      )
    return newestWithinBudget(lines).join('\n')
  } catch (error) {
    telegramListenerDiagnostic('context-unavailable', {
      error: error instanceof Error ? error.name : typeof error
    })
    return ''
  }
}

function newestWithinBudget(lines: string[]): string[] {
  const kept: string[] = []
  let total = 0
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    total += lines[index].length + 1
    if (total > MAX_CONTEXT_CHARS) {
      break
    }
    kept.unshift(lines[index])
  }
  return kept
}

export function senderLabel(item: HistoryMessage): string {
  if (item.out) {
    return 'Carson'
  }
  const sender = (item.sender ?? {}) as Record<string, unknown>
  const name = [sender.firstName, sender.lastName]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .join(' ')
  const label = name || sender.username || sender.title
  return typeof label === 'string' && label ? label.slice(0, 64) : 'Member'
}

export function isHistoryClient(value: unknown): value is HistoryClient {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { getMessages?: unknown }).getMessages === 'function'
  )
}
