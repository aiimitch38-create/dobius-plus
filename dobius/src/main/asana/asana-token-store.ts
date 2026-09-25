import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ASANA_TOKEN_FILE = 'asana-token.enc'
let cachedAsanaToken: string | null = null
// True when the token could not be encrypted: it works until the app quits but
// was not written to disk (#25).
let asanaTokenIsSessionOnly = false

function getDobiusDir(): string {
  return join(homedir(), '.dobius')
}

function ensureDobiusDir(): void {
  const dir = getDobiusDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function getAsanaTokenPath(): string {
  return join(getDobiusDir(), ASANA_TOKEN_FILE)
}

export function hasAsanaToken(): boolean {
  // Why: Settings calls this on startup; checking file existence avoids
  // decrypting safeStorage and triggering macOS keychain prompts.
  return asanaTokenIsSessionOnly || existsSync(getAsanaTokenPath())
}

function tryEncryptAsanaToken(pat: string): Buffer | null {
  if (!safeStorage.isEncryptionAvailable()) {
    return null
  }
  try {
    return safeStorage.encryptString(pat)
  } catch (error) {
    console.error(
      '[asana] safeStorage encryption failed:',
      error instanceof Error ? error.message : String(error)
    )
    return null
  }
}

export function setAsanaToken(pat: string): void {
  const trimmed = pat.trim()
  if (!trimmed) {
    throw new Error('Asana Personal Access Token is required')
  }
  const encrypted = tryEncryptAsanaToken(trimmed)
  if (encrypted === null) {
    // Why (#25): fail closed. Never write the token in plaintext; leave any
    // existing encrypted file untouched and keep the new token for this session.
    console.warn('[asana] safeStorage encryption unavailable — Asana token kept for this session only')
    cachedAsanaToken = trimmed
    asanaTokenIsSessionOnly = true
    return
  }
  ensureDobiusDir()
  writeFileSync(getAsanaTokenPath(), encrypted, { mode: 0o600 })
  cachedAsanaToken = trimmed
  asanaTokenIsSessionOnly = false
}

export function getAsanaToken(): string {
  if (cachedAsanaToken !== null) {
    return cachedAsanaToken
  }

  const tokenPath = getAsanaTokenPath()
  if (!existsSync(tokenPath)) {
    throw new Error('Asana Personal Access Token is not configured')
  }
  try {
    const raw = readFileSync(tokenPath)
    cachedAsanaToken = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : raw.toString('utf8')
    return cachedAsanaToken
  } catch {
    throw new Error('Asana Personal Access Token could not be decrypted')
  }
}

export function clearAsanaToken(): void {
  cachedAsanaToken = null
  asanaTokenIsSessionOnly = false
  rmSync(getAsanaTokenPath(), { force: true })
}
