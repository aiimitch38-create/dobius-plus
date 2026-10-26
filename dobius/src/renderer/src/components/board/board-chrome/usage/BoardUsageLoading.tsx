import React from 'react'
import { Info } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { UsageProbeStage, UsageRateLimitSource } from '../../../../../../shared/rate-limit-types'
import { BOARD_MONO_CLASS } from '../board-surface-classes'
import {
  USAGE_PROVIDER_LABELS,
  formatElapsed,
  isCliProbe,
  probeStageKey,
  type UsageProviderId
} from './board-usage-model'
import { ProviderLogo } from './ProviderLogo'

const STAGE_FALLBACKS = {
  stageOauth: 'Reading your plan from the provider',
  stageCliStart: 'Starting the {{provider}} CLI',
  stageCliUsage: 'Asking the CLI for /usage',
  stageReading: 'Reading usage'
} as const

/** Centered orbit spinner around the provider mark, with the live stage and elapsed timer. */
export function BoardUsageLoading({
  provider,
  stage,
  source,
  elapsedSeconds
}: {
  provider: UsageProviderId
  stage: UsageProbeStage | null
  source: UsageRateLimitSource | undefined
  elapsedSeconds: number
}): React.JSX.Element {
  const label = USAGE_PROVIDER_LABELS[provider]
  const stageKey = probeStageKey(stage)
  // Why: the "no prompt is sent" note names the CLI page only when the hidden
  // CLI probe is what is (or was last) reading usage for this provider.
  const note = isCliProbe(stage, source)
    ? translate(
        'board.usagePanel.noteCli',
        'It reads the same page the CLI prints for you; no prompt is sent to a model.'
      )
    : translate(
        'board.usagePanel.noteApi',
        'It reads usage from your signed-in account; no prompt is sent to a model.'
      )
  return (
    <div
      className="flex flex-col items-center px-6 pt-7 pb-6 text-center"
      data-testid="board-usage-loading"
      role="status"
      aria-live="polite"
    >
      <div className="relative size-[72px]">
        <div
          className="absolute inset-0 rounded-full border-[3px] border-[var(--board-accent)] opacity-20"
          aria-hidden
        />
        {[3, 2, 1].map((trail) => (
          <div key={trail} className="board-usage-orbit" data-trail={trail} aria-hidden>
            <span className="board-usage-orbit-dot" />
          </div>
        ))}
        <div className="board-usage-orbit" aria-hidden>
          <span className="board-usage-orbit-dot" />
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <ProviderLogo provider={provider} size={28} />
        </div>
      </div>
      <p className="mt-5 flex items-baseline gap-2 text-[15px] font-semibold text-[var(--board-text)]">
        {translate('board.usagePanel.askingFor', 'Asking {{provider}} for usage', {
          provider: label
        })}
        <span
          className={`${BOARD_MONO_CLASS} text-[13px] font-medium text-[var(--board-text-muted)] tabular-nums`}
          data-testid="board-usage-elapsed"
        >
          {formatElapsed(elapsedSeconds)}
        </span>
      </p>
      <p className="mt-1 text-[13px] text-[var(--board-text-muted)]" data-testid="board-usage-stage">
        {translate(`board.usagePanel.${stageKey}`, STAGE_FALLBACKS[stageKey], { provider: label })}
      </p>
      <p className="mt-4 flex items-start gap-1.5 text-left text-[11px] text-[var(--board-text-muted)]">
        <Info className="mt-[1px] size-3 shrink-0" aria-hidden />
        <span>{note}</span>
      </p>
    </div>
  )
}
