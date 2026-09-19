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

  it('reads the zone, validates, writes, then re-reads', async () => {
    const before = queueResponse(200, '[]')
    const validate = queueResponse(200, '{"message":"Request accepted"}')
    const put = queueResponse(200, '{"message":"Request accepted"}')
    const after = queueResponse(200, '[{"name":"vigbets","type":"A","ttl":300,"records":[{"content":"45.82.75.172"}]}]')
    const { upsertHostingerDnsRecord } = await import('./hostinger-client')
    const records = await upsertHostingerDnsRecord({ domain: 'vertexio.online', name: 'vigbets', type: 'A', content: '45.82.75.172', ttl: 300 })
    expect(before.options).toMatchObject({ method: 'GET', path: '/api/dns/v1/zones/vertexio.online' })
    expect(validate.options).toMatchObject({ method: 'POST', path: '/api/dns/v1/zones/vertexio.online/validate' })
    expect(put.options).toMatchObject({ method: 'PUT', path: '/api/dns/v1/zones/vertexio.online' })
    expect(JSON.parse(String(put.request.write.mock.calls[0][0]))).toEqual({
      overwrite: true,
      zone: [{ name: 'vigbets', type: 'A', ttl: 300, records: [{ content: '45.82.75.172' }] }]
    })
    expect(after.options).toMatchObject({ method: 'GET', path: '/api/dns/v1/zones/vertexio.online' })
    expect(records).toEqual([{ name: 'vigbets', type: 'A', ttl: 300, values: ['45.82.75.172'] }])
  })

  it('keeps existing values for the same name+type unless replace is set', async () => {
    queueResponse(200, '[{"name":"@","type":"TXT","ttl":3600,"records":[{"content":"v=spf1 include:_spf.mail.hostinger.com ~all"}]}]')
    queueResponse(200, '{"message":"Request accepted"}')
    const put = queueResponse(200, '{"message":"Request accepted"}')
    queueResponse(200, '[]')
    const { upsertHostingerDnsRecord } = await import('./hostinger-client')
    await upsertHostingerDnsRecord({ domain: 'vertexio.online', name: '@', type: 'TXT', content: 'google-site-verification=abc' })
    expect(JSON.parse(String(put.request.write.mock.calls[0][0])).zone[0].records).toEqual([
      { content: 'v=spf1 include:_spf.mail.hostinger.com ~all' },
      { content: 'google-site-verification=abc' }
    ])

    queueResponse(200, '[{"name":"@","type":"TXT","ttl":3600,"records":[{"content":"old"}]}]')
    queueResponse(200, '{"message":"Request accepted"}')
    const putReplace = queueResponse(200, '{"message":"Request accepted"}')
    queueResponse(200, '[]')
    await upsertHostingerDnsRecord({ domain: 'vertexio.online', name: '@', type: 'TXT', content: 'new', replace: true })
    expect(JSON.parse(String(putReplace.request.write.mock.calls[0][0])).zone[0].records).toEqual([{ content: 'new' }])
  })

  it('stops before PUT when validate rejects the record', async () => {
    queueResponse(200, '[]')
    queueResponse(422, '{"message":"The records.0.content field is invalid."}')
    const { upsertHostingerDnsRecord } = await import('./hostinger-client')
    await expect(
      upsertHostingerDnsRecord({ domain: 'vertexio.online', name: 'vigbets', type: 'A', content: 'not-an-ip' })
    ).rejects.toThrow('Hostinger HTTP 422: The records.0.content field is invalid.')
    expect(mocks.httpsRequest).toHaveBeenCalledTimes(2)   // GET zone + validate; no PUT
  })

  it('rejects a malformed IPC payload before any request', async () => {
    const { upsertHostingerDnsRecord, buildZoneUpdate } = await import('./hostinger-client')
    await expect(upsertHostingerDnsRecord({ domain: 'vertexio.online', name: 5, type: 'A', content: '1.2.3.4' } as never)).rejects.toThrow(/must be strings/)
    expect(() => buildZoneUpdate({ domain: 'vertexio.online', name: '@', type: 'A', content: '1.2.3.4', ttl: '300' as never })).toThrow(/TTL must be a number/)
    expect(buildZoneUpdate({ domain: 'vertexio.online', name: '@', type: 'A', content: '1.2.3.4', ttl: 10 ** 9 }).body.zone[0].ttl).toBe(7 * 24 * 3600)
    expect(mocks.httpsRequest).not.toHaveBeenCalled()
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
