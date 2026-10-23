import { LayaHttpDecisionProvider } from './laya-http-provider'
import {
  deploymentReceipt,
  health,
  jsonResponse,
  systemOneResponse
} from './laya-http-provider.fixtures'

export function providerHarness(
  overrides: {
    fetch?: typeof fetch
    receipt?: () => unknown | Promise<unknown>
    authorization?: () => Promise<string | null>
    epoch?: () => unknown
    deadlineMs?: number
  } = {}
) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl: typeof fetch = async (input, init: RequestInit = {}) => {
    const call = { url: String(input), init }
    calls.push(call)
    if (overrides.fetch) {
      return overrides.fetch(input, init)
    }
    if (new URL(call.url).pathname === '/health') {
      return jsonResponse(health())
    }
    const body = JSON.parse(String(init.body)) as {
      questions: Record<string, { criteria: string[] }>
    }
    return jsonResponse(systemOneResponse(body.questions.dobius_decision!.criteria))
  }
  const provider = new LayaHttpDecisionProvider({
    readDeploymentReceipt: async () =>
      overrides.receipt ? overrides.receipt() : deploymentReceipt(),
    resolveAuthorization: overrides.authorization ?? (async () => 'synthetic-key'),
    readEpoch: overrides.epoch ?? (() => 4),
    fetch: fetchImpl,
    now: () => 2_000,
    monotonicNow: (() => {
      let value = 100
      return () => (value += 2)
    })(),
    deadlineMs: overrides.deadlineMs
  })
  return { provider, calls }
}
