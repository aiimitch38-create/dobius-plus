// Names a console driver's cursor / claim chip after its card title ("Claude 1")
// instead of the id main derives ("Console-abcd1234"). Renderer-only label: the
// agent's id, policy and gates are untouched.
import { useAppStore } from '@/store'
import { setAgentDisplayResolver } from '../agent-presence/agent-presence-state'
import { consoleDriverName, consoleForDriverAgentId, isConsoleDriverAgentId } from './browser-link'

/** Resolves a console driver agent id to its card title across every board; null when not one. */
export function resolveConsoleDriverName(
  boards: Record<string, { cards: Parameters<typeof consoleForDriverAgentId>[0] }>,
  agentId: string
): string | null {
  if (!isConsoleDriverAgentId(agentId)) {
    return null
  }
  for (const board of Object.values(boards)) {
    const driver = consoleForDriverAgentId(board.cards, agentId)
    if (driver) {
      return consoleDriverName(driver.title, agentId)
    }
  }
  return null
}

export function installConsoleDriverNames(): () => void {
  return setAgentDisplayResolver((agentId) =>
    resolveConsoleDriverName(useAppStore.getState().boardsByWorktree, agentId)
  )
}
