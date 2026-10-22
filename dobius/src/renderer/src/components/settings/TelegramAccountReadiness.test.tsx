// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  TelegramAccountView,
  TelegramReplyHandling
} from '../../../../shared/telegram-account-api'
import { TelegramAccountSection } from './TelegramAccountSection'
import { connectedTelegramView, telegramViewApi } from './telegram-account-view-test-fixtures'

afterEach(cleanup)
function configuredView(): TelegramAccountView {
  const state = connectedTelegramView()
  state.consents = [
    {
      groupId: '-101',
      senderId: '88',
      displayName: 'Alex Client',
      evidence: 'Agreed to AI handling in message123',
      grantedAt: Date.now() - 1000,
      expiresAt: Date.now() + 86400000,
      revision: 'proof1'
    }
  ]
  return state
}

describe('Telegram UI rejects unknown readiness and invalid consent windows', () => {
  it.each([
    'missing',
    'unknown-bridge',
    'unknown-policy',
    'paused',
    'disconnected-flag',
    'future-grant',
    'expired-grant'
  ] as const)('disables connect for %s', async (invalid) => {
    const state = configuredView()
    if (invalid === 'missing') {
      delete state.replyHandling
    }
    if (invalid === 'unknown-bridge') {
      state.replyHandling = {
        ...state.replyHandling!,
        bridge: 'unrecognized'
      } as unknown as TelegramReplyHandling
    }
    if (invalid === 'unknown-policy') {
      state.replyHandling = {
        ...state.replyHandling!,
        policy: 'automatic'
      } as unknown as TelegramReplyHandling
    }
    if (invalid === 'paused') {
      state.account.paused = true
    }
    if (invalid === 'disconnected-flag') {
      state.account.connected = false
    }
    if (invalid === 'future-grant') {
      state.consents![0].grantedAt = Date.now() + 3600000
    }
    if (invalid === 'expired-grant') {
      state.consents![0].expiresAt = Date.now() - 1
    }
    render(<TelegramAccountSection api={telegramViewApi(() => state)} />)
    expect(
      (
        (await screen.findByRole('button', {
          name: 'Connect Adam and start listening'
        })) as HTMLButtonElement
      ).disabled
    ).toBe(true)
  })

  it.each(['unavailable', 'error', 'ready'] as const)(
    'allows an explicit connection attempt for known bridge state %s',
    async (bridge) => {
      const state = configuredView()
      state.replyHandling!.bridge = bridge
      render(<TelegramAccountSection api={telegramViewApi(() => state)} />)
      expect(
        (
          (await screen.findByRole('button', {
            name: 'Connect Adam and start listening'
          })) as HTMLButtonElement
        ).disabled
      ).toBe(false)
    }
  )

  it.each(['missing', 'unknown-bridge', 'unknown-policy', 'paused', 'disconnected-flag'] as const)(
    'keeps both approve and send disabled for %s even if old draft consent was true',
    async (invalid) => {
      const state = configuredView()
      if (invalid === 'missing') {
        delete state.replyHandling
      }
      if (invalid === 'unknown-bridge') {
        state.replyHandling = {
          ...state.replyHandling!,
          bridge: 'unrecognized'
        } as unknown as TelegramReplyHandling
      }
      if (invalid === 'unknown-policy') {
        state.replyHandling = {
          ...state.replyHandling!,
          policy: 'automatic'
        } as unknown as TelegramReplyHandling
      }
      if (invalid === 'paused') {
        state.account.paused = true
      }
      if (invalid === 'disconnected-flag') {
        state.account.connected = false
      }
      state.account.drafts = ['awaiting-approval', 'approved'].map((status, index) => ({
        id: `draft${index}`,
        revision: 1,
        groupId: '-101',
        groupTitle: 'Client one',
        body: 'Draft',
        state: status as 'awaiting-approval' | 'approved',
        consentAllowed: true,
        createdAt: 10
      }))
      render(<TelegramAccountSection api={telegramViewApi(() => state)} />)
      expect(
        ((await screen.findByRole('button', { name: 'Approve draft' })) as HTMLButtonElement)
          .disabled
      ).toBe(true)
      expect(
        (screen.getByRole('button', { name: 'Send approved reply' }) as HTMLButtonElement).disabled
      ).toBe(true)
    }
  )
})
