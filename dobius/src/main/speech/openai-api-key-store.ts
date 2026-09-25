import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

type StoredOpenAiKey = {
  encryptedKeyBase64: string
}

export type OpenAiSpeechApiKeyStatus = {
  configured: boolean
  // True when the key could not be encrypted: it works until the app quits
  // but was not written to disk.
  sessionOnly: boolean
}

const OPENAI_SPEECH_TOKEN_FILE = 'openai-speech-token.enc'
let cachedOpenAiSpeechApiKey: string | null = null
let openAiSpeechApiKeyIsSessionOnly = false

function getDobiusDir(): string {
  return join(homedir(), '.dobius')
}

function ensureDobiusDir(): void {
  const dir = getDobiusDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function getOpenAiKeyPath(): string {
  return join(getDobiusDir(), OPENAI_SPEECH_TOKEN_FILE)
}

// Why: legacy files are JSON objects; safeStorage ciphertext never starts
// with '{' (macOS/Linux blobs start with "v1", Windows DPAPI with 0x01).
function looksLikeLegacyJson(raw: Buffer): boolean {
  return raw.toString('utf8').trimStart().startsWith('{')
}

/**
 * null when the file is not a legacy JSON key (the current binary format).
 * Throws when it IS legacy JSON but malformed: that file must not be handed
 * to decryptString or used as a plaintext key, and it is never deleted.
 */
function readLegacyJsonStoredOpenAiKey(raw: Buffer): StoredOpenAiKey | null {
  if (!looksLikeLegacyJson(raw)) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.toString('utf8'))
  } catch {
    parsed = null
  }
  const encryptedKeyBase64 =
    parsed && typeof parsed === 'object' && 'encryptedKeyBase64' in parsed
      ? parsed.encryptedKeyBase64
      : undefined
  if (typeof encryptedKeyBase64 !== 'string' || encryptedKeyBase64 === '') {
    throw new Error('OpenAI API key file is malformed; save the key again in Settings')
  }
  return { encryptedKeyBase64 }
}

export function hasOpenAiSpeechApiKey(): boolean {
  // Why: Settings and model-state refresh call this on startup; checking file
  // existence avoids decrypting safeStorage and triggering macOS keychain prompts.
  return openAiSpeechApiKeyIsSessionOnly || existsSync(getOpenAiKeyPath())
}

export function getOpenAiSpeechApiKeyStatus(): OpenAiSpeechApiKeyStatus {
  return { configured: hasOpenAiSpeechApiKey(), sessionOnly: openAiSpeechApiKeyIsSessionOnly }
}

function tryEncryptOpenAiKey(apiKey: string): Buffer | null {
  if (!safeStorage.isEncryptionAvailable()) {
    return null
  }
  try {
    return safeStorage.encryptString(apiKey)
  } catch (err) {
    console.error('[speech] safeStorage encryption failed:', err)
    return null
  }
}

export function saveOpenAiSpeechApiKey(apiKey: string): OpenAiSpeechApiKeyStatus {
  const trimmed = apiKey.trim()
  if (!trimmed) {
    throw new Error('OpenAI API key is required')
  }
  const encrypted = tryEncryptOpenAiKey(trimmed)
  if (encrypted === null) {
    // Why (#25): fail closed. Never write the key in plaintext; leave any
    // existing encrypted file untouched and keep the new key for this session.
    console.warn(
      '[speech] safeStorage encryption unavailable — OpenAI speech key kept for this session only'
    )
    cachedOpenAiSpeechApiKey = trimmed
    openAiSpeechApiKeyIsSessionOnly = true
    return getOpenAiSpeechApiKeyStatus()
  }
  ensureDobiusDir()
  writeFileSync(getOpenAiKeyPath(), encrypted, { mode: 0o600 })
  cachedOpenAiSpeechApiKey = trimmed
  openAiSpeechApiKeyIsSessionOnly = false
  return getOpenAiSpeechApiKeyStatus()
}

export function readOpenAiSpeechApiKey(): string {
  if (cachedOpenAiSpeechApiKey !== null) {
    return cachedOpenAiSpeechApiKey
  }

  const keyPath = getOpenAiKeyPath()
  if (!existsSync(keyPath)) {
    throw new Error('OpenAI API key is not configured')
  }
  const raw = readFileSync(keyPath)
  const legacyJson = readLegacyJsonStoredOpenAiKey(raw)
  try {
    if (legacyJson) {
      cachedOpenAiSpeechApiKey = safeStorage.decryptString(
        Buffer.from(legacyJson.encryptedKeyBase64, 'base64')
      )
      return cachedOpenAiSpeechApiKey
    }
    cachedOpenAiSpeechApiKey = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : raw.toString('utf8')
    return cachedOpenAiSpeechApiKey
  } catch {
    throw new Error('OpenAI API key could not be decrypted')
  }
}

export function clearOpenAiSpeechApiKey(): void {
  cachedOpenAiSpeechApiKey = null
  openAiSpeechApiKeyIsSessionOnly = false
  rmSync(getOpenAiKeyPath(), { force: true })
}
