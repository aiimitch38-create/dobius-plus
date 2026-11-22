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

const HIDDEN_ERROR = 'Could not read this (details are on the Usage page in the app).'
const SAFE_ERROR_TEXT = /^[A-Za-z0-9 .,:;()'/_-]{1,200}$/
const SECRET_SHAPED = /[A-Za-z0-9_-]{24,}|bearer|sk-|token|key=|secret|password/i

/**
 * An error message fit for the command line, or a fixed one. Why: provider
 * errors are free text (SDK, CLI, JSON.parse of credential files) and can
 * quote a credential, so only short plain wording passes.
 */
export function publicErrorText(error: string | null | undefined): string | null {
  if (!error) {
    return null
  }
  return SAFE_ERROR_TEXT.test(error) && !SECRET_SHAPED.test(error) ? error : HIDDEN_ERROR
}

/**
 * `fresh` scans the local session logs again when they are stale (the
 * Usage page does the same). Without it the last scan is used as-is; the
 * agent key never rescans.
 */
export async function usageSummaryForRuntime(
  provider: UsageProvider,
  scope: UsageScope,
  range: UsageRange,
  fresh = true
): Promise<{ provider: UsageProvider; scan: unknown; summary: unknown }> {
  const store = usageStores[provider]
  if (!store) {
    throw new Error(`Usage for ${provider} is not ready yet. Open the Dobius+ window and try again.`)
  }
  const summary = fresh
    ? await store.getSummary(scope, range)
    : store.getSnapshot(scope, range, 0).summary
  const scan = store.getScanState()
  return {
    provider,
    scan: { ...scan, lastScanError: publicErrorText(scan.lastScanError) },
    summary
  }
}

// Why stripped: cliOutput is the raw text of a hidden `/usage` CLI screen,
// which can carry account details; callers only need the numbers. Errors are
// free text too, so they pass through publicErrorText.
function withoutCliOutput(limits: ProviderRateLimits | null): ProviderRateLimits | null {
  if (!limits) {
    return null
  }
  const { cliOutput: _cliOutput, ...rest } = limits
  return { ...rest, error: publicErrorText(rest.error) }
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
