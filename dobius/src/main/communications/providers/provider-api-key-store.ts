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

function dobiusDir(): string {
  return join(homedir(), '.dobius')
}

function keyPath(provider: ProviderKeyId): string {
  return join(dobiusDir(), KEY_FILES[provider])
}

export function hasProviderApiKey(provider: ProviderKeyId): boolean {
  // Existence only: called on every Settings render, and decrypting here would
  // trigger a macOS keychain prompt each time.
  return existsSync(keyPath(provider))
}

export function saveProviderApiKey(provider: ProviderKeyId, apiKey: string): void {
  const trimmed = apiKey.trim()
  if (!trimmed) {
    throw new Error('API key is required')
  }
  const dir = dobiusDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  if (safeStorage.isEncryptionAvailable()) {
    writeFileSync(keyPath(provider), safeStorage.encryptString(trimmed), { mode: 0o600 })
  } else {
    console.warn(`[providers] safeStorage unavailable — storing ${provider} key in plaintext`)
    writeFileSync(keyPath(provider), trimmed, { encoding: 'utf8', mode: 0o600 })
  }
  cache.set(provider, trimmed)
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
  rmSync(keyPath(provider), { force: true })
}
