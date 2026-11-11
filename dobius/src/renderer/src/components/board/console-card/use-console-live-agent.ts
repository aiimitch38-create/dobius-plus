import { useAppStore } from '@/store'
import { resolveFocusedTabAgent } from '@/lib/tab-agent'
import type { TuiAgent } from '../../../../../shared/types'
import { isTerminalLeafId, makePaneKey } from '../../../../../shared/stable-pane-id'
import { resolveConsoleLeafId } from './console-card-status'

/**
 * The agent actually running in a console's pane right now, when known -- as
 * opposed to `card.agentKind`, which is only what the card was last launched
 * or relaunched with. A pane reused inside the same terminal (e.g. launching
 * `claude` by hand inside a Hermes-launched pane) changes this without ever
 * touching `card.agentKind`. Same two ground-truth signals `useTabAgent` uses
 * for the Classic tab-bar icon, ranked the same way: hook status first (the
 * sidebar's own live state), then the OSC-133-detected foreground process.
 */
export function useConsoleLiveAgent(tabId: string): TuiAgent | null {
  const hookAgent = useAppStore((s) =>
    resolveFocusedTabAgent(s.agentStatusByPaneKey, s.terminalLayoutsByTabId[tabId], tabId)
  )
  const processAgent = useAppStore((s) => {
    const leafId = resolveConsoleLeafId(s.terminalLayoutsByTabId[tabId])
    if (!leafId || !isTerminalLeafId(leafId)) {
      return null
    }
    return s.paneForegroundAgentByPaneKey[makePaneKey(tabId, leafId)]?.agent ?? null
  })
  return hookAgent ?? processAgent
}
