import { safeStorage } from 'electron'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { hardenExistingSecureFile, writeSecureFile } from '../../shared/secure-file'

const MINIMAX_COOKIE_FILE = 'minimax-session-cookie.enc'
const COOKIE_ENVELOPE_PREFIX = 'dobius-minimax-cookie:v1:'
let cachedMiniMaxCookie: string | null = null
// True when the cookie could not be encrypted: it works until the app quits but
// was not written to disk (#25).
let miniMaxCookieIsSessionOnly = false
let warnedMiniMaxCookieStatusHardenFailure = false

type MiniMaxCookieEnvelope = {
  kind: 'encrypted' | 'plaintext'
  payload: Buffer
}

function getDobiusDir(): string {
  return join(homedir(), '.dobius')
}

function getMiniMaxCookiePath(): string {
  return join(getDobiusDir(), MINIMAX_COOKIE_FILE)
}

function encodeCookieEnvelope(kind: MiniMaxCookieEnvelope['kind'], payload: Buffer): string {
  return `${COOKIE_ENVELOPE_PREFIX}${kind}:${payload.toString('base64')}`
}

function decodeCookieEnvelope(raw: Buffer): MiniMaxCookieEnvelope | null {
  const text = raw.toString('utf8')
  if (!text.startsWith(COOKIE_ENVELOPE_PREFIX)) {
    return null
  }
  const rest = text.slice(COOKIE_ENVELOPE_PREFIX.length)
  const separator = rest.indexOf(':')
  if (separator < 0) {
    throw new Error('MiniMax session cookie could not be decrypted')
  }
  const kind = rest.slice(0, separator)
  if (kind !== 'encrypted' && kind !== 'plaintext') {
    throw new Error('MiniMax session cookie could not be decrypted')
  }
  return {
    kind,
    payload: Buffer.from(rest.slice(separator + 1), 'base64')
  }
}

// Why: migrates cookies saved before the envelope format existed. Older files
// hold raw bytes (safeStorage-encrypted or plaintext), so we sniff the content
// to tell the two apart rather than removing this as seemingly dead code.
function looksLikeCookieHeader(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) {
    return false
  }
  for (let index = 0; index < trimmed.length; index += 1) {
    const code = trimmed.charCodeAt(index)
    if (code < 32 || code === 127) {
      return false
    }
  }
  return (
    /^Cookie:\s*\S+/i.test(trimmed) ||
    /(?:^|;\s*)[A-Za-z0-9_.-]+\s*=/.test(trimmed) ||
    /(?:^|[;\s])[A-Za-z0-9_.-]+\s*:\s*["'][^"']+["']/.test(trimmed)
  )
}

function readEnvelope(envelope: MiniMaxCookieEnvelope): string {
  if (envelope.kind === 'plaintext') {
    return envelope.payload.toString('utf8')
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('MiniMax session cookie could not be decrypted')
  }
  return safeStorage.decryptString(envelope.payload)
}

function readLegacyCookie(raw: Buffer): string {
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(raw)
    } catch {
      const plaintext = raw.toString('utf8')
      if (looksLikeCookieHeader(plaintext)) {
        return plaintext
      }
      throw new Error('MiniMax session cookie could not be decrypted')
    }
  }
  const plaintext = raw.toString('utf8')
  if (looksLikeCookieHeader(plaintext)) {
    return plaintext
  }
  throw new Error('MiniMax session cookie could not be decrypted')
}

export function hasMiniMaxSessionCookie(): boolean {
  if (miniMaxCookieIsSessionOnly) {
    return true
  }
  const keyPath = getMiniMaxCookiePath()
  if (!existsSync(keyPath)) {
    return false
  }
  try {
    hardenExistingSecureFile(keyPath)
  } catch (error) {
    if (!warnedMiniMaxCookieStatusHardenFailure) {
      warnedMiniMaxCookieStatusHardenFailure = true
      console.warn('[minimax] Failed to harden MiniMax cookie file while checking status', error)
    }
  }
  return true
}

export function saveMiniMaxSessionCookie(cookie: string): void {
  const trimmed = cookie.trim()
  if (!trimmed) {
    throw new Error('MiniMax session cookie is required')
  }
  const encrypted = tryEncryptMiniMaxCookie(trimmed)
  if (encrypted === null) {
    // Why (#25): fail closed. Never write the cookie in plaintext; leave any
    // existing file untouched and keep the new cookie for this session.
    console.warn('[minimax] safeStorage encryption unavailable — MiniMax cookie kept for this session only')
    cachedMiniMaxCookie = trimmed
    miniMaxCookieIsSessionOnly = true
    return
  }
  writeSecureFile(getMiniMaxCookiePath(), encodeCookieEnvelope('encrypted', encrypted))
  cachedMiniMaxCookie = trimmed
  miniMaxCookieIsSessionOnly = false
}

function tryEncryptMiniMaxCookie(cookie: string): Buffer | null {
  if (!safeStorage.isEncryptionAvailable()) {
    return null
  }
  try {
    return safeStorage.encryptString(cookie)
  } catch (error) {
    console.error(
      '[minimax] safeStorage encryption failed:',
      error instanceof Error ? error.message : String(error)
    )
    return null
  }
}

export function readMiniMaxSessionCookie(): string | null {
  if (cachedMiniMaxCookie !== null) {
    return cachedMiniMaxCookie
  }
  const keyPath = getMiniMaxCookiePath()
  if (!existsSync(keyPath)) {
    return null
  }
  // Why: keep hardening out of the decode/decrypt try below so a chmod/ACL
  // failure isn't misreported as a decrypt failure (matches hasMiniMaxSessionCookie).
  try {
    hardenExistingSecureFile(keyPath)
  } catch (error) {
    console.warn('[minimax] Failed to harden MiniMax cookie file while reading', error)
  }
  try {
    const raw = readFileSync(keyPath)
    const envelope = decodeCookieEnvelope(raw)
    cachedMiniMaxCookie = envelope ? readEnvelope(envelope) : readLegacyCookie(raw)
    return cachedMiniMaxCookie
  } catch (error) {
    console.error('[minimax] failed to decode/decrypt session cookie', error)
    throw new Error('MiniMax session cookie could not be decrypted')
  }
}

export function clearMiniMaxSessionCookie(): void {
  cachedMiniMaxCookie = null
  miniMaxCookieIsSessionOnly = false
  rmSync(getMiniMaxCookiePath(), { force: true })
}
