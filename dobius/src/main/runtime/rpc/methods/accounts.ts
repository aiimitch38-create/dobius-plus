import { z } from 'zod'
import { defineMethod, defineStreamingMethod, type RpcAnyMethod, type RpcContext } from '../core'
import { confirmText, describeCaller, type ConfirmationGate } from './confirm-gate'
import { appConfirmationGate } from './crew-confirm'

// Why: monotonically increasing per-process counter avoids the Date.now()
// collision that fired when two near-simultaneous accounts.subscribe calls
// collided on the same millisecond and one evicted the other through
// registerSubscriptionCleanup's existing-key eviction path.
let accountsSubscriptionSeq = 0

const SelectAccountParams = z.object({
  accountId: z
    .union([z.string().min(1, 'Missing accountId'), z.null()])
    .transform((v) => (v === null ? null : v))
})

const RemoveAccountParams = z.object({
  accountId: z.string().min(1, 'Missing accountId')
})

const AccountsUnsubscribeParams = z.object({
  subscriptionId: z
    .unknown()
    .transform((value) => (typeof value === 'string' && value.length > 0 ? value : ''))
    .pipe(z.string().min(1, 'Missing subscriptionId'))
})

type Provider = 'claude' | 'codex'

/**
 * Asks Carson in the app before the command line switches an account.
 * Why: the account decides who is billed and whose limits new agents use.
 * A paired phone is not asked: switching from the phone is Carson's own tap,
 * and nobody may be at the desktop to click.
 */
async function confirmAccountSwitch(
  gate: ConfirmationGate,
  provider: Provider,
  accountId: string | null,
  ctx: RpcContext
): Promise<void> {
  if (ctx.clientKind === 'mobile') {
    return
  }
  const snapshot = ctx.runtime.getAccountsSnapshot()
  const account = snapshot[provider].accounts.find((entry) => entry.id === accountId)
  const name = provider === 'claude' ? 'Claude' : 'Codex'
  const target =
    accountId === null
      ? 'the account signed in outside Dobius+'
      : account
        ? confirmText(account.email, 'email')
        : `account ${confirmText(accountId, 'id')}`
  await gate(
    {
      title: `Switch the ${name} account?`,
      message: `New ${name} agents will use ${target}, and its plan is billed.`,
      detail: describeCaller(ctx),
      confirmLabel: 'Switch'
    },
    ctx
  )
}

// Why: bridges the desktop ClaudeAccountService / CodexAccountService /
// RateLimitService into the mobile WebSocket RPC. Read + switch + remove
// only — interactive add/re-auth flows spawn `claude login` / `codex login`
// PTYs that need a desktop browser, so they intentionally remain
// desktop-only. See plan in spec doc for issue #1438.
export function buildAccountMethods(gate: ConfirmationGate): readonly RpcAnyMethod[] {
  return [
  defineMethod({
    name: 'accounts.list',
    params: null,
    handler: async (_params, { runtime }) => {
      // Why: ensure the snapshot reflects the latest provider state before
      // returning. Desktop polling pauses when the window is unfocused and
      // inactive-account caches only fill on AccountsPane open, so without
      // this the mobile UI would render stale nulls / zeroes.
      await runtime.refreshAccountsForMobile()
      return runtime.getAccountsSnapshot()
    }
  }),
  defineMethod({
    name: 'accounts.selectClaude',
    params: SelectAccountParams,
    handler: async (params, ctx) => {
      await confirmAccountSwitch(gate, 'claude', params.accountId, ctx)
      return ctx.runtime.selectClaudeAccount(params.accountId)
    }
  }),
  defineMethod({
    name: 'accounts.selectCodex',
    params: SelectAccountParams,
    handler: async (params, ctx) => {
      await confirmAccountSwitch(gate, 'codex', params.accountId, ctx)
      return ctx.runtime.selectCodexAccount(params.accountId)
    }
  }),
  defineMethod({
    name: 'accounts.removeClaude',
    params: RemoveAccountParams,
    handler: async (params, { runtime }) => runtime.removeClaudeAccount(params.accountId)
  }),
  defineMethod({
    name: 'accounts.removeCodex',
    params: RemoveAccountParams,
    handler: async (params, { runtime }) => runtime.removeCodexAccount(params.accountId)
  }),
  // Why: streaming counterpart so mobile usage bars refresh in place when the
  // desktop's 5-minute rate-limit poll completes or when the user switches
  // accounts on either side. Mirrors the notifications.subscribe pattern.
  defineStreamingMethod({
    name: 'accounts.subscribe',
    params: null,
    handler: async (_params, { runtime, connectionId }, emit) => {
      await new Promise<void>((resolve) => {
        const unsubscribe = runtime.onAccountsChanged((snapshot) => {
          emit({ type: 'snapshot', snapshot })
        })

        // Why: scope the id by connectionId so two sockets from the same
        // device (host + accounts screen) cannot evict each other through
        // registerSubscriptionCleanup's "existing key" branch, and append a
        // per-process counter so two concurrent subscribes on the same
        // socket also can't collide.
        const seq = ++accountsSubscriptionSeq
        const subscriptionId = `accounts-${connectionId ?? 'inproc'}-${seq}`
        runtime.registerSubscriptionCleanup(
          subscriptionId,
          () => {
            unsubscribe()
            emit({ type: 'end' })
            resolve()
          },
          connectionId
        )

        // Why: emit the current snapshot synchronously so the phone has
        // something to render immediately, then kick a forced refresh that
        // will broadcast a fresh snapshot through the listener once each
        // provider fetch completes.
        emit({ type: 'ready', subscriptionId, snapshot: runtime.getAccountsSnapshot() })
        void runtime.refreshAccountsForMobile()
      })
    }
  }),
  defineMethod({
    name: 'accounts.unsubscribe',
    params: AccountsUnsubscribeParams,
    handler: async (params, { runtime }) => {
      runtime.cleanupSubscription(params.subscriptionId)
      return { unsubscribed: true }
    }
  })
]
}

export const ACCOUNT_METHODS: readonly RpcAnyMethod[] = buildAccountMethods(appConfirmationGate)
