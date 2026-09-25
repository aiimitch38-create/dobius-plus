import { safeStorage } from 'electron'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { GlobalSettings } from '../../shared/types'
import type { VoiceSettings } from '../../shared/speech-types'
import { credentialFileHasContent } from '../integration-credential-file'
import { writeSecureFile } from '../../shared/secure-file'

/**
 * Encrypted at-rest storage for the ElevenLabs API key (#24). The key used to
 * live in `settings.voice.elevenlabsApiKey`, so it was written in plaintext to
 * dobius-data.json and copied into every backup. It now lives only here,
 * encrypted with safeStorage, and never falls back to plaintext (#25).
 */
export type ElevenLabsApiKeyStatus = {
  configured: boolean
  // True when the key could not be encrypted: it works until the app quits
  // but was not written to disk.
  sessionOnly: boolean
}

export type ElevenLabsKeyMigrationOutcome = 'none' | 'migrated' | 'kept-in-settings'

type SettingsStore = {
  getSettings(): GlobalSettings
  updateSettings(
    updates: Partial<GlobalSettings>,
    options?: { notifyListeners?: boolean }
  ): GlobalSettings
  flush(): void
}

const ELEVENLABS_TOKEN_FILE = 'elevenlabs-token.enc'
let cachedKey: string | null = null
let keyIsSessionOnly = false

function getKeyPath(): string {
  return join(homedir(), '.dobius', ELEVENLABS_TOKEN_FILE)
}

function tryEncrypt(apiKey: string): Buffer | null {
  if (!safeStorage.isEncryptionAvailable()) {
    return null
  }
  try {
    return safeStorage.encryptString(apiKey)
  } catch (error) {
    console.error(
      '[jarvis] safeStorage encryption failed:',
      error instanceof Error ? error.message : String(error)
    )
    return null
  }
}

/** Writes the encrypted key; false (and nothing written) when it cannot be encrypted. */
function persistEncryptedKey(apiKey: string): boolean {
  const encrypted = tryEncrypt(apiKey)
  if (encrypted === null) {
    return false
  }
  writeSecureFile(getKeyPath(), encrypted)
  cachedKey = apiKey
  keyIsSessionOnly = false
  return true
}

export function getElevenLabsApiKeyStatus(): ElevenLabsApiKeyStatus {
  // Why existence only: Settings asks on every render; decrypting here would
  // touch the keychain each time.
  return {
    configured: keyIsSessionOnly || credentialFileHasContent(getKeyPath()),
    sessionOnly: keyIsSessionOnly
  }
}

export function saveElevenLabsApiKey(apiKey: string): ElevenLabsApiKeyStatus {
  const trimmed = apiKey.trim()
  if (!trimmed) {
    throw new Error('ElevenLabs API key is required')
  }
  if (!persistEncryptedKey(trimmed)) {
    // Why (#25): fail closed. Never write the key in plaintext; leave any
    // existing encrypted file untouched and keep the new key for this session.
    console.warn('[jarvis] safeStorage unavailable — ElevenLabs key kept for this session only')
    cachedKey = trimmed
    keyIsSessionOnly = true
  }
  return getElevenLabsApiKeyStatus()
}

/** The stored key, or null when none is saved. Throws when the file cannot be decrypted. */
export function readElevenLabsApiKey(): string | null {
  if (cachedKey !== null) {
    return cachedKey
  }
  const keyPath = getKeyPath()
  if (!existsSync(keyPath)) {
    return null
  }
  // Why no plaintext branch: this store never writes plaintext, so bytes that
  // cannot be decrypted are unreadable, not a legacy plain key.
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('ElevenLabs API key could not be decrypted')
  }
  try {
    const value = safeStorage.decryptString(readFileSync(keyPath))
    cachedKey = value.length > 0 ? value : null
    return cachedKey
  } catch {
    throw new Error('ElevenLabs API key could not be decrypted')
  }
}

export function clearElevenLabsApiKey(): void {
  cachedKey = null
  keyIsSessionOnly = false
  rmSync(getKeyPath(), { force: true })
}

type LegacyKeySettings = Pick<VoiceSettings, 'elevenlabsApiKey'> | undefined

function legacySettingsKey(voice: LegacyKeySettings): string {
  return voice?.elevenlabsApiKey?.trim() ?? ''
}

/**
 * The key speech and the live agent should use: the protected store first,
 * then a legacy settings key that could not be migrated yet (no lockout).
 */
export function resolveElevenLabsApiKey(voice: LegacyKeySettings): string {
  try {
    const stored = readElevenLabsApiKey()
    if (stored) {
      return stored
    }
  } catch (error) {
    console.warn('[jarvis]', error instanceof Error ? error.message : String(error))
  }
  return legacySettingsKey(voice)
}

/** Removes the legacy plaintext key from settings and writes the primary file now. */
export function dropLegacyElevenLabsKeyFromSettings(store: SettingsStore): void {
  const voice = store.getSettings().voice
  if (!voice || !('elevenlabsApiKey' in voice)) {
    return
  }
  const { elevenlabsApiKey: _legacyKey, ...rest } = voice
  void _legacyKey
  store.updateSettings({ voice: rest as VoiceSettings }, { notifyListeners: true })
  // Why flush: the key should leave dobius-data.json now, not whenever the
  // debounced save next runs. Backups rotate from the file just written.
  store.flush()
}

/**
 * One-time move of `settings.voice.elevenlabsApiKey` into this store, through
 * the public Store API. Runs every launch until it succeeds. If the key cannot
 * be encrypted or written, settings are left untouched so the key keeps
 * working; it is retried next launch.
 */
export function migrateElevenLabsKeyOutOfSettings(
  store: SettingsStore
): ElevenLabsKeyMigrationOutcome {
  const voice = store.getSettings().voice
  const legacy = legacySettingsKey(voice)
  if (!legacy) {
    if (voice && 'elevenlabsApiKey' in voice) {
      dropLegacyElevenLabsKeyFromSettings(store)
    }
    return 'none'
  }
  try {
    if (!persistEncryptedKey(legacy)) {
      console.warn('[jarvis] ElevenLabs key left in settings: safeStorage encryption unavailable')
      return 'kept-in-settings'
    }
  } catch (error) {
    console.warn(
      '[jarvis] ElevenLabs key left in settings: could not write the protected store:',
      error instanceof Error ? error.message : String(error)
    )
    return 'kept-in-settings'
  }
  dropLegacyElevenLabsKeyFromSettings(store)
  return 'migrated'
}

export function resetElevenLabsKeyStoreForTests(): void {
  cachedKey = null
  keyIsSessionOnly = false
}
