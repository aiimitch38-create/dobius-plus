import type { TelegramAccountResult } from '../../shared/telegram-account'
import type { PersonalTelegramClient, TelegramVaultState } from './types'
import type { TelegramConnectionContext } from './connection'
import { bounded, mapError } from './connection-operation'
import { validAccountIdentity } from './validation'

/** Reconnects only to revoke a paused saved session; pause is never cleared for general work. */
export async function revokeTelegramAuthorizationFromPaused(
  context: TelegramConnectionContext
): Promise<TelegramAccountResult> {
  if (!context.enabled || !context.createClient) {
    return context.refuse('client-unavailable')
  }
  if (!context.vault.isSecureStorageAvailable()) {
    return context.refuse('secure-storage-unavailable')
  }
  const generation = context.beginOperation()
  let client: PersonalTelegramClient | null = null
  let connectOperation: Promise<{ userId: string }> | null = null
  let connectSettled = true
  let attached = false
  try {
    await context.replies.stop()
    await context.replies.drainSends()
    if (!context.isGenerationCurrent(generation)) {
      return context.refuse('stale-operation')
    }
    const state = context.vault.load()
    if (!state.account || !state.session) {
      return context.refuse('client-unavailable')
    }
    client = context.createClient(state.session)
    connectOperation = client.connect(state.session, context.signal())
    connectSettled = false
    void connectOperation.then(
      () => {
        connectSettled = true
      },
      () => {
        connectSettled = true
      }
    )
    const identity = await bounded(connectOperation, context.signal())
    if (!context.isGenerationCurrent(generation)) {
      await disconnect(client)
      return context.refuse('stale-operation')
    }
    if (!validAccountIdentity(identity) || identity.userId !== state.account.userId) {
      await disconnect(client)
      return context.refuse('account-mismatch')
    }
    const revoke = client.revokeAuthorization
    if (!revoke) {
      await disconnect(client)
      return context.refuse('client-unavailable')
    }
    context.setClient(client)
    attached = true
    const confirmed = await bounded(revoke.call(client), context.signal())
    if (!context.isGenerationCurrent(generation)) {
      return context.refuse('stale-operation')
    }
    if (confirmed !== true) {
      await detach(context, client, generation)
      return context.refuse('authorization-failed')
    }
    context.setClient(null)
    attached = false
    await disconnect(client)
    if (!context.isGenerationCurrent(generation)) {
      return context.refuse('stale-operation')
    }
    const empty: TelegramVaultState = {
      schemaVersion: 2,
      account: null,
      session: null,
      groups: [],
      drafts: [],
      outbox: [],
      inboundEvents: state.inboundEvents
    }
    context.vault.save(empty)
    context.setState(empty)
    context.setPaused(false)
    context.setPhase('disconnected')
    context.record('disconnected')
    return { ok: true, value: undefined }
  } catch (error) {
    if (client && attached) {
      await detach(context, client, generation)
    } else if (client) {
      await disconnect(client)
      if (connectOperation && !connectSettled) {
        void connectOperation.then(
          () => disconnect(client!),
          () => undefined
        )
      }
    }
    return context.isGenerationCurrent(generation)
      ? context.refuse(mapError(error))
      : context.refuse('stale-operation')
  }
}

async function detach(
  context: TelegramConnectionContext,
  client: PersonalTelegramClient,
  generation: number
): Promise<void> {
  if (context.isGenerationCurrent(generation) && context.getClient() === client) {
    context.setClient(null)
  }
  await disconnect(client)
}

async function disconnect(client: PersonalTelegramClient): Promise<void> {
  await client.disconnect().catch(() => undefined)
}
