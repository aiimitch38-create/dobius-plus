import { existsSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { hardenExistingSecureFile, writeSecureFile } from '../../shared/secure-file'
import { keepUnreadableCopy, readSafeJsonFile } from '../storage/safe-json-file'
import type { ImessageBridgeConfig } from '../../shared/imessage-bridge'
import {
  IMESSAGE_BRIDGE_DEFAULT_TRIGGER_PREFIX,
  IMESSAGE_BRIDGE_TRIGGER_PREFIX_MAX_LENGTH
} from '../../shared/imessage-bridge'

// Why: the bridge keeps its own JSON file instead of the typed settings store
// so this macOS-only surface never touches the GlobalSettings schema.
const CONFIG_FILE_NAME = 'imessage-bridge.json'

const DEFAULT_CONFIG: ImessageBridgeConfig = {
  enabled: false,
  triggerPrefix: IMESSAGE_BRIDGE_DEFAULT_TRIGGER_PREFIX,
  selfHandle: null,
  lastSeenRowid: 0
}

const LABEL = `[imessage-bridge] ${CONFIG_FILE_NAME}`

let cached: ImessageBridgeConfig | null = null
// Set while the file on disk could not be read; saves are refused until restart.
let unreadableDetail: string | null = null

function configFilePath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILE_NAME)
}

function sanitizeTriggerPrefix(value: unknown): string {
  if (typeof value !== 'string') {
    return IMESSAGE_BRIDGE_DEFAULT_TRIGGER_PREFIX
  }
  const trimmed = value.trim().slice(0, IMESSAGE_BRIDGE_TRIGGER_PREFIX_MAX_LENGTH)
  return trimmed.length > 0 ? trimmed : IMESSAGE_BRIDGE_DEFAULT_TRIGGER_PREFIX
}

function sanitizeSelfHandle(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function sanitizeConfig(raw: unknown): ImessageBridgeConfig {
  if (typeof raw !== 'object' || raw === null) {
    return { ...DEFAULT_CONFIG }
  }
  const record = raw as Partial<Record<keyof ImessageBridgeConfig, unknown>>
  return {
    enabled: record.enabled === true,
    triggerPrefix: sanitizeTriggerPrefix(record.triggerPrefix),
    selfHandle: sanitizeSelfHandle(record.selfHandle),
    lastSeenRowid:
      typeof record.lastSeenRowid === 'number' && Number.isFinite(record.lastSeenRowid)
        ? Math.max(0, Math.floor(record.lastSeenRowid))
        : 0
  }
}

function hardenExistingConfigFile(target: string): void {
  if (!existsSync(target)) {
    return
  }
  // Why (#15): files written by older builds were left at the umask default
  // (0644), exposing the phone/email handle to other local users.
  try {
    hardenExistingSecureFile(target)
  } catch (error) {
    console.warn(
      '[imessage-bridge] failed to restrict config permissions:',
      error instanceof Error ? error.message : String(error)
    )
  }
}

function parseConfig(raw: unknown): ImessageBridgeConfig | undefined {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? sanitizeConfig(raw)
    : undefined
}

function loadConfigFromDisk(): ImessageBridgeConfig {
  const target = configFilePath()
  hardenExistingConfigFile(target)
  // Missing file -> defaults (bridge off). Unreadable or corrupt file -> the
  // same safe defaults for this session, but never saved over the original.
  const result = readSafeJsonFile(target, parseConfig, () => ({ ...DEFAULT_CONFIG }))
  if (result.status === 'unreadable') {
    unreadableDetail = result.detail ?? 'unreadable'
    console.error(
      `${LABEL} unreadable (${target}: ${unreadableDetail}); settings changes are kept for this session only until it is fixed`
    )
    keepUnreadableCopy(target, LABEL, null)
  }
  return result.value
}

function persistConfig(config: ImessageBridgeConfig): void {
  if (unreadableDetail !== null) {
    // Refused: the unreadable original must not be replaced (logged at load).
    return
  }
  // Why: writeSecureFile is tmp-write + rename (readable if the app dies
  // mid-write) and creates the file owner-only (0600 / user ACL, #15), whatever
  // the process umask.
  try {
    writeSecureFile(configFilePath(), `${JSON.stringify(config, null, 2)}\n`)
  } catch (error) {
    console.warn(
      '[imessage-bridge] failed to persist config:',
      error instanceof Error ? error.message : String(error)
    )
  }
}

// Why load once, even while unreadable: re-reading a repaired file mid-session
// would roll lastSeenRowid back to the on-disk value and re-type commands that
// were already delivered. A repaired file is picked up on the next launch.
export function getImessageBridgeConfig(): ImessageBridgeConfig {
  if (!cached) {
    cached = loadConfigFromDisk()
  }
  return { ...cached }
}

export const IMESSAGE_BRIDGE_CONFIG_UNREADABLE_MESSAGE = `${CONFIG_FILE_NAME} can't be read, so changes are not saved; repair or remove it`

/** Why the config file could not be read this session, or null when it is fine. */
export function getImessageBridgeConfigUnreadableDetail(): string | null {
  getImessageBridgeConfig()
  return unreadableDetail
}

/**
 * Settings (renderer) edits. Throws while the file is unreadable so the user
 * sees the refusal instead of a change that silently vanishes on restart.
 * Bridge-internal lastSeenRowid updates keep using updateImessageBridgeConfig.
 */
export function updateImessageBridgeSettings(
  updates: Partial<Omit<ImessageBridgeConfig, 'lastSeenRowid'>>
): ImessageBridgeConfig {
  if (getImessageBridgeConfigUnreadableDetail() !== null) {
    throw new Error(IMESSAGE_BRIDGE_CONFIG_UNREADABLE_MESSAGE)
  }
  return updateImessageBridgeConfig(updates)
}

export function updateImessageBridgeConfig(
  updates: Partial<ImessageBridgeConfig>
): ImessageBridgeConfig {
  // Why: partial updates arrive with absent fields as undefined; spreading
  // those would clobber stored values, so drop them first.
  const definedUpdates = Object.fromEntries(
    Object.entries(updates).filter(([, value]) => value !== undefined)
  )
  const next = sanitizeConfig({ ...getImessageBridgeConfig(), ...definedUpdates })
  cached = next
  persistConfig(next)
  return { ...next }
}
