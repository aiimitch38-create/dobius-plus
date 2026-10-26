import { useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import type { HeatmapPoint } from './board-usage-heatmap'
import { usageHistoryProvider, type UsageProviderId } from './board-usage-model'

type HeatmapData = { points: HeatmapPoint[]; loaded: boolean }

const EMPTY: HeatmapData = { points: [], loaded: true }

/**
 * Daily token totals for the selected provider from the local usage history
 * (same IPC the Stats tab uses), fetched once per provider while the panel is
 * open. Providers without a history keep an empty grid.
 */
export function useUsageHeatmapData(
  provider: UsageProviderId,
  options: { enabled: boolean; refreshToken: number }
): HeatmapData {
  const history = usageHistoryProvider(provider)
  const [data, setData] = useState<Record<string, HeatmapData>>({})
  const key = history ? `${history}:${options.refreshToken}` : null

  useEffect(() => {
    if (!options.enabled || !history || !key || data[key]) {
      return
    }
    let cancelled = false
    const { claudeUsageScope, codexUsageScope, openCodeUsageScope } = useAppStore.getState()
    const load = async (): Promise<HeatmapPoint[]> => {
      if (history === 'claude') {
        const daily = await window.api.claudeUsage.getDaily({
          scope: claudeUsageScope,
          range: 'all'
        })
        return daily.map((d) => ({
          day: d.day,
          total: d.inputTokens + d.outputTokens + d.cacheReadTokens + d.cacheWriteTokens
        }))
      }
      if (history === 'codex') {
        const daily = await window.api.codexUsage.getDaily({ scope: codexUsageScope, range: 'all' })
        return daily.map((d) => ({ day: d.day, total: d.totalTokens }))
      }
      const daily = await window.api.openCodeUsage.getDaily({
        scope: openCodeUsageScope,
        range: 'all'
      })
      return daily.map((d) => ({ day: d.day, total: d.totalTokens }))
    }
    void load()
      .then((points) => {
        if (!cancelled) {
          setData((prev) => ({ ...prev, [key]: { points, loaded: true } }))
        }
      })
      .catch((error: unknown) => {
        console.warn('[board-usage] activity history unavailable', error)
        if (!cancelled) {
          setData((prev) => ({ ...prev, [key]: EMPTY }))
        }
      })
    return () => {
      cancelled = true
    }
  }, [data, history, key, options.enabled])

  if (!key) {
    return EMPTY
  }
  return data[key] ?? { points: [], loaded: false }
}
