import { describe, expect, it, vi } from 'vitest'
import {
  publicErrorText,
  publicRateLimitState,
  setUsageStoreForRuntime,
  usageSummaryForRuntime
} from './usage-access'
import type { RateLimitState } from '../../shared/rate-limit-types'

describe('usage access for the runtime RPC', () => {
  it('keeps plain errors and hides ones that could quote a credential', () => {
    expect(publicErrorText('No credentials')).toBe('No credentials')
    expect(publicErrorText(null)).toBeNull()
    for (const leaked of [
      'Unexpected token \'e\', "eyJhbGciOi"... is not valid JSON',
      'Request failed: Bearer abc',
      'auth failed for sk-ant-api03-xyz',
      'bad access_token value AAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    ]) {
      expect(publicErrorText(leaked)).toContain('details are on the Usage page')
    }
  })

  it('sanitizes every provider error at the public boundary', () => {
    const limits = (error: string) => ({
      provider: 'kimi' as const,
      session: null,
      weekly: null,
      updatedAt: 0,
      error,
      status: 'error' as const,
      cliOutput: 'raw'
    })
    const state = publicRateLimitState({
      claude: null,
      codex: null,
      gemini: null,
      opencodeGo: null,
      kimi: limits('Unexpected token "secret-json"'),
      minimax: null,
      inactiveClaudeAccounts: [{ accountId: 'a', rateLimits: limits('{"token":"t"}') }],
      inactiveCodexAccounts: []
    } as unknown as RateLimitState)
    const text = JSON.stringify(state)
    expect(text).not.toContain('secret-json')
    expect(text).not.toContain('"t"')
    expect(text).not.toContain('raw')
  })

  it('reads the last scan without rescanning when not fresh', async () => {
    const store = {
      getSummary: vi.fn(async () => ({ turns: 1 })),
      getSnapshot: vi.fn(() => ({ summary: { turns: 2 } })),
      getScanState: () => ({ lastScanError: 'EACCES token=abc' })
    }
    setUsageStoreForRuntime('codex', store as never)
    expect(await usageSummaryForRuntime('codex', 'all', '7d', false)).toMatchObject({
      summary: { turns: 2 },
      scan: { lastScanError: expect.stringContaining('details are on the Usage page') }
    })
    expect(store.getSummary).not.toHaveBeenCalled()
    expect(await usageSummaryForRuntime('codex', 'all', '7d')).toMatchObject({ summary: { turns: 1 } })
  })
})
