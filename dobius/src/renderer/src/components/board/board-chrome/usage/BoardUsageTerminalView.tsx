import React from 'react'
import { translate } from '@/i18n/i18n'
import type { ProviderRateLimits } from '../../../../../../shared/rate-limit-types'
import { BOARD_MONO_CLASS } from '../board-surface-classes'
import { USAGE_PROVIDER_LABELS } from './board-usage-model'

/** The cleaned text the hidden CLI probe read, verbatim; nothing else parses it here. */
export function BoardUsageTerminalView({
  provider
}: {
  provider: ProviderRateLimits
}): React.JSX.Element {
  const output = provider.cliOutput?.trim() ?? ''
  return (
    <div className="px-5 pt-3 pb-4" data-testid="board-usage-terminal">
      <p className="mb-2 text-[10px] font-semibold tracking-[0.12em] text-[var(--board-text-muted)] uppercase">
        {translate('board.usagePanel.terminalTitle', 'What the probe read')}
      </p>
      {output ? (
        <pre
          className={`${BOARD_MONO_CLASS} max-h-[300px] overflow-auto rounded-[12px] bg-[var(--board-code-surface)] p-3 text-[11px] leading-[1.5] whitespace-pre-wrap text-[var(--board-text)]`}
        >
          {output}
        </pre>
      ) : (
        <p className="text-[12px] text-[var(--board-text-muted)]">
          {translate(
            'board.usagePanel.noRawOutput',
            'No CLI output captured for {{provider}}. The /usage page is only read when the hidden CLI probe runs.',
            { provider: USAGE_PROVIDER_LABELS[provider.provider] }
          )}
        </p>
      )}
    </div>
  )
}
