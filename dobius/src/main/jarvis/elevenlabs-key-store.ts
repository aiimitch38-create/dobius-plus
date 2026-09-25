import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { GlobalSettings } from '../../shared/types'
import type { ElevenLabsKeyStatus, VoiceSettings } from '../../shared/speech-types'
import { credentialFileHasContent } from '../integration-credential-file'
import { writeSecureFile } from '../../shared/secure-file'

/**
 * Encrypted at-rest storage for the ElevenLabs API key (#24). The key used to
 * live in `settings.voice.elevenlabsApiKey`, so it was written in plaintext to
 * dobius-data.json and copied into every backup. It now lives only here,
 * encrypted with safeStorage, and never falls back to plaintext (#25).
 */
export type ElevenLabsApiKeyStatus = ElevenLabsKeyStatus

export type ElevenLabsKeyMigrationOutcome = 'none' | 'migrated' | 'kept-in-settings'

type SettingsStore = {
  getSettings(): GlobalSettings
  updateSettings(
    updates: Partial<GlobalSettings>,
    options?: { notifyListeners?: boolean }
  ): GlobalSettings
  flush(): void
}

let cachedKey: string | null = null
let keyIsSessionOnly = false
let keyFileUnreadable = false
let warnedUnreadableMigration = false

// Why per build: dev and packaged builds have separate settings folders and may
// have different keychain identities, so a shared file would let a dev run
// overwrite or delete the installed app's key.
function getKeyPath(): string {
  const fileName = app.isPackaged ? 'elevenlabs-token.enc' : 'elevenlabs-token.dev.enc'
  return join(homedir(), '.dobius', fileName)
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

/**
 * Writes the encrypted key and reads it back. False when it cannot be
 * encrypted (nothing written) or the written file does not decrypt to the key.
 */
function persistEncryptedKey(apiKey: string): boolean {
  const encrypted = tryEncrypt(apiKey)
  if (encrypted === null) {
    return false
  }
  const keyPath = getKeyPath()
  // Why a staged file: callers drop the settings copy on success, so the new
  // file must decrypt back to this exact key before it replaces the old one.
  const stagedPath = `${keyPath}.verify`
  writeSecureFile(stagedPath, encrypted)
  let verified = false
  try {
    verified = safeStorage.decryptString(readFileSync(stagedPath)) === apiKey
    if (!verified) {
      console.warn('[jarvis] ElevenLabs key file did not verify after writing')
    }
  } catch (error) {
    console.warn(
      '[jarvis] ElevenLabs key file could not be read back:',
      error instanceof Error ? error.message : String(error)
    )
  }
  if (!verified) {
    rmSync(stagedPath, { force: true })
    return false
  }
  renameSync(stagedPath, keyPath)
  cachedKey = apiKey
  keyIsSessionOnly = false
  keyFileUnreadable = false
  return true
}

export function getElevenLabsApiKeyStatus(): ElevenLabsApiKeyStatus {
  const fileExists = credentialFileHasContent(getKeyPath())
  // Why one decrypt: it is cached after success and remembered after failure,
  // so repeated Settings renders do not touch the keychain again.
  if (fileExists && cachedKey === null && !keyFileUnreadable) {
    try {
      readElevenLabsApiKey()
    } catch {
      keyFileUnreadable = true
    }
  }
  return {
    configured: keyIsSessionOnly || fileExists,
    sessionOnly: keyIsSessionOnly,
    unreadable: fileExists && keyFileUnreadable && cachedKey === null
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
    keyFileUnreadable = true
    throw new Error('ElevenLabs API key could not be decrypted')
  }
  try {
    const value = safeStorage.decryptString(readFileSync(keyPath))
    cachedKey = value.length > 0 ? value : null
    keyFileUnreadable = false
    return cachedKey
  } catch {
    keyFileUnreadable = true
    throw new Error('ElevenLabs API key could not be decrypted')
  }
}

export function clearElevenLabsApiKey(): void {
  cachedKey = null
  keyIsSessionOnly = false
  keyFileUnreadable = false
  rmSync(getKeyPath(), { force: true })
}

type LegacyKeySettings = Pick<VoiceSettings, 'elevenlabsApiKey'> | undefined

function legacySettingsKey(voice: LegacyKeySettings): string {
  return voice?.elevenlabsApiKey?.trim() ?? ''
}

/**
 * The key speech and the live agent should use. A key entered this session
 * wins; then a legacy settings key that could not be migrated yet (it is the
 * newest durable copy, and keeps working: no lockout); then the protected file.
 */
export function resolveElevenLabsApiKey(voice: LegacyKeySettings): string {
  if (keyIsSessionOnly && cachedKey) {
    return cachedKey
  }
  const legacy = legacySettingsKey(voice)
  if (legacy) {
    return legacy
  }
  try {
    return readElevenLabsApiKey() ?? ''
  } catch (error) {
    console.warn('[jarvis]', error instanceof Error ? error.message : String(error))
    return ''
  }
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
  if (existingKeyFileIsUnreadable()) {
    // Why: that file may hold the only copy of a key another build or keychain
    // can still read; never overwrite it automatically.
    if (!warnedUnreadableMigration) {
      warnedUnreadableMigration = true
      console.warn('[jarvis] ElevenLabs key left in settings: existing key file cannot be decrypted')
    }
    return 'kept-in-settings'
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

function existingKeyFileIsUnreadable(): boolean {
  if (!credentialFileHasContent(getKeyPath())) {
    return false
  }
  try {
    readElevenLabsApiKey()
    return false
  } catch {
    return true
  }
}

export function resetElevenLabsKeyStoreForTests(): void {
  cachedKey = null
  keyIsSessionOnly = false
  keyFileUnreadable = false
  warnedUnreadableMigration = false
}
