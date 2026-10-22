import { lstatSync, readFileSync } from 'node:fs'
import { writeSecureFile } from '../../shared/secure-file'

export type TelegramReconnectPreference = 'enabled' | 'paused' | 'disconnected'

/** This private file stores only a non-secret reconnect choice, never account data. */
export function readTelegramReconnectPreference(path: string): TelegramReconnectPreference {
  try {
    const metadata = lstatSync(path)
    if (!metadata.isFile() || metadata.size > 64) {
      return 'disconnected'
    }
    const value = readFileSync(path, 'utf8')
    if (value === 'enabled-v1') {
      return 'enabled'
    }
    if (value === 'paused-v1') {
      return 'paused'
    }
  } catch {
    /* Missing or unreadable preferences never authorize a connection. */
  }
  return 'disconnected'
}

export function writeTelegramReconnectPreference(
  path: string,
  preference: TelegramReconnectPreference
): void {
  try {
    writeSecureFile(path, `${preference}-v1`)
  } catch {
    throw new Error('storage-failed')
  }
}
