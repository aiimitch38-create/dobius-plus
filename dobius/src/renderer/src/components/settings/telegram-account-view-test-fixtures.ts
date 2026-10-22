import { vi } from 'vitest'
import type {
  TelegramAccountApi,
  TelegramAccountView
} from '../../../../shared/telegram-account-api'

export function connectedTelegramView(): TelegramAccountView {
  const groups = [
    { id: '-101', title: 'Client one', kind: 'group' as const },
    { id: '-102', title: 'Client two', kind: 'supergroup' as const },
    { id: '-103', title: 'Client three', kind: 'group' as const }
  ]
  return {
    account: {
      phase: 'connected',
      connected: true,
      paused: false,
      selectedGroups: groups,
      drafts: [],
      lastError: null,
      revision: 2
    },
    groups,
    audit: [],
    consents: [],
    replyHandling: { bridge: 'ready', listening: false, policy: 'approval-required' }
  }
}
export function telegramViewApi(getState: () => TelegramAccountView): TelegramAccountApi {
  return {
    getSnapshot: vi.fn(async () => structuredClone(getState())),
    beginSignIn: vi.fn(async () => undefined),
    submitCode: vi.fn(async () => undefined),
    submitPassword: vi.fn(async () => undefined),
    cancelSignIn: vi.fn(async () => undefined),
    refreshGroups: vi.fn(async () => getState().groups),
    saveGroups: vi.fn(async () => undefined),
    getParticipants: vi.fn(async () => [
      { groupId: '-101', senderId: '88', displayName: 'Alex Client' }
    ]),
    grantConsent: vi.fn(async () => undefined),
    revokeConsent: vi.fn(async () => undefined),
    startReplies: vi.fn(async () => undefined),
    stopReplies: vi.fn(async () => undefined),
    approveDraft: vi.fn(async () => undefined),
    sendDraft: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    revoke: vi.fn(async () => undefined)
  }
}
