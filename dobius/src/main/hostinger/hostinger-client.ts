import https from 'node:https'
import type {
  HostingerDnsRecord,
  HostingerDnsRecordInput,
  HostingerDomain,
  HostingerStatus,
  HostingerVps
} from '../../shared/hostinger'
import {
  HOSTINGER_DEFAULT_TTL,
  HOSTINGER_DOMAIN_RE,
  HOSTINGER_MAX_NAME_LENGTH,
  HOSTINGER_MAX_TTL,
  isHostingerDnsType
} from '../../shared/hostinger'
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
const DEFAULT_TTL = HOSTINGER_DEFAULT_TTL

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null
}

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
function describeHttpError(code: number, raw: string): string {
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
  return raw.filter(isObject).map((v) => {
    const template = isObject(v.template) ? v.template : undefined
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
  return raw.filter(isObject).map((d) => {
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
  return raw.filter(isObject).map((r) => {
    const values = Array.isArray(r.records)
      ? r.records.filter(isObject).map((x) => String(x.content ?? '')).filter(Boolean)
      : []
    return {
      name: String(r.name ?? '@'),
      type: String(r.type ?? ''),
      ttl: asNumberOrNull(r.ttl) ?? DEFAULT_TTL,
      values
    }
  })
}

function assertDomain(domain: unknown): string {
  if (typeof domain !== 'string') {
    throw new Error('Domain must be a string')
  }
  const trimmed = domain.trim().toLowerCase()
  if (!HOSTINGER_DOMAIN_RE.test(trimmed)) {
    throw new Error(`"${domain}" is not a valid domain name`)
  }
  return trimmed
}

type ZoneUpdateBody = {
  overwrite: boolean
  zone: { name: string; type: string; ttl: number; records: { content: string }[] }[]
}

// Runtime shape check on the IPC payload (repo convention: never trust renderer args),
// then the field rules. Throws a plain validation Error, never a TypeError.
export function buildZoneUpdate(
  input: HostingerDnsRecordInput,
  existingValues: string[] = []
): { domain: string; body: ZoneUpdateBody } {
  if (!isObject(input)) {
    throw new Error('DNS record input is required')
  }
  const { domain, name, type, content, ttl, replace } = input as Record<string, unknown>
  if (typeof domain !== 'string' || typeof name !== 'string' || typeof type !== 'string' || typeof content !== 'string') {
    throw new Error('DNS record fields must be strings')
  }
  if (ttl !== undefined && typeof ttl !== 'number') {
    throw new Error('DNS record TTL must be a number')
  }
  const safeDomain = assertDomain(domain)
  if (!isHostingerDnsType(type)) {
    throw new Error(`Unsupported DNS record type "${type}"`)
  }
  const value = content.trim()
  if (!value) {
    throw new Error('DNS record value is required')
  }
  const safeName = name.trim() || '@'
  if (/\s/.test(safeName) || safeName.length > HOSTINGER_MAX_NAME_LENGTH) {
    throw new Error('DNS record name cannot contain spaces or exceed 253 characters')
  }
  const safeTtl =
    ttl !== undefined && Number.isFinite(ttl) && ttl > 0
      ? Math.min(Math.floor(ttl), HOSTINGER_MAX_TTL)
      : DEFAULT_TTL
  // Default is ADD: keep the zone's existing values for this name+type and append ours,
  // so a second TXT at @ or a round-robin A is never silently wiped. `replace: true` is the
  // explicit, confirmed path. Either way the PUT uses overwrite so the result is exactly
  // the list we send.
  const kept = replace === true ? [] : existingValues.filter((v) => v !== value)
  const records = [...kept, value].map((c) => ({ content: c }))
  return {
    domain: safeDomain,
    body: { overwrite: true, zone: [{ name: safeName, type, ttl: safeTtl, records }] }
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

// The single write: read the zone (so existing values for this name+type are kept
// unless `replace`), validate, PUT, then re-read so the caller sees server truth.
// Validate runs before PUT so a bad record fails before anything changes.
export async function upsertHostingerDnsRecord(input: HostingerDnsRecordInput): Promise<HostingerDnsRecord[]> {
  const probe = buildZoneUpdate(input)            // shape/field validation before any request
  const current = await listHostingerDns(probe.domain)
  const target = probe.body.zone[0]
  const existing = current.find((r) => r.name === target.name && r.type === target.type)?.values ?? []
  const { domain, body } = buildZoneUpdate(input, existing)
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
