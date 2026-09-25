import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Encrypted at-rest storage for provider API keys, mirroring
 * speech/openai-api-key-store.ts. Keys never reach the renderer — Settings is
 * told only whether one is configured — so a key cannot leak through devtools,
 * a window message, or a status snapshot.
 */
export type ProviderKeyId = 'openrouter'

const KEY_FILES: Record<ProviderKeyId, string> = {
  openrouter: 'openrouter-token.enc'
}

const cache = new Map<ProviderKeyId, string>()
// Keys that could not be encrypted: usable until the app quits, never written
// to disk (#25).
const sessionOnly = new Set<ProviderKeyId>()

function dobiusDir(): string {
  return join(homedir(), '.dobius')
}

function keyPath(provider: ProviderKeyId): string {
  return join(dobiusDir(), KEY_FILES[provider])
}

export function hasProviderApiKey(provider: ProviderKeyId): boolean {
  // Existence only: called on every Settings render, and decrypting here would
  // trigger a macOS keychain prompt each time.
  return sessionOnly.has(provider) || existsSync(keyPath(provider))
}

function tryEncryptProviderKey(provider: ProviderKeyId, apiKey: string): Buffer | null {
  if (!safeStorage.isEncryptionAvailable()) {
    return null
  }
  try {
    return safeStorage.encryptString(apiKey)
  } catch (error) {
    console.error(
      `[providers] safeStorage encryption failed for ${provider}:`,
      error instanceof Error ? error.message : String(error)
    )
    return null
  }
}

export function saveProviderApiKey(provider: ProviderKeyId, apiKey: string): void {
  const trimmed = apiKey.trim()
  if (!trimmed) {
    throw new Error('API key is required')
  }
  const encrypted = tryEncryptProviderKey(provider, trimmed)
  if (encrypted === null) {
    // Why (#25): fail closed. Never write the key in plaintext; leave any
    // existing encrypted file untouched and keep the new key for this session.
    console.warn(`[providers] safeStorage unavailable — ${provider} key kept for this session only`)
    cache.set(provider, trimmed)
    sessionOnly.add(provider)
    return
  }
  const dir = dobiusDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(keyPath(provider), encrypted, { mode: 0o600 })
  cache.set(provider, trimmed)
  sessionOnly.delete(provider)
}

export function readProviderApiKey(provider: ProviderKeyId): string {
  const cached = cache.get(provider)
  if (cached !== undefined) {
    return cached
  }
  const path = keyPath(provider)
  if (!existsSync(path)) {
    throw new Error(`${provider} API key is not configured. Add it in Settings > Agents.`)
  }
  try {
    const raw = readFileSync(path)
    const value = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : raw.toString('utf8')
    cache.set(provider, value)
    return value
  } catch {
    throw new Error(`${provider} API key could not be decrypted`)
  }
}

export function clearProviderApiKey(provider: ProviderKeyId): void {
  cache.delete(provider)
  sessionOnly.delete(provider)
  rmSync(keyPath(provider), { force: true })
}
