import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { constantTimeEqual } from '../lib/constant-time-equal'
import type * as ConstantTimeEqualModule from '../lib/constant-time-equal'
import { DeviceRegistry } from './device-registry'
import { DobiusRuntimeService } from './dobius-runtime'
import { DobiusRuntimeRpcServer } from './runtime-rpc'

vi.mock('../lib/constant-time-equal', async (importOriginal) => {
  const actual = await importOriginal<typeof ConstantTimeEqualModule>()
  return { constantTimeEqual: vi.fn(actual.constantTimeEqual) }
})

type ParseAndAuth = (raw: string) => { error?: { ok: boolean; error?: { code: string } } }

// Why: #22 — the CLI socket token and device tokens are compared in constant time.
describe('runtime RPC auth token checks (#22)', () => {
  it('rejects wrong and wrong-length tokens through constantTimeEqual', () => {
    const server = new DobiusRuntimeRpcServer({
      runtime: new DobiusRuntimeService(),
      userDataPath: mkdtempSync(join(tmpdir(), 'dobius-token-compare-'))
    })
    const parseAndAuth = (server as unknown as { parseAndAuth: ParseAndAuth }).parseAndAuth.bind(
      server
    )
    const authToken = (server as unknown as { authToken: string }).authToken
    vi.mocked(constantTimeEqual).mockClear()

    const lastCharFlipped = `${authToken.slice(0, -1)}${authToken.endsWith('0') ? '1' : '0'}`
    for (const guess of ['a', `${authToken}a`, lastCharFlipped]) {
      const result = parseAndAuth(
        JSON.stringify({ id: '1', method: 'status.get', authToken: guess })
      )
      expect(result.error?.error?.code).toBe('unauthorized')
    }
    expect(constantTimeEqual).toHaveBeenCalledWith('a', authToken)
    expect(constantTimeEqual).toHaveBeenCalledTimes(3)

    const ok = parseAndAuth(JSON.stringify({ id: '2', method: 'status.get', authToken }))
    expect(ok.error).toBeUndefined()
  })

  it('checks device tokens through constantTimeEqual', () => {
    const registry = new DeviceRegistry(mkdtempSync(join(tmpdir(), 'dobius-token-compare-')))
    const device = registry.addDevice('Phone', 'mobile')
    vi.mocked(constantTimeEqual).mockClear()

    expect(registry.validateToken('short')).toBeNull()
    expect(constantTimeEqual).toHaveBeenCalledWith('short', device.token)
    expect(registry.validateToken(device.token)?.deviceId).toBe(device.deviceId)
  })
})
