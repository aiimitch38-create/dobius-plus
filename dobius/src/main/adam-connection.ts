import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_ADAM_ENDPOINT } from '../shared/constants'

/**
 * The one place that decides how Dobius+ reaches ADAM. Jarvis converse and
 * agent-event delivery both resolve through here on every call, so a changed
 * endpoint, a rotated token or an ADAM install that appears after launch takes
 * effect without a restart (#81, #118).
 *
 * Precedence, highest first:
 * - endpoint: ADAM_SERVICE_URL env → Settings voice.adamEndpoint → default
 * - token:    ADAM_SERVICE_TOKEN env → token file at ADAM_SERVICE_TOKEN_PATH
 *             (or legacy DOBIUS_ADAM_TOKEN_PATH) → <ADAM dir>/service/data/service-token
 * - ADAM dir: DOBIUS_ADAM_PROJECT_DIR env → ~/dobius/projects/ADAM (token lookup only;
 *             the self-edit root stays fixed to the default path)
 *
 * The token and event text only go to a Settings/default endpoint on this
 * machine or the tailnet; ADAM_SERVICE_URL is a trusted developer override.
 */

export type AdamTarget =
  | { ok: true; endpoint: string }
  | { ok: false; state: 'blocked-endpoint'; detail: string }

export type AdamTokenResult =
  | { token: string }
  | { token: undefined; state: 'not-installed' | 'no-token'; detail: string }

let settingsEndpointReader: () => string | undefined = () => undefined

/** Lets callers without a store handle (event delivery) read the live Settings endpoint. */
export function setAdamEndpointSettingReader(reader: () => string | undefined): void {
  settingsEndpointReader = reader
}

/** errno / error name only, so logs never carry tokens or event text. */
export function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return String(error.code)
  }
  return error instanceof Error ? error.name : 'unknown error'
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/** Default ADAM checkout; also the fixed self-edit root, which no env value may widen. */
export function defaultAdamProjectDirectory(home: string = homedir()): string {
  return join(home, 'dobius', 'projects', 'ADAM')
}

/** Where to look for ADAM and its token (never used as a write root). */
export function adamProjectDirectory(home: string = homedir()): string {
  return nonEmpty(process.env.DOBIUS_ADAM_PROJECT_DIR) ?? defaultAdamProjectDirectory(home)
}

/** Base URL without trailing slashes; `settingsEndpoint` defaults to the registered reader. */
export function resolveAdamEndpoint(
  settingsEndpoint: string | undefined = settingsEndpointReader()
): string {
  const endpoint =
    nonEmpty(process.env.ADAM_SERVICE_URL) ?? nonEmpty(settingsEndpoint) ?? DEFAULT_ADAM_ENDPOINT
  return endpoint.replace(/\/+$/, '')
}

function isLocalOrTailnetHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (host === 'localhost' || host === '::1' || host.endsWith('.ts.net')) {
    return true
  }
  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)?.slice(1).map(Number)
  if (!octets || octets.some((octet) => octet > 255)) {
    return false
  }
  // 127.0.0.0/8 loopback, 100.64.0.0/10 tailnet (CGNAT) range.
  return octets[0] === 127 || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
}

/**
 * The endpoint the token may be sent to. Why a host allowlist: the Settings
 * value is editable, and a typo or hostile value would otherwise carry the
 * bearer token and agent event text off the machine.
 */
export function resolveAdamTarget(
  settingsEndpoint: string | undefined = settingsEndpointReader()
): AdamTarget {
  const endpoint = resolveAdamEndpoint(settingsEndpoint)
  if (nonEmpty(process.env.ADAM_SERVICE_URL)) {
    return { ok: true, endpoint }
  }
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return { ok: false, state: 'blocked-endpoint', detail: 'endpoint is not a valid URL' }
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !isLocalOrTailnetHost(url.hostname)) {
    return { ok: false, state: 'blocked-endpoint', detail: 'endpoint is not on this machine or the tailnet' }
  }
  return { ok: true, endpoint }
}

// Why no cache: the file is tiny and read once per ask / delivery pass; a
// process-lifetime cache kept a missing or rotated token until restart.
export async function resolveAdamToken(): Promise<AdamTokenResult> {
  const envToken = nonEmpty(process.env.ADAM_SERVICE_TOKEN)
  if (envToken) {
    return { token: envToken }
  }
  const explicitPath =
    nonEmpty(process.env.ADAM_SERVICE_TOKEN_PATH) ?? nonEmpty(process.env.DOBIUS_ADAM_TOKEN_PATH)
  const projectDir = adamProjectDirectory()
  if (!explicitPath && !existsSync(projectDir)) {
    return { token: undefined, state: 'not-installed', detail: 'ADAM folder not found' }
  }
  const tokenPath = explicitPath ?? join(projectDir, 'service', 'data', 'service-token')
  try {
    const token = (await readFile(tokenPath, 'utf8')).trim()
    return token ? { token } : { token: undefined, state: 'no-token', detail: 'token file is empty' }
  } catch (error) {
    return { token: undefined, state: 'no-token', detail: `token file ${errorCode(error)}` }
  }
}
