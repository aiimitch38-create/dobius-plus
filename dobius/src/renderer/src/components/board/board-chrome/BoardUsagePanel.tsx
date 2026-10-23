import React, { lazy, Suspense } from 'react'
import { RefreshCw } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { ProviderRateLimits, RateLimitWindow } from '../../../../../shared/rate-limit-types'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { BOARD_MENU_CONTENT_CLASS, BOARD_MONO_CLASS } from './board-surface-classes'

// Why: UsageOverviewPane pulls in the full daily-intensity grid + token-mix
// model; only the "Tokens" tab needs it, so defer the bundle cost until then.
const UsageOverviewPane = lazy(() =>
  import('@/components/stats/UsageOverviewPane').then((m) => ({ default: m.UsageOverviewPane }))
)

type BoardUsagePanelProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  anchor: React.ReactNode
}

const DANGER_THRESHOLD_PERCENT = 90

// Order fixed so the panel reads the same every time regardless of fetch order.
const PROVIDER_ORDER: ProviderRateLimits['provider'][] = [
  'claude',
  'codex',
  'gemini',
  'opencode-go',
  'kimi',
  'minimax'
]

const PROVIDER_LABELS: Record<ProviderRateLimits['provider'], string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  'opencode-go': 'OpenCode Go',
  kimi: 'Kimi',
  minimax: 'MiniMax'
}

function RateLimitBar({
  rateWindow,
  label
}: {
  rateWindow: RateLimitWindow
  label: string
}): React.JSX.Element {
  const used = Math.max(0, Math.min(100, rateWindow.usedPercent))
  const isDanger = used >= DANGER_THRESHOLD_PERCENT
  // Reference usage panel (005-resets…png): bold label + percent, thick bar, mono reset line.
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-[13px] font-semibold text-[var(--board-text)]">
        <span>{label}</span>
        <span className="tabular-nums">{Math.round(used)}%</span>
      </div>
      <div className="h-[7px] w-full overflow-hidden rounded-full bg-[var(--board-panel-2)]">
        <div
          className="h-full rounded-full transition-[width]"
          style={{
            width: `${used}%`,
            backgroundColor: isDanger ? 'var(--board-danger-text)' : 'var(--board-accent)'
          }}
        />
      </div>
      {rateWindow.resetDescription ? (
        <p className={cn(BOARD_MONO_CLASS, 'text-[11px] text-[var(--board-text-muted)]')}>
          {translate('board.usage.resetsLine', 'Resets {{time}}', {
            time: rateWindow.resetDescription
          })}
        </p>
      ) : null}
    </div>
  )
}

function ProviderLimitsBlock({
  provider
}: {
  provider: ProviderRateLimits
}): React.JSX.Element | null {
  const label = PROVIDER_LABELS[provider.provider]

  if (provider.status === 'error' || provider.status === 'unavailable') {
    return (
      <div className="space-y-1 rounded-md border border-[var(--board-panel-border)] p-2.5">
        <p className="text-[12px] font-medium text-[var(--board-text)]">{label}</p>
        <p className="text-[11px] text-[var(--board-text-muted)]">
          {provider.error ??
            translate('board.usagePanel.unavailable', 'Usage data is unavailable.')}
        </p>
      </div>
    )
  }

  if (provider.status !== 'ok' || (!provider.session && !provider.weekly)) {
    return null
  }

  return (
    <div className="space-y-3 border-b border-[var(--board-panel-border)] pb-3 last:border-b-0">
      <p className="text-[11px] font-semibold tracking-[0.12em] text-[var(--board-text-muted)] uppercase">
        {label}
      </p>
      {provider.session ? (
        <RateLimitBar
          rateWindow={provider.session}
          label={translate('board.usagePanel.session', '5h session')}
        />
      ) : null}
      {provider.weekly ? (
        <RateLimitBar
          rateWindow={provider.weekly}
          label={translate('board.usagePanel.weekly', 'Weekly')}
        />
      ) : null}
    </div>
  )
}

function LimitsTabContent(): React.JSX.Element {
  const rateLimits = useAppStore((s) => s.rateLimits)
  const byProvider: Record<ProviderRateLimits['provider'], ProviderRateLimits | null> = {
    claude: rateLimits.claude,
    codex: rateLimits.codex,
    gemini: rateLimits.gemini,
    'opencode-go': rateLimits.opencodeGo,
    kimi: rateLimits.kimi,
    minimax: rateLimits.minimax
  }
  const providers = PROVIDER_ORDER.map((p) => byProvider[p]).filter(
    (p): p is ProviderRateLimits => p !== null
  )

  return (
    <div className="space-y-3 pt-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--board-text-muted)]">
          {translate('board.usagePanel.limitsHeading', 'Rate limits')}
        </p>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={translate('board.usagePanel.refresh', 'Refresh')}
          onClick={() => {
            void useAppStore.getState().refreshRateLimits()
          }}
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </div>
      {providers.length === 0 ? (
        <p className="text-[12px] text-[var(--board-text-muted)]">
          {translate('board.usagePanel.noProviders', 'No usage data yet.')}
        </p>
      ) : (
        <div className="space-y-2">
          {providers.map((provider) => (
            <ProviderLimitsBlock key={provider.provider} provider={provider} />
          ))}
        </div>
      )}
      <p className="text-[11px] text-[var(--board-text-muted)]">
        {translate(
          'board.usagePanel.caveat',
          'Limits come from the provider and may lag your actual usage.'
        )}
      </p>
    </div>
  )
}

export function BoardUsagePanel({
  open,
  onOpenChange,
  anchor
}: BoardUsagePanelProps): React.JSX.Element {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{anchor}</PopoverTrigger>
      <PopoverContent
        data-surface="board"
        align="end"
        sideOffset={8}
        className={cn(BOARD_MENU_CONTENT_CLASS, 'w-[350px] rounded-[20px] p-4')}
      >
        <Tabs defaultValue="limits">
          <TabsList className="w-full">
            <TabsTrigger value="limits" className="flex-1">
              {translate('board.usagePanel.limitsTab', 'Limits')}
            </TabsTrigger>
            <TabsTrigger value="tokens" className="flex-1">
              {translate('board.usagePanel.tokensTab', 'Tokens')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="limits">
            <LimitsTabContent />
          </TabsContent>
          <TabsContent value="tokens">
            <ScrollArea className="max-h-[420px] pt-3">
              <Suspense
                fallback={
                  <p className="p-2 text-[12px] text-[var(--board-text-muted)]">
                    {translate('board.usagePanel.loadingTokens', 'Loading token usage...')}
                  </p>
                }
              >
                <UsageOverviewPane />
              </Suspense>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  )
}
