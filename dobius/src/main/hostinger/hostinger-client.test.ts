import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  httpsRequest: vi.fn(),
  getHostingerToken: vi.fn(() => 'hostinger-token'),
  hasHostingerToken: vi.fn(() => true)
}))

vi.mock('node:https', () => ({
  default: { request: mocks.httpsRequest },
  request: mocks.httpsRequest
}))

vi.mock('./hostinger-token-store', () => ({
  getHostingerToken: mocks.getHostingerToken,
  hasHostingerToken: mocks.hasHostingerToken
}))

class FakeRequest extends EventEmitter {
  destroy = vi.fn()
  end = vi.fn()
  write = vi.fn()
}

class FakeResponse extends EventEmitter {
  constructor(public statusCode = 200) {
    super()
  }
}

type Call = { options: Record<string, unknown>; request: FakeRequest }

function queueResponse(statusCode: number, body: string): Call {
  const request = new FakeRequest()
  const call: Call = { options: {}, request }
  mocks.httpsRequest.mockImplementationOnce((options, callback) => {
    call.options = options as Record<string, unknown>
    const response = new FakeResponse(statusCode)
    callback(response)
    queueMicrotask(() => {
      response.emit('data', Buffer.from(body))
      response.emit('end')
    })
    return request
  })
  return call
}

beforeEach(() => {
  vi.resetModules()
  mocks.httpsRequest.mockReset()
  mocks.getHostingerToken.mockReset().mockReturnValue('hostinger-token')
  mocks.hasHostingerToken.mockReset().mockReturnValue(true)
})

describe('hostinger-client parsing', () => {
  it('maps the live VPS payload shape', async () => {
    const { parseVps } = await import('./hostinger-client')
    const [vps] = parseVps([
      {
        id: 1955486,
        hostname: 'srv1955486.hstgr.cloud',
        plan: 'KVM 2',
        state: 'running',
        ipv4: [{ address: '45.82.75.172' }],
        ipv6: [],
        template: { name: 'Ubuntu 24.04 LTS' },
        cpus: 2,
        memory: 8192,
        disk: 102400,
        created_at: '2026-09-04T12:09:00Z'
      }
    ])
    expect(vps).toEqual({
      id: 1955486,
      hostname: 'srv1955486.hstgr.cloud',
      plan: 'KVM 2',
      state: 'running',
      ipv4: '45.82.75.172',
      ipv6: null,
      template: 'Ubuntu 24.04 LTS',
      cpus: 2,
      memoryMb: 8192,
      diskMb: 102400,
      createdAt: '2026-09-04T12:09:00Z'
    })
  })

  it('maps domains and tolerates a null expiry', async () => {
    const { parseDomains } = await import('./hostinger-client')
    expect(
      parseDomains([{ domain: 'vertexio.online', type: 'free_domain', status: 'active', expires_at: null }])
    ).toEqual([{ domain: 'vertexio.online', type: 'free_domain', status: 'active', expiresAt: null }])
  })

  it('flattens zone records into values', async () => {
    const { parseZone } = await import('./hostinger-client')
    expect(
      parseZone([{ name: '@', type: 'MX', ttl: 14400, records: [{ content: '10 mx2.hostinger.com.' }, { content: '5 mx1.hostinger.com.' }] }])
    ).toEqual([{ name: '@', type: 'MX', ttl: 14400, values: ['10 mx2.hostinger.com.', '5 mx1.hostinger.com.'] }])
  })
})

