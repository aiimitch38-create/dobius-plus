import type { AgentProviderStatusSnapshot } from '../../../shared/agents'
import { listCustomHarnesses } from '../agents/custom-harness-store'
import { CustomHarnessProvider } from './custom-harness-provider'

// Live provider instances keyed by harness id so IPC status/stop hit the same
// spawned process the launch call created.
const instances = new Map<string, CustomHarnessProvider>()

export function getCustomHarnessProvider(id: string): CustomHarnessProvider | null {
  const existing = instances.get(id)
  if (existing) {
    return existing
  }
  const definition = listCustomHarnesses().find((harness) => harness.id === id)
  if (!definition) {
    return null
  }
  const provider = new CustomHarnessProvider(definition)
  instances.set(id, provider)
  return provider
}

export function listCustomHarnessStatuses(): AgentProviderStatusSnapshot[] {
  for (const definition of listCustomHarnesses()) {
    if (!instances.has(definition.id)) {
      instances.set(definition.id, new CustomHarnessProvider(definition))
    }
  }
  return [...instances.values()].map((provider) => provider.status())
}

export function stopCustomHarness(id: string): void {
  void instances.get(id)?.cancel()
}
