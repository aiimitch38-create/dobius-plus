import { useCallback, useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { toast } from 'sonner'
import { useConfirmationDialog } from '@/components/confirmation-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useDetectedAgents } from '@/hooks/useDetectedAgents'
import { translate } from '@/i18n/i18n'
import { AgentIcon, getAgentLabel } from '@/lib/agent-catalog'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import type { BoardCardOf } from '@/store/slices/board'
import { isConsoleAccountAgent, pinnedAccountMismatch } from '../../../../../shared/console-account'
import { isTuiAgent } from '../../../../../shared/tui-agent-config'
import type { TuiAgent } from '../../../../../shared/types'
import {
  BOARD_MENU_CONTENT_CLASS,
  BOARD_MENU_ROW_CLASS,
  BOARD_MENU_SEPARATOR_CLASS
} from '../board-chrome/board-surface-classes'
import { consoleDeliveryState } from '../board-delivery/board-delivery'
import { restartConsole } from '../board-delivery/console-lifecycle'
import { canPinConsoleAccount, resolvePinnedAgentCommand } from './console-account-launch'
import {
  buildConsoleAccountOptions,
  pinnedAccountEmail,
  type ConsoleAccountsSnapshot
} from './console-account-options'

type Props = { worktreeId: string; card: BoardCardOf<'console'> }
type Target = { agent: TuiAgent; accountId: string | null }

const LABEL_CLASS = 'px-2 pt-1 pb-0.5 text-[11px] font-semibold text-[var(--board-text-muted)]'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function useWorktreeConnectionId(worktreeId: string): string | null | undefined {
  return useAppStore((s) => {
    const worktree = Object.values(s.worktreesByRepo ?? {})
      .flat()
      .find((w) => w.id === worktreeId)
    if (!worktree) {
      return undefined
    }
    return s.repos?.find((r) => r.id === worktree.repoId)?.connectionId ?? null
  })
}

/** Header badge: shows the console's agent + account; picking another relaunches in place. */
export function ConsoleAccountBadge({ worktreeId, card }: Props): React.JSX.Element {
  const confirm = useConfirmationDialog()
  const { detectedIds } = useDetectedAgents(useWorktreeConnectionId(worktreeId))
  const disabled = useAppStore((s) => s.settings?.disabledTuiAgents ?? [])
  const [snapshot, setSnapshot] = useState<ConsoleAccountsSnapshot>({ claude: null, codex: null })

  const loadAccounts = useCallback(() => {
    void Promise.all([
      window.api.claudeAccounts.list().catch(() => null),
      window.api.codexAccounts.list().catch(() => null)
    ]).then(([claude, codex]) => setSnapshot({ claude, codex }))
  }, [])

  // Why: a pinned badge names its account without waiting for the menu to open.
  useEffect(() => {
    if (card.accountId) {
      loadAccounts()
    }
  }, [card.accountId, loadAccounts])

  const agentLabel = isTuiAgent(card.agentKind) ? getAgentLabel(card.agentKind) : card.agentKind
  const pinnedEmail = pinnedAccountEmail(snapshot, card.agentKind, card.accountId)
  const accountText = card.accountId
    ? (pinnedEmail ?? translate('board.console.accountPinned', 'Separate account'))
    : translate('board.console.accountDefault', 'Default account')
  const detected = (detectedIds ?? []).filter((id) => !disabled.includes(id))
  const accountOptions = canPinConsoleAccount(worktreeId, 'claude')
    ? buildConsoleAccountOptions({
        snapshot,
        detected,
        currentAgent: card.agentKind,
        currentAccountId: card.accountId
      })
    : []

  const relaunch = async (target: Target): Promise<void> => {
    const verb = translate('board.console.relaunch', 'Relaunch')
    const state = consoleDeliveryState(card.tabId)
    const busy = state === 'working' || state === 'waiting' || state === 'blocked'
    const ok =
      !busy ||
      (await confirm({
        title: translate('board.console.restartTitle', '{{verb}} {{name}}?', {
          verb,
          name: card.title
        }),
        description: translate(
          'board.console.restartBody',
          'It is working right now; its current turn will stop.'
        ),
        confirmLabel: verb,
        confirmVariant: 'destructive'
      }))
    if (!ok) {
      return
    }
    if (!target.accountId || !isConsoleAccountAgent(target.agent)) {
      restartConsole(worktreeId, card, target.agent, { accountId: null })
      return
    }
    try {
      const pinned = await resolvePinnedAgentCommand(worktreeId, target.agent, target.accountId)
      restartConsole(worktreeId, card, target.agent, {
        agentCommandOverride: pinned.command,
        accountId: target.accountId
      })
      if (!pinned.launch.signedIn) {
        toast.message(
          translate(
            'board.console.accountFirstSignIn',
            'First launch on {{email}}: sign in once inside this console. Later launches stay signed in.',
            { email: pinned.launch.accountEmail }
          )
        )
      } else if (pinnedAccountMismatch(pinned.launch)) {
        toast.warning(
          translate(
            'board.console.accountMismatch',
            'This console is signed in as {{actual}}, not {{expected}}. Run /login inside it to switch.',
            { actual: pinned.launch.signedInEmail ?? '', expected: pinned.launch.accountEmail }
          )
        )
      }
    } catch (error) {
      toast.error(
        translate(
          'board.console.accountRelaunchFailed',
          'Could not relaunch on that account: {{reason}}',
          { reason: errorText(error) }
        )
      )
    }
  }

  const row = (key: string, label: string, current: boolean, target: Target): React.JSX.Element => (
    <DropdownMenuItem
      key={key}
      disabled={current}
      onSelect={() => void relaunch(target)}
      className={BOARD_MENU_ROW_CLASS}
    >
      <AgentIcon agent={target.agent} size={14} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {current && <Check aria-hidden />}
    </DropdownMenuItem>
  )

  return (
    <DropdownMenu onOpenChange={(open) => open && loadAccounts()}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-board-card-control
          onPointerDown={(e) => e.stopPropagation()}
          title={translate('board.console.agentAccountHint', '{{agent}} · {{account}}', {
            agent: agentLabel,
            account: accountText
          })}
          className={cn(
            'flex max-w-[180px] items-center gap-1.5 rounded-full border border-[var(--board-chip-border)] bg-[var(--board-chip)] px-2 py-0.5 text-[11px] font-medium text-[var(--board-text-muted)] hover:text-[var(--board-text)]',
            card.accountId && 'text-[var(--board-text)]'
          )}
        >
          <AgentIcon agent={isTuiAgent(card.agentKind) ? card.agentKind : null} size={12} />
          <span className="truncate">{card.accountId ? accountText : agentLabel}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="bottom"
        sideOffset={4}
        data-surface="board"
        onPointerDown={(e) => e.stopPropagation()}
        className={cn(BOARD_MENU_CONTENT_CLASS, 'max-h-[420px] min-w-[240px] overflow-y-auto')}
      >
        <DropdownMenuLabel className={LABEL_CLASS}>
          {translate('board.console.agentSection', 'Agent')}
        </DropdownMenuLabel>
        {detected.map((agent) =>
          row(`agent:${agent}`, getAgentLabel(agent), agent === card.agentKind && !card.accountId, {
            agent,
            accountId: null
          })
        )}
        {accountOptions.length > 0 && (
          <>
            <DropdownMenuSeparator className={BOARD_MENU_SEPARATOR_CLASS} />
            <DropdownMenuLabel className={LABEL_CLASS}>
              {translate('board.console.accountSection', 'Account')}
            </DropdownMenuLabel>
            {accountOptions.map((option) =>
              row(
                `account:${option.agent}:${option.accountId ?? 'default'}`,
                option.accountId
                  ? `${getAgentLabel(option.agent)} · ${option.email ?? ''}`
                  : translate(
                      'board.console.accountDefaultRow',
                      '{{agent}} · Default ({{email}})',
                      {
                        agent: getAgentLabel(option.agent),
                        email:
                          option.email ?? translate('board.console.accountSystem', 'system login')
                      }
                    ),
                option.current,
                { agent: option.agent, accountId: option.accountId }
              )
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
