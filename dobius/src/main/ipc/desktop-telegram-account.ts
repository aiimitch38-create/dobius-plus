import { app, dialog } from 'electron'
import { appendFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { TelegramAccountApi } from '../../shared/telegram-account-api'
import type { TelegramAccountResult, TelegramGroupSummary } from '../../shared/telegram-account'
import { TelegramAccountService } from '../telegram-account/service'
import { TelegramAccountVault } from '../telegram-account/vault'
import { electronTelegramCipher } from '../telegram-account/vault'
import { TelegramConsentAuthority } from '../telegram-account/consent-authority'
import { AdamReplyGateway } from '../telegram-account/adam-reply-gateway'
import { resolveAdamBridgeRuntime } from '../telegram-account/adam-bridge-runtime'
import { createDesktopTelegramConsentControls } from './desktop-telegram-consent'
import { TelegramReplyStartup } from './telegram-reply-startup'
import { setTelegramTerminalAccess } from '../telegram-account/terminal-access'
import { sendDraftFromTerminal } from './telegram-terminal-send'
import { createGramJsPersonalTelegramClientFactory } from '../telegram-account-mtproto'
import { setTelegramListenerDiagnosticsSink } from '../telegram-account-mtproto/listener-diagnostics'
import {
  TelegramApplicationCredentialStore,
  validTelegramApplicationCredentials
} from './telegram-account-credentials'
import {
  readTelegramReconnectPreference,
  writeTelegramReconnectPreference,
  type TelegramReconnectPreference
} from './telegram-reconnect-preference'

function value<T>(result: TelegramAccountResult<T>): T {
  if (!result.ok) {
    throw new Error(result.error)
  }
  return result.value
}

export function createDesktopTelegramAccountApi(): TelegramAccountApi {
  const directory = join(app.getPath('userData'), 'telegram-personal-account')
  const credentialPath = join(directory, 'application.enc')
  const sessionPath = join(directory, 'account.enc')
  const reconnectPath = join(directory, 'reconnect.state')
  const listenerLogPath = join(directory, 'listener.log')
  setTelegramListenerDiagnosticsSink((line) =>
    appendFileSync(listenerLogPath, line, { mode: 0o600 })
  )
  let reconnect = readTelegramReconnectPreference(reconnectPath)
  const setReconnect = (preference: TelegramReconnectPreference): void => {
    writeTelegramReconnectPreference(reconnectPath, preference)
    reconnect = preference
  }
  const credentials = new TelegramApplicationCredentialStore(credentialPath)
  const vault = new TelegramAccountVault(sessionPath)
  const consent = new TelegramConsentAuthority(
    join(directory, 'consents.enc'),
    electronTelegramCipher
  )
  const gateway = new AdamReplyGateway({
    runtime: resolveAdamBridgeRuntime,
    accountId: () => service.getAccountId(),
    onStateChanged: (state) => {
      if (state !== 'ready' && state !== 'starting') {
        replyStartup.invalidate()
        void service.stopReplies()
      }
    }
  })
  const service: TelegramAccountService = new TelegramAccountService({
    enabled: true,
    vault,
    createClient: (session) =>
      createGramJsPersonalTelegramClientFactory(credentials.load())(session),
    replyToAdam: (request) => gateway.reply(request),
    // Client management: everyone in the owner's selected groups may be drafted for.
    // Group selection plus owner approval before every send is the gate, not per-person consent.
    readConsent: (groupId) => {
      const accountId = service.getAccountId()
      if (!accountId || !service.snapshot().selectedGroups.some((group) => group.id === groupId)) {
        return { allowed: false, revision: '' }
      }
      return { allowed: true, revision: 'selected-group-v1' }
    }
  })
  const boundAccountId = (): string | null =>
    service.getAccountId() ??
    (reconnect === 'paused' && existsSync(sessionPath)
      ? (vault.load().account?.userId ?? null)
      : null)
  const consentControls = createDesktopTelegramConsentControls(service, consent, boundAccountId)
  const replyStartup = new TelegramReplyStartup(service, gateway)
  let groups: TelegramGroupSummary[] = []
  let viewEpoch = 0
  const invalidateGroups = (): void => {
    viewEpoch += 1
    replyStartup.invalidate()
    groups = []
  }

  // Reconnect only a previously saved account; never initiate first-time login
  // or load chat history during application startup.
  if (reconnect === 'enabled' && existsSync(credentialPath) && existsSync(sessionPath)) {
    void service.restore().catch(() => undefined)
  }
  app.once('will-quit', () => {
    void gateway.stop()
    void service.pause().catch(() => undefined)
  })

  const api: TelegramAccountApi = {
    async getSnapshot() {
      const account = service.snapshot()
      if (account.phase === 'disconnected' && reconnect === 'paused') {
        account.phase = 'paused'
        account.paused = true
      }
      let consents: ReturnType<TelegramConsentAuthority['list']> = []
      try {
        const accountId = boundAccountId()
        if (accountId) {
          consents = consent.list(accountId)
        }
      } catch {
        account.lastError = 'storage-failed'
      }
      account.drafts = account.drafts.map((draft) => {
        // The public draft omits sender identity; the service checks the private record.
        return { ...draft, consentAllowed: service.canApproveDraft(draft.id, draft.revision) }
      })
      return {
        account,
        groups: groups.map((group) => ({ ...group })),
        audit: service.auditSnapshot(),
        consents,
        manualReview: service.getManualReview(),
        replyHandling: {
          bridge: gateway.status(),
          listening: service.isListening(),
          policy: 'approval-required' as const
        }
      }
    },
    async beginSignIn(input) {
      if (!/^\+[1-9]\d{7,14}$/.test(input.phoneNumber)) {
        throw new Error('invalid-input')
      }
      const phase = service.snapshot().phase
      if (phase !== 'disconnected' && phase !== 'error') {
        throw new Error('stale-operation')
      }
      if (input.apiId !== undefined || input.apiHash !== undefined) {
        const application = { apiId: input.apiId, apiHash: input.apiHash }
        if (!validTelegramApplicationCredentials(application)) {
          throw new Error('invalid-input')
        }
        credentials.save(application)
      }
      invalidateGroups()
      setReconnect('disconnected')
      value(await service.beginSignIn(input.phoneNumber))
    },
    async submitCode(input) {
      value(await service.submitCode(input.code))
      if (service.snapshot().connected) {
        setReconnect('enabled')
      }
    },
    async submitPassword(input) {
      value(await service.submitPassword(input.password))
      if (service.snapshot().connected) {
        setReconnect('enabled')
      }
    },
    async cancelSignIn() {
      invalidateGroups()
      await service.cancelSignIn()
    },
    async refreshGroups() {
      const epoch = viewEpoch
      const result = value(await service.listGroups())
      if (epoch !== viewEpoch) {
        throw new Error('stale-operation')
      }
      groups = result
      return groups.map((group) => ({ ...group }))
    },
    async saveGroups(input) {
      await replyStartup.stop()
      value(await service.selectGroups(input.groupIds))
    },
    ...consentControls,
    async revokeConsent(input) {
      replyStartup.invalidate()
      try {
        await consentControls.revokeConsent(input)
      } finally {
        await gateway.stop()
      }
    },
    startReplies: () => replyStartup.start(),
    stopReplies: () => replyStartup.stop(),
    async approveDraft(input) {
      value(service.approveDraft(input.draftId, input.expectedRevision))
    },
    async sendDraft(input) {
      value(await service.sendDraft(input.draftId, input.expectedRevision))
    },
    async pause() {
      replyStartup.invalidate()
      await gateway.stop()
      invalidateGroups()
      const shouldKeepAccount = service.snapshot().connected || reconnect !== 'disconnected'
      // Abort first, even when writing the reconnect preference fails.
      const pending = service.pause()
      try {
        setReconnect(shouldKeepAccount ? 'paused' : 'disconnected')
      } finally {
        await pending
      }
    },
    async resume() {
      if (service.snapshot().connected) {
        return
      }
      invalidateGroups()
      await service.pause()
      value(await service.resume())
      if (service.snapshot().connected) {
        setReconnect('enabled')
      }
    },
    async disconnect() {
      replyStartup.invalidate()
      await gateway.stop()
      invalidateGroups()
      const pending = service.disconnect()
      try {
        setReconnect('disconnected')
      } finally {
        await pending
      }
    },
    async revoke() {
      replyStartup.invalidate()
      await gateway.stop()
      const requiresRestore = reconnect === 'paused' || service.snapshot().phase === 'paused'
      invalidateGroups()
      const epoch = viewEpoch
      // This path reauthenticates only for logout; it never resumes replies.
      value(await (requiresRestore ? service.revokeFromPaused() : service.revoke()))
      if (epoch !== viewEpoch) {
        throw new Error('stale-operation')
      }
      setReconnect('disconnected')
    }
  }
  setTelegramTerminalAccess({
    view: () => api.getSnapshot(),
    history: (group, beforeId, limit) => service.readHistory(group, beforeId, limit),
    send: (draftId) =>
      sendDraftFromTerminal(service, draftId, async (draft) => {
        app.focus({ steal: true })
        const { response } = await dialog.showMessageBox({
          type: 'question',
          buttons: ['Cancel', 'Send'],
          defaultId: 0,
          cancelId: 0,
          message: `Send this reply to ${draft.groupTitle}?`,
          detail: draft.body
        })
        return response === 1
      })
  })
  return api
}
