import React, { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, KeyRound, Loader2, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { AgentIcon, getAgentLabel } from '@/lib/agent-catalog'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  CONSOLE_ACCOUNT_AGENTS,
  pinnedAccountMismatch,
  type ConsoleAccountAgent
} from '../../../../../../shared/console-account'
import type {
  ClaudeRateLimitAccountsState,
  CodexRateLimitAccountsState
} from '../../../../../../shared/types'
import type { ConsoleAccountsSnapshot } from '../../console-card/console-account-options'
import { canPinConsoleAccount } from '../../console-card/console-account-launch'
import { useAppStore } from '@/store'
import { BOARD_MONO_CLASS } from '../board-surface-classes'
import { accountProfileRows, NoBoardError, openAccountLane } from './board-usage-accounts'

const ROUND_BUTTON =
  'flex size-7 items-center justify-center rounded-full bg-[var(--board-panel-2)] text-[var(--board-text)] hover:bg-[var(--board-panel-border)]'
const LABEL_CLASS =
  'text-[10px] font-semibold tracking-[0.12em] text-[var(--board-text-muted)] uppercase'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type Busy = { kind: 'select' | 'lane'; id: string | null } | { kind: 'connect' } | null

function DisabledHint({
  hint,
  children
}: {
  hint: string
  children: React.ReactElement
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent side="top">{hint}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Sign-in profiles for the account-capable agents (Claude, Codex): switch the
 * default, open a lane on a profile, or connect another account. Real actions
 * only; anything without a backend is disabled with a tooltip.
 */
export function BoardUsageAccountsView({
  initialAgent,
  onBack,
  onClose
}: {
  initialAgent: ConsoleAccountAgent
  onBack: () => void
  onClose: () => void
}): React.JSX.Element {
  const [agent, setAgent] = useState<ConsoleAccountAgent>(initialAgent)
  const [snapshot, setSnapshot] = useState<ConsoleAccountsSnapshot>({ claude: null, codex: null })
  const [busy, setBusy] = useState<Busy>(null)
  const [connectName, setConnectName] = useState('')
  const worktreeId = useAppStore((s) => s.activeWorktreeId)
  const isMac = navigator.userAgent.includes('Mac')
  const label = getAgentLabel(agent)

  const loadAccounts = useCallback(() => {
    void Promise.all([
      window.api.claudeAccounts.list().catch(() => null),
      window.api.codexAccounts.list().catch(() => null)
    ]).then(([claude, codex]) =>
      setSnapshot({
        claude: claude as ClaudeRateLimitAccountsState | null,
        codex: codex as CodexRateLimitAccountsState | null
      })
    )
  }, [])

  useEffect(() => {
    loadAccounts()
  }, [loadAccounts])

  const rows = accountProfileRows(snapshot, agent)
  const canOpenLane = worktreeId ? canPinConsoleAccount(worktreeId, agent) : false

  const selectProfile = async (accountId: string | null): Promise<void> => {
    setBusy({ kind: 'select', id: accountId })
    try {
      const api = agent === 'claude' ? window.api.claudeAccounts : window.api.codexAccounts
      await api.select({ accountId, runtime: 'host', wslDistro: null })
      loadAccounts()
    } catch (error) {
      toast.error(
        translate('board.usagePanel.accounts.switchFailed', 'Could not switch account: {{reason}}', {
          reason: errorText(error)
        })
      )
    } finally {
      setBusy(null)
    }
  }

  const openLane = async (accountId: string | null): Promise<void> => {
    setBusy({ kind: 'lane', id: accountId })
    try {
      const { launch } = await openAccountLane(agent, accountId)
      if (launch && !launch.signedIn) {
        toast.message(
          translate(
            'board.console.accountFirstSignIn',
            'First launch on {{email}}: sign in once inside this console. Later launches stay signed in.',
            { email: launch.accountEmail }
          )
        )
      } else if (launch && pinnedAccountMismatch(launch)) {
        toast.warning(
          translate(
            'board.console.accountMismatch',
            'This console is signed in as {{actual}}, not {{expected}}. Run /login inside it to switch.',
            { actual: launch.signedInEmail ?? '', expected: launch.accountEmail }
          )
        )
      }
      onClose()
    } catch (error) {
      toast.error(
        error instanceof NoBoardError
          ? translate('board.usagePanel.accounts.noBoard', 'Open a workspace board first.')
          : translate('board.usagePanel.accounts.laneFailed', 'Could not open a lane: {{reason}}', {
              reason: errorText(error)
            })
      )
    } finally {
      setBusy(null)
    }
  }

  const connect = async (): Promise<void> => {
    setBusy({ kind: 'connect' })
    try {
      const api = agent === 'claude' ? window.api.claudeAccounts : window.api.codexAccounts
      await api.add({ runtime: 'host', wslDistro: null })
      setConnectName('')
      loadAccounts()
    } catch (error) {
      toast.error(
        translate('board.usagePanel.accounts.connectFailed', 'Could not connect: {{reason}}', {
          reason: errorText(error)
        })
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <div data-testid="board-usage-accounts">
      <div className="flex items-center gap-2 px-5 pt-4 pb-3">
        <button
          type="button"
          onClick={onBack}
          aria-label={translate('board.usagePanel.accounts.back', 'Back to usage')}
          className="flex items-center gap-0.5 text-[17px] font-bold text-[var(--board-text)]"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {translate('board.usagePanel.accounts.title', 'accounts')}
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          {CONSOLE_ACCOUNT_AGENTS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              onClick={() => setAgent(candidate)}
              aria-pressed={candidate === agent}
              title={getAgentLabel(candidate)}
              className={cn(
                'flex size-7 items-center justify-center rounded-[8px] border',
                candidate === agent
                  ? 'border-[var(--board-accent)] bg-[var(--board-accent-tint)]'
                  : 'border-[var(--board-panel-border)] bg-[var(--board-panel)] hover:bg-[var(--board-panel-2)]'
              )}
            >
              <AgentIcon agent={candidate} size={15} />
            </button>
          ))}
          <button
            type="button"
            onClick={onClose}
            aria-label={translate('board.usagePanel.close', 'Close')}
            className={cn(ROUND_BUTTON, 'ml-1')}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>

      <div className="space-y-3 px-5 pb-4">
        {agent === 'claude' && isMac ? (
          <div className="flex gap-2.5 rounded-[12px] bg-[var(--board-code-surface)] p-3 text-[11px] leading-[1.45] text-[var(--board-text-muted)]">
            <KeyRound className="mt-[1px] size-3.5 shrink-0" aria-hidden />
            <span>
              {translate(
                'board.usagePanel.accounts.keychainNote',
                'On this Mac, Claude keeps sign-ins in the system Keychain, which profiles cannot fully isolate yet. After switching, verify the account with /status inside the lane.'
              )}
            </span>
          </div>
        ) : null}

        <div className="space-y-2">
          {rows.map((row) => {
            const id = row.accountId ?? 'system'
            const selecting = busy?.kind === 'select' && busy.id === row.accountId
            const opening = busy?.kind === 'lane' && busy.id === row.accountId
            return (
              <div
                key={id}
                data-testid={`board-usage-profile-${id}`}
                className={cn(
                  'flex items-center gap-3 rounded-[14px] border px-3.5 py-3',
                  row.active
                    ? 'border-[var(--board-accent)] bg-[var(--board-panel)]'
                    : 'border-[var(--board-panel-border)] bg-[var(--board-panel)]'
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-[var(--board-text)]">
                    {row.email ??
                      translate('board.usagePanel.accounts.systemLogin', 'Your sign-in')}
                  </p>
                  <p className="text-[11px] text-[var(--board-text-muted)]">
                    {row.active
                      ? translate(
                          'board.usagePanel.accounts.poweringLanes',
                          'Powering new {{provider}} lanes',
                          { provider: label }
                        )
                      : translate('board.usagePanel.accounts.savedProfile', 'Saved profile')}
                  </p>
                </div>
                {row.active ? (
                  <span className="flex items-center gap-1 rounded-full bg-[var(--board-accent-tint)] px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-[var(--board-accent)] uppercase">
                    <span className="size-1.5 rounded-full bg-[var(--board-accent)]" aria-hidden />
                    {translate('board.usagePanel.accounts.active', 'Active')}
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void selectProfile(row.accountId)}
                    className="rounded-full border border-[var(--board-panel-border)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--board-text)] hover:bg-[var(--board-panel-2)] disabled:opacity-50"
                  >
                    {selecting ? (
                      <Loader2 className="size-3 animate-spin" aria-hidden />
                    ) : (
                      translate('board.usagePanel.accounts.makeActive', 'Make active')
                    )}
                  </button>
                )}
                {canOpenLane || row.accountId === null ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void openLane(row.accountId)}
                    title={translate(
                      'board.usagePanel.accounts.openLaneHint',
                      'Drops a {{provider}} lane on the board using this sign-in.',
                      { provider: label }
                    )}
                    className="rounded-full bg-[var(--board-accent)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--board-accent-fg)] disabled:opacity-50"
                  >
                    {opening ? (
                      <Loader2 className="size-3 animate-spin" aria-hidden />
                    ) : (
                      translate('board.usagePanel.accounts.openLane', 'Open lane')
                    )}
                  </button>
                ) : null}
              </div>
            )
          })}

          <DisabledHint
            hint={translate(
              'board.usagePanel.accounts.saveProfileUnavailable',
              'Not available yet: Dobius cannot copy the system sign-in into a profile. Use Connect to sign in to a profile instead.'
            )}
          >
            <button
              type="button"
              disabled
              className="flex w-full items-center justify-between rounded-[14px] border border-dashed border-[var(--board-panel-border)] px-3.5 py-2.5 text-[12px] text-[var(--board-text-muted)] opacity-70"
            >
              {translate(
                'board.usagePanel.accounts.saveProfile',
                'Save your current sign-in as a profile'
              )}
              <Plus className="size-3.5" aria-hidden />
            </button>
          </DisabledHint>
        </div>

        <div className="space-y-2 border-t border-[var(--board-panel-border)] pt-3">
          <p className={LABEL_CLASS}>
            {translate('board.usagePanel.accounts.connectAnother', 'Connect another account')}
          </p>
          <div className="flex items-center gap-2">
            <DisabledHint
              hint={translate(
                'board.usagePanel.accounts.connectNameUnavailable',
                'Profiles are named by their sign-in email; a custom name is not stored yet.'
              )}
            >
              <Input
                value={connectName}
                onChange={(event) => setConnectName(event.target.value)}
                placeholder={translate(
                  'board.usagePanel.accounts.connectPlaceholder',
                  'e.g. Personal Max'
                )}
                disabled
                className="h-8 w-[220px] rounded-full text-[12px]"
              />
            </DisabledHint>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void connect()}
              className="flex h-8 items-center gap-1 rounded-full bg-[var(--board-accent)] px-3 text-[12px] font-semibold text-[var(--board-accent-fg)] disabled:opacity-50"
            >
              {busy?.kind === 'connect' ? (
                <Loader2 className="size-3 animate-spin" aria-hidden />
              ) : (
                <Plus className="size-3" aria-hidden />
              )}
              {translate('board.usagePanel.accounts.connect', 'Connect')}
            </button>
          </div>
          <p className={`${BOARD_MONO_CLASS} text-[10px] text-[var(--board-text-muted)]`}>
            {translate(
              'board.usagePanel.accounts.connectCaption',
              "Runs {{provider}}'s own sign-in (a browser window opens); the account appears here when it finishes.",
              { provider: label }
            )}
          </p>
        </div>
      </div>
    </div>
  )
}
