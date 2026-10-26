import React, { useEffect, useMemo, useState } from 'react'
import { ChartColumn, CircleUserRound, RefreshCw, Terminal, X } from 'lucide-react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { ProviderRateLimits } from '../../../../../shared/rate-limit-types'
import { isConsoleAccountAgent } from '../../../../../shared/console-account'
import { boardUsageSummary } from '../board-route/board-usage-summary'
import { BOARD_MENU_CONTENT_CLASS, BOARD_MONO_CLASS } from './board-surface-classes'
import { BoardUsageAccountsView } from './usage/BoardUsageAccountsView'
import { BoardUsageLoaded } from './usage/BoardUsageLoaded'
import { BoardUsageLoading } from './usage/BoardUsageLoading'
import { BoardUsageStatsView } from './usage/BoardUsageStatsView'
import { BoardUsageTerminalView } from './usage/BoardUsageTerminalView'
import {
  USAGE_PROVIDER_LABELS,
  footerCommand,
  footerStatus,
  localTimeZone,
  usagePhase,
  type FooterStatus,
  type UsageProviderId
} from './usage/board-usage-model'
import { clearUsageProbeProgress, useUsageProbeStage } from './usage/board-usage-progress'
import { ProviderLogo } from './usage/ProviderLogo'
import { useUsageHeatmapData } from './usage/use-usage-heatmap-data'
import { usageProviderList, useUsageResetChime } from './usage/use-usage-reset-chime'
import './usage/board-usage.css'

type BoardUsagePanelProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  anchor: React.ReactNode
}

type UsageView = 'usage' | 'terminal' | 'stats' | 'accounts'

const HEADER_BUTTON =
  'flex size-7 items-center justify-center rounded-full bg-[var(--board-panel-2)] text-[var(--board-text)] hover:bg-[var(--board-panel-border)] [&_svg]:size-3.5'
const HEADER_BUTTON_ACTIVE = 'bg-[var(--board-accent-tint)] text-[var(--board-accent)]'

/** Wall clock that ticks once a second while `active` (elapsed timer, "updated … ago"). */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) {
      return
    }
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

function statusDotColor(p: ProviderRateLimits | null): string {
  const phase = usagePhase(p)
  return phase === 'loaded'
    ? 'var(--board-live)'
    : phase === 'unavailable'
      ? 'var(--board-danger-text)'
      : 'var(--board-accent)'
}

function HeaderButton({
  label,
  active,
  onClick,
  children,
  testId
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
  testId?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      data-testid={testId}
      className={cn(HEADER_BUTTON, active && HEADER_BUTTON_ACTIVE)}
    >
      {children}
    </button>
  )
}

function UnavailableMessage({
  provider
}: {
  provider: ProviderRateLimits | null
}): React.JSX.Element {
  return (
    <div className="px-5 pt-4 pb-5" data-testid="board-usage-unavailable">
      <div className="rounded-[12px] border border-[var(--board-panel-border)] p-3 text-[12px] text-[var(--board-text-muted)]">
        {provider?.error ?? translate('board.usagePanel.unavailable', 'Usage data is unavailable.')}
      </div>
    </div>
  )
}

/** "your subscription · updated just now · refreshing" (footer right side). */
export function footerStatusText(status: FooterStatus): string {
  if (status.kind === 'reading') {
    return translate('board.usagePanel.stageReading', 'Reading usage')
  }
  if (status.kind === 'unavailable') {
    return translate('board.usagePanel.statusUnavailable', 'no reading')
  }
  const { relative } = status
  const updated =
    relative.unit === 'now'
      ? translate('board.usagePanel.updatedNow', 'updated just now')
      : relative.unit === 'minutes'
        ? translate('board.usagePanel.updatedMinutes', 'updated {{count}}m ago', {
            count: relative.value
          })
        : relative.unit === 'hours'
          ? translate('board.usagePanel.updatedHours', 'updated {{count}}h ago', {
              count: relative.value
            })
          : translate('board.usagePanel.updatedDays', 'updated {{count}}d ago', {
              count: relative.value
            })
  const parts = [translate('board.usagePanel.footerPlan', 'your subscription'), updated]
  if (status.refreshing) {
    parts.push(translate('board.usagePanel.refreshing', 'refreshing'))
  }
  return parts.join(' · ')
}

