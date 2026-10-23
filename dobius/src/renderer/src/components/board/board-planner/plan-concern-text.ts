import { translate } from '@/i18n/i18n'
import type { SafetyConcern } from './plan-safety'

/** Finishes "Text that …" for one risky-text category. */
export function riskyCategoryPhrase(category: string): string {
  switch (category) {
    case 'delete':
      return translate('board.plan.concern.risk.delete', 'could delete files or data')
    case 'history':
      return translate('board.plan.concern.risk.history', 'could rewrite git history')
    case 'publish':
      return translate('board.plan.concern.risk.publish', 'could publish or deploy')
    case 'credentials':
      return translate('board.plan.concern.risk.credentials', 'mentions passwords, keys or secrets')
    case 'install':
      return translate('board.plan.concern.risk.install', 'could install software')
    case 'files':
      return translate('board.plan.concern.risk.files', 'could move files or change permissions')
    case 'admin':
      return translate('board.plan.concern.risk.admin', 'runs as admin (sudo)')
    case 'permissions':
      return translate('board.plan.concern.risk.permissions', "skips the agent's permission checks")
    default:
      return translate('board.plan.concern.risk.other', 'could be risky ({{category}})', {
        category
      })
  }
}

/** One plain line per safety concern, for the confirmation dialog. */
export function concernText(c: SafetyConcern): string {
  switch (c.kind) {
    case 'risky-text':
      return translate('board.plan.concern.riskyText', 'Text that {{what}}: "{{text}}"', {
        what: riskyCategoryPhrase(c.category),
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
