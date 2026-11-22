// The usage stores and rate-limit service the window's `claudeUsage:*`,
// `codexUsage:*`, `openCodeUsage:*` and `rateLimits:*` IPC already use, handed
// to the runtime RPC (`dobius usage`, `dobius limits`) so both read the same
// live instances. Each IPC register function records its service here.
import type { ClaudeUsageStore } from '../claude-usage/store'
import type { CodexUsageStore } from '../codex-usage/store'
import type { OpenCodeUsageStore } from '../opencode-usage/store'
import type { RateLimitService } from '../rate-limits/service'
import type { ProviderRateLimits, RateLimitState } from '../../shared/rate-limit-types'

export type UsageProvider = 'claude' | 'codex' | 'opencode'
export type UsageScope = 'dobius' | 'all'
export type UsageRange = '7d' | '30d' | '90d' | 'all'

type UsageStore = ClaudeUsageStore | CodexUsageStore | OpenCodeUsageStore

const usageStores: Partial<Record<UsageProvider, UsageStore>> = {}
let rateLimitService: RateLimitService | null = null

export function setUsageStoreForRuntime(provider: UsageProvider, store: UsageStore): void {
  usageStores[provider] = store
}

export function setRateLimitServiceForRuntime(service: RateLimitService): void {
  rateLimitService = service
}

export async function usageSummaryForRuntime(
  provider: UsageProvider,
  scope: UsageScope,
  range: UsageRange
): Promise<{ provider: UsageProvider; scan: unknown; summary: unknown }> {
  const store = usageStores[provider]
  if (!store) {
    throw new Error(`Usage for ${provider} is not ready yet. Open the Dobius+ window and try again.`)
  }
  return {
    provider,
    scan: await store.getScanState(),
    summary: await store.getSummary(scope, range)
  }
}

// Why stripped: cliOutput is the raw text of a hidden `/usage` CLI screen,
// which can carry account details; callers only need the numbers.
function withoutCliOutput(limits: ProviderRateLimits | null): ProviderRateLimits | null {
  if (!limits) {
    return null
  }
  const { cliOutput: _cliOutput, ...rest } = limits
  return rest
}

export function publicRateLimitState(state: RateLimitState): RateLimitState {
  return {
    ...state,
    claude: withoutCliOutput(state.claude),
    codex: withoutCliOutput(state.codex),
    gemini: withoutCliOutput(state.gemini),
    opencodeGo: withoutCliOutput(state.opencodeGo),
    kimi: withoutCliOutput(state.kimi),
    minimax: withoutCliOutput(state.minimax),
    inactiveClaudeAccounts: state.inactiveClaudeAccounts.map((entry) => ({
      ...entry,
      rateLimits: withoutCliOutput(entry.rateLimits)
    })),
    inactiveCodexAccounts: state.inactiveCodexAccounts.map((entry) => ({
      ...entry,
      rateLimits: withoutCliOutput(entry.rateLimits)
    }))
  }
}

export async function rateLimitsForRuntime(refresh: boolean): Promise<RateLimitState> {
  if (!rateLimitService) {
    throw new Error('Rate limits are not ready yet. Open the Dobius+ window and try again.')
  }
  if (refresh) {
    await rateLimitService.refresh()
  }
  return publicRateLimitState(rateLimitService.getState())
}
