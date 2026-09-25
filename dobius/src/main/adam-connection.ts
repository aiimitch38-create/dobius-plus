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
 * - ADAM dir: DOBIUS_ADAM_PROJECT_DIR env → ~/dobius/projects/ADAM
 */

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

/** The ADAM project checkout: token home and the self-edit root Adam may rewrite. */
export function adamProjectDirectory(home: string = homedir()): string {
  return nonEmpty(process.env.DOBIUS_ADAM_PROJECT_DIR) ?? join(home, 'dobius', 'projects', 'ADAM')
}

/** Base URL without trailing slashes; `settingsEndpoint` defaults to the registered reader. */
export function resolveAdamEndpoint(
  settingsEndpoint: string | undefined = settingsEndpointReader()
): string {
  const endpoint =
    nonEmpty(process.env.ADAM_SERVICE_URL) ?? nonEmpty(settingsEndpoint) ?? DEFAULT_ADAM_ENDPOINT
  return endpoint.replace(/\/+$/, '')
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
