import { translate } from '@/i18n/i18n'
import type { SafetyConcern } from './plan-safety'

/** One plain line per safety concern, for the confirmation dialog. */
export function concernText(c: SafetyConcern): string {
  switch (c.kind) {
    case 'risky-text':
      return translate('board.plan.concern.risky', 'Text that could {{category}}: "{{text}}"', {
        category: c.category,
        text: c.text.slice(0, 120)
      })
    case 'unnamed-consoles':
      return translate(
        'board.plan.concern.unnamed',
        'Reaches consoles you did not name: {{names}}',
        {
          names: c.names.join(', ')
        }
      )
    case 'everyone-but-named':
      return translate(
        'board.plan.concern.everyone',
        'Sends to everyone, though you named {{names}}',
        {
          names: c.named.join(', ')
        }
      )
    case 'unsaid-url':
      return translate('board.plan.concern.url', 'Opens a link you did not say: {{url}}', {
        url: c.url
      })
    case 'unsaid-git':
      return translate('board.plan.concern.git', 'Runs a GitHub {{action}} you did not ask for', {
        action: c.action
      })
    case 'destructive':
      return c.target
        ? translate('board.plan.concern.destructive', 'Ends {{target}} ({{step}})', {
            target: c.target,
            step: c.step
          })
        : translate('board.plan.concern.destructiveNoTarget', 'Runs {{step}}', { step: c.step })
  }
}