export function BoardUsagePanel({
  open,
  onOpenChange,
  anchor
}: BoardUsagePanelProps): React.JSX.Element {
  useUsageResetChime()
  const rateLimits = useAppStore((s) => s.rateLimits)
  const providers = useMemo(() => usageProviderList(rateLimits), [rateLimits])
  const [view, setView] = useState<UsageView>('usage')
  const [picked, setPicked] = useState<UsageProviderId | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [fetchStartedAt, setFetchStartedAt] = useState<number | null>(null)

  // Selected provider: the user's pick while it still reports, else the pill's provider.
  const provider: UsageProviderId =
    picked && providers.some((p) => p.provider === picked)
      ? picked
      : (boardUsageSummary(providers)?.provider ?? providers[0]?.provider ?? 'claude')
  const current = providers.find((p) => p.provider === provider) ?? null
  const phase = usagePhase(current)
  const busy = current === null || current.status === 'fetching'
  const stage = useUsageProbeStage(provider)
  const now = useNow(open)
  const timeZone = useMemo(localTimeZone, [])
  const activity = useUsageHeatmapData(provider, {
    enabled: open && view === 'usage',
    refreshToken
  })

  // Elapsed timer: starts when the provider begins fetching, clears when it settles.
  useEffect(() => {
    if (busy && fetchStartedAt === null) {
      setFetchStartedAt(Date.now())
    } else if (!busy && fetchStartedAt !== null) {
      setFetchStartedAt(null)
      clearUsageProbeProgress(provider)
    }
  }, [busy, fetchStartedAt, provider])

  // Why: first open with no reading at all asks once; otherwise the service's
  // own cadence (focus/poll) and the refresh button are the only fetches.
  useEffect(() => {
    if (open && providers.length === 0) {
      void useAppStore.getState().refreshRateLimits()
    }
    if (!open) {
      setView('usage')
    }
  }, [open, providers.length])

  const refresh = (): void => {
    setRefreshToken((token) => token + 1)
    void useAppStore.getState().refreshRateLimits()
  }
  const close = (): void => onOpenChange(false)
  const elapsedSeconds = fetchStartedAt === null ? 0 : (now - fetchStartedAt) / 1000

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{anchor}</PopoverTrigger>
      <PopoverContent
        data-surface="board"
        align="end"
        sideOffset={10}
        className={cn(BOARD_MENU_CONTENT_CLASS, 'w-[440px] overflow-visible rounded-[28px] p-0')}
      >
        <PopoverPrimitive.Arrow width={16} height={8} className="fill-[var(--board-panel)]" />
        {view === 'accounts' ? (
          <BoardUsageAccountsView
            initialAgent={isConsoleAccountAgent(provider) ? provider : 'claude'}
            onBack={() => setView('usage')}
            onClose={close}
          />
        ) : (
          <>
            <div className="flex items-center gap-1.5 px-5 pt-4 pb-3">
              <h2 className="mr-auto text-[17px] leading-none font-bold text-[var(--board-text)]">
                {translate('board.usagePanel.title', 'usage')}
              </h2>
              <HeaderButton
                label={translate('board.usagePanel.viewTerminal', 'Raw CLI output')}
                active={view === 'terminal'}
                onClick={() => setView(view === 'terminal' ? 'usage' : 'terminal')}
                testId="board-usage-view-terminal"
              >
                <Terminal aria-hidden />
              </HeaderButton>
              <HeaderButton
                label={translate('board.usagePanel.viewStats', 'Token stats')}
                active={view === 'stats'}
                onClick={() => setView(view === 'stats' ? 'usage' : 'stats')}
                testId="board-usage-view-stats"
              >
                <ChartColumn aria-hidden />
              </HeaderButton>
              <HeaderButton
                label={translate('board.usagePanel.viewAccounts', 'Accounts')}
                onClick={() => setView('accounts')}
                testId="board-usage-view-accounts"
              >
                <CircleUserRound aria-hidden />
              </HeaderButton>
              <HeaderButton
                label={translate('board.usagePanel.refresh', 'Refresh')}
                onClick={refresh}
                testId="board-usage-refresh"
              >
                {busy ? (
                  <span
                    className="board-usage-record size-2.5 rounded-full bg-[var(--board-accent)]"
                    data-testid="board-usage-refresh-busy"
                    aria-hidden
                  />
                ) : (
                  <RefreshCw aria-hidden />
                )}
              </HeaderButton>
              <HeaderButton label={translate('board.usagePanel.close', 'Close')} onClick={close}>
                <X aria-hidden />
              </HeaderButton>
            </div>

            <div className="flex items-center gap-1.5 px-5 pb-1">
              {providers.map((p) => {
                const selected = p.provider === provider
                return (
                  <button
                    key={p.provider}
                    type="button"
                    onClick={() => setPicked(p.provider)}
                    aria-pressed={selected}
                    title={USAGE_PROVIDER_LABELS[p.provider]}
                    data-testid={`board-usage-provider-${p.provider}`}
                    className={cn(
                      'relative flex size-8 items-center justify-center rounded-[10px] border',
                      selected
                        ? 'border-[var(--board-accent)] bg-[var(--board-accent-tint)]'
                        : 'border-[var(--board-panel-border)] bg-[var(--board-panel)] hover:bg-[var(--board-panel-2)]'
                    )}
                  >
                    <ProviderLogo provider={p.provider} size={16} />
                    {selected ? (
                      <span
                        className="absolute -top-0.5 -right-0.5 size-2 rounded-full border border-[var(--board-panel)]"
                        style={{ backgroundColor: statusDotColor(p) }}
                        aria-hidden
                      />
                    ) : null}
                  </button>
                )
              })}
              <span className="ml-auto text-[12px] text-[var(--board-text-muted)]">
                {USAGE_PROVIDER_LABELS[provider]}
              </span>
            </div>

            {view === 'stats' ? (
              <BoardUsageStatsView />
            ) : view === 'terminal' ? (
              current ? (
                <BoardUsageTerminalView provider={current} />
              ) : (
                <UnavailableMessage provider={null} />
              )
            ) : phase === 'loading' ? (
              <BoardUsageLoading
                provider={provider}
                stage={stage}
                source={
                  current?.usageMetadata?.lastSuccessfulSource ?? current?.usageMetadata?.source
                }
                elapsedSeconds={elapsedSeconds}
              />
            ) : phase === 'unavailable' || !current ? (
              <UnavailableMessage provider={current} />
            ) : (
              <BoardUsageLoaded
                provider={current}
                now={now}
                timeZone={timeZone}
                activity={activity}
              />
            )}
          </>
        )}

        <div
          className="flex items-center gap-2 rounded-b-[28px] border-t border-[var(--board-panel-border)] bg-[var(--board-panel-2)] px-5 py-2.5 text-[11px]"
          data-testid="board-usage-footer"
        >
          <ProviderLogo provider={provider} size={13} />
          <span className={`${BOARD_MONO_CLASS} text-[var(--board-text)]`}>
            {footerCommand(provider, current?.usageMetadata?.source)}
          </span>
          <span
            className="ml-auto truncate text-[var(--board-text-muted)]"
            data-testid="board-usage-status"
          >
            {footerStatusText(footerStatus(current, now))}
          </span>
        </div>
      </PopoverContent>
    </Popover>
  )
}
