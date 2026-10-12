import { describe, expect, it, vi } from 'vitest'
import { constantTimeEqual } from '../lib/constant-time-equal'
import type * as ConstantTimeEqualModule from '../lib/constant-time-equal'
import { AgentHookServer } from './server'

vi.mock('../lib/constant-time-equal', async (importOriginal) => {
  const actual = await importOriginal<typeof ConstantTimeEqualModule>()
  return { constantTimeEqual: vi.fn(actual.constantTimeEqual) }
})
vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({
  getCohortAtEmit: vi.fn(() => ({ nth_repo_added: 2 }))
}))

// Why: #22 — the hook token check must not short-circuit on the first
// differing byte, and must not throw on a malformed header.
describe('AgentHookServer token check (#22)', () => {
  it('checks the hook token in constant time and rejects bad lengths', async () => {
    const server = new AgentHookServer()
    await server.start({ env: 'production' })
    try {
      const env = server.buildPtyEnv()
      const post = (token: string): Promise<Response> =>
        fetch(`http://127.0.0.1:${env.DOBIUS_AGENT_HOOK_PORT}/hook/claude`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Dobius-Agent-Hook-Token': token },
          body: '{}'
        })
      vi.mocked(constantTimeEqual).mockClear()

      expect((await post('x')).status).toBe(403)
      expect((await post(`${env.DOBIUS_AGENT_HOOK_TOKEN}x`)).status).toBe(403)
      expect(constantTimeEqual).toHaveBeenCalledWith('x', env.DOBIUS_AGENT_HOOK_TOKEN)
      expect(constantTimeEqual).toHaveBeenCalledTimes(2)
    } finally {
      server.stop()
    }
  })
})