describe('buildZoneUpdate', () => {
  it('builds the documented PUT body with overwrite', async () => {
    const { buildZoneUpdate } = await import('./hostinger-client')
    expect(buildZoneUpdate({ domain: 'Vertexio.Online', name: 'vigbets', type: 'A', content: '45.82.75.172', ttl: 300 })).toEqual({
      domain: 'vertexio.online',
      body: { overwrite: true, zone: [{ name: 'vigbets', type: 'A', ttl: 300, records: [{ content: '45.82.75.172' }] }] }
    })
  })

  it('defaults name to @ and ttl to 3600', async () => {
    const { buildZoneUpdate } = await import('./hostinger-client')
    const { body } = buildZoneUpdate({ domain: 'vertexio.online', name: '  ', type: 'TXT', content: 'v=spf1 -all' })
    expect(body.zone[0]).toMatchObject({ name: '@', ttl: 3600 })
  })

  it('refuses an invalid domain, type, or empty value', async () => {
    const { buildZoneUpdate } = await import('./hostinger-client')
    expect(() => buildZoneUpdate({ domain: 'not a domain', name: '@', type: 'A', content: '1.2.3.4' })).toThrow(/valid domain/)
    expect(() => buildZoneUpdate({ domain: 'vertexio.online', name: '@', type: 'MX' as never, content: 'x' })).toThrow(/Unsupported/)
    expect(() => buildZoneUpdate({ domain: 'vertexio.online', name: '@', type: 'A', content: '  ' })).toThrow(/required/)
  })
})

describe('requests', () => {
  it('sends the bearer token to developers.hostinger.com', async () => {
    const call = queueResponse(200, '[]')
    const { listHostingerVps } = await import('./hostinger-client')
    await expect(listHostingerVps()).resolves.toEqual([])
    expect(call.options).toMatchObject({
      hostname: 'developers.hostinger.com',
      path: '/api/vps/v1/virtual-machines',
      method: 'GET',
      headers: { Authorization: 'Bearer hostinger-token' }
    })
  })

  it('surfaces the API message on 401', async () => {
    queueResponse(401, '{"message":"Unauthenticated."}')
    const { listHostingerDomains } = await import('./hostinger-client')
    await expect(listHostingerDomains()).rejects.toThrow('Hostinger rejected the token: Unauthenticated.')
  })

  it('validates, then writes, then re-reads the zone', async () => {
    const validate = queueResponse(200, '{"message":"Request accepted"}')
    const put = queueResponse(200, '{"message":"Request accepted"}')
    const get = queueResponse(200, '[{"name":"vigbets","type":"A","ttl":300,"records":[{"content":"45.82.75.172"}]}]')
    const { upsertHostingerDnsRecord } = await import('./hostinger-client')
    const records = await upsertHostingerDnsRecord({ domain: 'vertexio.online', name: 'vigbets', type: 'A', content: '45.82.75.172', ttl: 300 })
    expect(validate.options).toMatchObject({ method: 'POST', path: '/api/dns/v1/zones/vertexio.online/validate' })
    expect(put.options).toMatchObject({ method: 'PUT', path: '/api/dns/v1/zones/vertexio.online' })
    expect(JSON.parse(String(put.request.write.mock.calls[0][0]))).toEqual({
      overwrite: true,
      zone: [{ name: 'vigbets', type: 'A', ttl: 300, records: [{ content: '45.82.75.172' }] }]
    })
    expect(get.options).toMatchObject({ method: 'GET', path: '/api/dns/v1/zones/vertexio.online' })
    expect(records).toEqual([{ name: 'vigbets', type: 'A', ttl: 300, values: ['45.82.75.172'] }])
  })

  it('reports a status without throwing when the token is rejected', async () => {
    queueResponse(401, '{"message":"Unauthenticated."}')
    queueResponse(401, '{"message":"Unauthenticated."}')
    const { getHostingerStatus } = await import('./hostinger-client')
    const status = await getHostingerStatus()
    expect(status).toMatchObject({ hasToken: true, ok: false })
    expect(status.error).toContain('Unauthenticated')
  })

  it('reports no token without any request', async () => {
    mocks.hasHostingerToken.mockReturnValue(false)
    const { getHostingerStatus } = await import('./hostinger-client')
    await expect(getHostingerStatus()).resolves.toMatchObject({ hasToken: false, ok: false, error: null })
    expect(mocks.httpsRequest).not.toHaveBeenCalled()
  })
})
