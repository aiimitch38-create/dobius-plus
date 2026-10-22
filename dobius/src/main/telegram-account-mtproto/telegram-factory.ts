import type {
  PersonalTelegramClient,
  PersonalTelegramClientFactory
} from '../telegram-account/types'
import { teleprotoRuntime } from './teleproto-runtime'
import type { TeleprotoRuntime } from './teleproto-runtime'
import { TeleprotoPersonalTelegramClient } from './personal-client'
import { TelegramAdapterError } from './telegram-errors'

export function createGramJsPersonalTelegramClientFactory(
  credentials: { apiId: number; apiHash: string },
  runtime: TeleprotoRuntime = teleprotoRuntime
): PersonalTelegramClientFactory {
  let safeCredentials: { apiId: number; apiHash: string }
  try {
    const apiId = credentials.apiId
    const apiHash = credentials.apiHash
    if (
      !Number.isSafeInteger(apiId) ||
      apiId <= 0 ||
      apiId > 2_147_483_647 ||
      typeof apiHash !== 'string' ||
      !/^[a-f\d]{32}$/i.test(apiHash)
    ) {
      throw new Error('Invalid credentials')
    }
    safeCredentials = Object.freeze({ apiId, apiHash })
  } catch {
    throw new TelegramAdapterError()
  }
  return (session) => {
    if (
      session !== null &&
      (typeof session !== 'string' || session.length === 0 || session.length > 32_000)
    ) {
      throw new TelegramAdapterError()
    }
    try {
      const client = runtime.createClient(session, safeCredentials.apiId, safeCredentials.apiHash)
      return new TeleprotoPersonalTelegramClient(
        client,
        runtime.saveSession,
        runtime,
        safeCredentials
      )
    } catch {
      throw new TelegramAdapterError()
    }
  }
}

export type { PersonalTelegramClient }
