import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export type TokenResult = { token: string } | { token: undefined; detail: string }

export type IngestResult =
  | { outcome: 'delivered' }
  | { outcome: 'poison' }
  | { outcome: 'retry'; state: 'offline' | 'unauthorized'; detail: string }

// Why: ADAM rejected the record itself; retrying the same bytes can never succeed.
const POISON_STATUSES = new Set([400, 413, 422])

function adamServiceUrl(): string {
  return process.env.ADAM_SERVICE_URL ?? 'http://127.0.0.1:8791'
}

/** errno / error name only, so logs never carry tokens or event text. */
export function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return String(error.code)
  }
  return error instanceof Error ? error.name : 'unknown error'
}

export async function resolveAdamServiceToken(): Promise<TokenResult> {
  if (process.env.ADAM_SERVICE_TOKEN) {
    return { token: process.env.ADAM_SERVICE_TOKEN }
  }
  const tokenPath = process.env.ADAM_SERVICE_TOKEN_PATH ?? path.join(
    os.homedir(),
    'dobius',
    'projects',
    'ADAM',
    'service',
    'data',
    'service-token'
  )
  try {
    const token = (await readFile(tokenPath, 'utf8')).trim()
    return token ? { token } : { token: undefined, detail: 'token file is empty' }
  } catch (error) {
    return { token: undefined, detail: `token file ${errorCode(error)}` }
  }
}

export async function postEventToAdam(body: string, token: string): Promise<IngestResult> {
  let response: Response
  try {
    response = await fetch(new URL('/v1/events/ingest', adamServiceUrl()), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body,
      signal: AbortSignal.timeout(5_000)
    })
  } catch (error) {
    return { outcome: 'retry', state: 'offline', detail: errorCode(error) }
  }
  if (response.ok) {
    return { outcome: 'delivered' }
  }
  if (response.status === 401 || response.status === 403) {
    return { outcome: 'retry', state: 'unauthorized', detail: `HTTP ${response.status}` }
  }
  if (POISON_STATUSES.has(response.status)) {
    return { outcome: 'poison' }
  }
  return { outcome: 'retry', state: 'offline', detail: `HTTP ${response.status}` }
}
