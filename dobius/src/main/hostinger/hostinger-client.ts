import https from 'node:https'
import type {
  HostingerDnsRecord,
  HostingerDnsRecordInput,
  HostingerDomain,
  HostingerStatus,
  HostingerVps
} from '../../shared/hostinger'
import { HOSTINGER_DOMAIN_RE, isHostingerDnsType } from '../../shared/hostinger'
import { getHostingerToken, hasHostingerToken } from './hostinger-token-store'

// Wire facts from the official OpenAPI spec (developers.hostinger.com/openapi/openapi.json,
// read 2026-09-19) and verified live against Carson's account with curl the same day:
//   GET  /api/vps/v1/virtual-machines            -> VirtualMachineResource[]
//   GET  /api/domains/v1/portfolio               -> DomainResource[]
//   GET  /api/dns/v1/zones/{domain}              -> RecordResource[] {name,type,ttl,records:[{content}]}
//   POST /api/dns/v1/zones/{domain}/validate     -> {message}   body: same as PUT
//   PUT  /api/dns/v1/zones/{domain}              -> {message}   body: {overwrite, zone:[...]}
// `overwrite: true` replaces the RRs matching name+type; false appends to them.
const HOSTINGER_HOST = 'developers.hostinger.com'
const TIMEOUT_MS = 15_000
const DEFAULT_TTL = 3600

type Json = Record<string, unknown>

function hostingerRequest<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
  const token = getHostingerToken() // main-process only; throws if not configured
  const payload = body === undefined ? undefined : JSON.stringify(body)
  return new Promise<T>((resolve, reject) => {
    const req = https.request(
      {
        hostname: HOSTINGER_HOST,
        path,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(payload !== undefined
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {})
        },
        timeout: TIMEOUT_MS
      },
      (res) => {
        let raw = ''
        res.on('data', (chunk) => {
          raw += chunk
        })
        res.on('end', () => {
          const code = res.statusCode ?? 0
          if (code < 200 || code >= 300) {
            reject(new Error(describeHttpError(code, raw)))
            return
          }
          try {
            resolve(raw ? (JSON.parse(raw) as T) : ({} as T))
          } catch {
            reject(new Error('Hostinger returned invalid JSON'))
          }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('Hostinger request timed out')))
    if (payload !== undefined) {
      req.write(payload)
    }
    req.end()
  })
}

// Hostinger error bodies are {message, error_code?}; surface the message, not the JSON.
export function describeHttpError(code: number, raw: string): string {
  try {
    const parsed = JSON.parse(raw) as Json
    const message = typeof parsed.message === 'string' ? parsed.message : ''
    if (message) {
      return code === 401 ? `Hostinger rejected the token: ${message}` : `Hostinger HTTP ${code}: ${message}`
    }
  } catch {
    // not JSON; fall through to the raw slice
  }
  return `Hostinger HTTP ${code}: ${raw.slice(0, 200)}`
}

function firstAddress(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null
  }
  const first = value[0] as Json
  return typeof first?.address === 'string' ? first.address : null
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function parseVps(raw: unknown): HostingerVps[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.map((item) => {
    const v = item as Json
    const template = v.template as Json | undefined
    return {
      id: asNumberOrNull(v.id) ?? (Number.parseInt(String(v.id ?? ''), 10) || 0),
      hostname: String(v.hostname ?? ''),
      plan: String(v.plan ?? ''),
      state: String(v.state ?? ''),
      ipv4: firstAddress(v.ipv4),
      ipv6: firstAddress(v.ipv6),
      template: typeof template?.name === 'string' ? template.name : null,
      cpus: asNumberOrNull(v.cpus),
      memoryMb: asNumberOrNull(v.memory),
      diskMb: asNumberOrNull(v.disk),
      createdAt: typeof v.created_at === 'string' ? v.created_at : null
    }
  })
}

export function parseDomains(raw: unknown): HostingerDomain[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.map((item) => {
    const d = item as Json
    return {
      domain: String(d.domain ?? ''),
      type: String(d.type ?? ''),
      status: String(d.status ?? ''),
      expiresAt: typeof d.expires_at === 'string' ? d.expires_at : null
    }
  })
}

export function parseZone(raw: unknown): HostingerDnsRecord[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.map((item) => {
    const r = item as Json
    const values = Array.isArray(r.records)
      ? r.records.map((x) => String((x as Json)?.content ?? '')).filter(Boolean)
      : []
    return {
      name: String(r.name ?? '@'),
      type: String(r.type ?? ''),
      ttl: asNumberOrNull(r.ttl) ?? DEFAULT_TTL,
      values
    }
  })
}

export function assertDomain(domain: string): string {
  const trimmed = domain.trim().toLowerCase()
  if (!HOSTINGER_DOMAIN_RE.test(trimmed)) {
    throw new Error(`"${domain}" is not a valid domain name`)
  }
  return trimmed
}

export function buildZoneUpdate(input: HostingerDnsRecordInput): {
  domain: string
  body: { overwrite: boolean; zone: { name: string; type: string; ttl: number; records: { content: string }[] }[] }
} {
  const domain = assertDomain(input.domain)
  if (!isHostingerDnsType(input.type)) {
    throw new Error(`Unsupported DNS record type "${String(input.type)}"`)
  }
  const content = input.content.trim()
  if (!content) {
    throw new Error('DNS record value is required')
  }
  const name = input.name.trim() || '@'
  if (/\s/.test(name)) {
    throw new Error('DNS record name cannot contain spaces')
  }
  const ttl = input.ttl && Number.isFinite(input.ttl) && input.ttl > 0 ? Math.floor(input.ttl) : DEFAULT_TTL
  return {
    domain,
    // overwrite: the pane promises "replaces existing values for the same name and type".
    body: { overwrite: true, zone: [{ name, type: input.type, ttl, records: [{ content }] }] }
  }
}

export async function listHostingerVps(): Promise<HostingerVps[]> {
  return parseVps(await hostingerRequest<unknown>('GET', '/api/vps/v1/virtual-machines'))
}

export async function listHostingerDomains(): Promise<HostingerDomain[]> {
  return parseDomains(await hostingerRequest<unknown>('GET', '/api/domains/v1/portfolio'))
}

export async function listHostingerDns(domain: string): Promise<HostingerDnsRecord[]> {
  const safe = assertDomain(domain)
  return parseZone(await hostingerRequest<unknown>('GET', `/api/dns/v1/zones/${encodeURIComponent(safe)}`))
}

// The single write. Validate first so a bad record fails before anything changes.
export async function upsertHostingerDnsRecord(input: HostingerDnsRecordInput): Promise<HostingerDnsRecord[]> {
  const { domain, body } = buildZoneUpdate(input)
  const zonePath = `/api/dns/v1/zones/${encodeURIComponent(domain)}`
  await hostingerRequest<unknown>('POST', `${zonePath}/validate`, body)
  await hostingerRequest<unknown>('PUT', zonePath, body)
  return listHostingerDns(domain)
}

export async function getHostingerStatus(): Promise<HostingerStatus> {
  const checkedAt = Date.now()
  if (!hasHostingerToken()) {
    return { hasToken: false, ok: false, error: null, vpsCount: 0, domainCount: 0, checkedAt }
  }
  try {
    const [vps, domains] = await Promise.all([listHostingerVps(), listHostingerDomains()])
    return { hasToken: true, ok: true, error: null, vpsCount: vps.length, domainCount: domains.length, checkedAt }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { hasToken: true, ok: false, error: message, vpsCount: 0, domainCount: 0, checkedAt }
  }
}
