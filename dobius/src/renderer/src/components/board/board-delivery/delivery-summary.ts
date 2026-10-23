import { translate } from '@/i18n/i18n'
import type { DeliveryOutcome } from './delivery-gate'

/** One readable line for the thread from per-console outcomes. */
export function summarizeDelivery(results: readonly { name: string; outcome: DeliveryOutcome }[]): {
  ok: boolean
  text: string
} {
  const sent = results
    .filter((r) => r.outcome.kind === 'sent' && !r.outcome.busy)
    .map((r) => r.name)
  const busy = results.filter((r) => r.outcome.kind === 'sent' && r.outcome.busy).map((r) => r.name)
  const parts: string[] = []
  if (sent.length > 0) {
    parts.push(translate('board.delivery.sent', 'Sent to {{names}}.', { names: sent.join(', ') }))
  }
  if (busy.length > 0) {
    parts.push(
      translate('board.delivery.busy', '{{names}} busy, will take it after the current turn.', {
        names: busy.join(', ')
      })
    )
  }
  for (const r of results) {
    const o = r.outcome
    if (o.kind === 'skipped') {
      parts.push(skipLine(r.name, o.reason))
    } else if (o.kind === 'failed') {
      parts.push(
        translate('board.delivery.failed', '{{name}}: {{reason}}', {
          name: r.name,
          reason: o.reason
        })
      )
    }
  }
  if (parts.length === 0) {
    parts.push(translate('board.delivery.nobody', 'No console to send to.'))
  }
  return { ok: sent.length + busy.length > 0, text: parts.join(' ') }
}

function skipLine(
  name: string,
  reason: 'paused' | 'shell' | 'gone' | 'held-too-long' | 'cancelled'
): string {
  switch (reason) {
    case 'paused':
      return translate('board.delivery.paused', '{{name}} is paused; resume it first.', { name })
    case 'shell':
      return translate(
        'board.delivery.shell',
        '{{name}} is at its shell; restart it to send work.',
        { name }
      )
    case 'gone':
      return translate('board.delivery.gone', '{{name}} is closed.', { name })
    case 'held-too-long':
      return translate(
        'board.delivery.heldTooLong',
        '{{name}} stayed on a dialog for 5 minutes; dropped the message.',
        { name }
      )
    case 'cancelled':
      return translate('board.delivery.cancelled', '{{name}}: cancelled before it was typed.', {
        name
      })
  }
}
