export type HostingerVps = {
  id: number
  hostname: string
  plan: string
  state: string
  ipv4: string | null
  ipv6: string | null
  template: string | null
  cpus: number | null
  memoryMb: number | null
  diskMb: number | null
  createdAt: string | null
}

export type HostingerDomain = {
  domain: string
  type: string
  status: string
  expiresAt: string | null
}

export type HostingerDnsRecord = {
  name: string
  type: string
  ttl: number
  values: string[]
}

export const HOSTINGER_DNS_TYPES = ['A', 'AAAA', 'CNAME', 'TXT'] as const
export type HostingerDnsType = (typeof HOSTINGER_DNS_TYPES)[number]

export type HostingerDnsRecordInput = {
  domain: string
  name: string
  type: HostingerDnsType
  content: string
  ttl?: number
}

export type HostingerStatus = {
  hasToken: boolean
  ok: boolean
  error: string | null
  vpsCount: number
  domainCount: number
  checkedAt: number
}

// Hostname labels only: no scheme, no path, no spaces. Loose on purpose — Hostinger
// validates the zone server-side; this just stops obviously wrong input leaving the app.
export const HOSTINGER_DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i

export function isHostingerDnsType(value: string): value is HostingerDnsType {
  return (HOSTINGER_DNS_TYPES as readonly string[]).includes(value)
}
