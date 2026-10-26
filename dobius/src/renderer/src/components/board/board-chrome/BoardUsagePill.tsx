import React from 'react'
import { Gauge } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { BOARD_FLOATING_PANEL_CLASS, BOARD_MONO_CLASS } from './board-surface-classes'
import { usageLevel, usageLevelColor } from './board-usage-levels'
import { ProviderLogo } from './usage/ProviderLogo'
import { USAGE_PROVIDER_ORDER, type UsageProviderId } from './usage/board-usage-model'

export type BoardUsagePillData = {
  provider: string
  usedPercent: number
  resetDescription: string | null
}

function isUsageProvider(provider: string): provider is UsageProviderId {
  return (USAGE_PROVIDER_ORDER as readonly string[]).includes(provider)
}

/** "Mon 2:20 AM" -> "Mon 2:20am": the provider's text with the meridiem tightened, nothing else. */
export function compactResetText(text: string): string {
  return text.replace(/\s?(AM|PM)\b/i, (match) => match.trim().toLowerCase())
}

/**
 * Top-bar anchor for the usage popover (usage-pill reference): gauge, provider
 * mark, "resets", mono time, accent outline. Spreads button props so it can be
 * a Radix `asChild` trigger.
 */
export function BoardUsagePill({
  usage,
  className,
  ...props
}: { usage: BoardUsagePillData } & React.ComponentPropsWithRef<'button'>): React.JSX.Element {
  const level = usageLevel(usage.usedPercent)
  return (
    <button
      type="button"
      title={translate(
        'board.topBar.usageHint',
        '{{percent}}% of the limit used. Click for details.',
        { percent: usage.usedPercent }
      )}
      data-usage-level={level}
      {...props}
      className={cn(
        BOARD_FLOATING_PANEL_CLASS,
        'flex h-7 items-center gap-1.5 rounded-full border-[var(--board-accent)] bg-[var(--board-status-pill)] px-2.5 text-[12px] font-medium tabular-nums hover:bg-[var(--board-panel-2)]',
        className
      )}
      style={level === 'normal' ? props.style : { ...props.style, color: usageLevelColor(level) }}
    >
      <Gauge className="size-3.5 text-[var(--board-text-muted)]" aria-hidden />
      {isUsageProvider(usage.provider) ? (
        <ProviderLogo provider={usage.provider} size={13} />
      ) : null}
      {usage.resetDescription ? (
        <>
          <span className="text-[var(--board-text-muted)]">
            {translate('board.topBar.resets', 'resets')}
          </span>
          <span className={BOARD_MONO_CLASS}>{compactResetText(usage.resetDescription)}</span>
        </>
      ) : (
        translate('board.topBar.usage', '{{percent}}% used', { percent: usage.usedPercent })
      )}
    </button>
  )
}
