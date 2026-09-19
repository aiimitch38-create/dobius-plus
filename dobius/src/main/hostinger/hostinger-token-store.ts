import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Same shape as asana-token-store.ts: one encrypted file under ~/.dobius, read
// lazily so Settings can ask "is there a token?" without a keychain prompt.
const HOSTINGER_TOKEN_FILE = 'hostinger-token.enc'
let cachedToken: string | null = null

function getDobiusDir(): string {
  return join(homedir(), '.dobius')
}

function getTokenPath(): string {
  return join(getDobiusDir(), HOSTINGER_TOKEN_FILE)
}

export function hasHostingerToken(): boolean {
  return existsSync(getTokenPath())
}

export function setHostingerToken(token: string): void {
  const trimmed = token.trim()
  if (!trimmed) {
    throw new Error('Hostinger API token is required')
  }
  if (!existsSync(getDobiusDir())) {
    mkdirSync(getDobiusDir(), { recursive: true })
  }
  if (safeStorage.isEncryptionAvailable()) {
    writeFileSync(getTokenPath(), safeStorage.encryptString(trimmed), { mode: 0o600 })
  } else {
    console.warn('[hostinger] safeStorage encryption unavailable — storing token in plaintext')
    writeFileSync(getTokenPath(), trimmed, { encoding: 'utf8', mode: 0o600 })
  }
  cachedToken = trimmed
}

export function getHostingerToken(): string {
  if (cachedToken !== null) {
    return cachedToken
  }
  const path = getTokenPath()
  if (!existsSync(path)) {
    throw new Error('Hostinger API token is not configured')
  }
  try {
    const raw = readFileSync(path)
    cachedToken = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : raw.toString('utf8')
    return cachedToken
  } catch {
    throw new Error('Hostinger API token could not be decrypted')
  }
}

export function clearHostingerToken(): void {
  cachedToken = null
  rmSync(getTokenPath(), { force: true })
}
