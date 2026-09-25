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

function readLegacyJsonStoredOpenAiKey(): StoredOpenAiKey | null {
  const keyPath = getOpenAiKeyPath()
  if (!existsSync(keyPath)) {
    return null
  }
  try {
    const parsed = JSON.parse(readFileSync(keyPath, 'utf8')) as Partial<StoredOpenAiKey>
    if (typeof parsed.encryptedKeyBase64 !== 'string' || parsed.encryptedKeyBase64 === '') {
      return null
    }
    return { encryptedKeyBase64: parsed.encryptedKeyBase64 }
  } catch {
    return null
  }
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
  try {
    const raw = readFileSync(keyPath)
    const legacyJson = readLegacyJsonStoredOpenAiKey()
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
