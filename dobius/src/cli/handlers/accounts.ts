import type {
  ClaudeRateLimitAccountsState,
  CodexRateLimitAccountsState
} from '../../shared/types'
import type { CommandHandler } from '../dispatch'
import { getOptionalStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'

type AccountsSnapshot = {
  claude: ClaudeRateLimitAccountsState
  codex: CodexRateLimitAccountsState
}

function section(
  name: string,
  state: { accounts: { id: string; email: string }[]; activeAccountId: string | null }
): string[] {
  const lines = [`${name}${state.activeAccountId ? '' : ' (using the system sign-in)'}:`]
  if (state.accounts.length === 0) {
    lines.push('  no accounts added in Dobius+')
  }
  for (const account of state.accounts) {
    const mark = account.id === state.activeAccountId ? '* ' : '  '
    lines.push(`${mark}${account.id}  ${account.email}`)
  }
  return lines
}

export function formatAccounts(snapshot: AccountsSnapshot): string {
  return [...section('Claude', snapshot.claude), ...section('Codex', snapshot.codex)].join('\n')
}

export const ACCOUNT_HANDLERS: Record<string, CommandHandler> = {
  'accounts list': async ({ client, json }) => {
    const result = await client.call<AccountsSnapshot>('accounts.list')
    printResult(result, json, formatAccounts)
  },
  'accounts use': async ({ flags, client, json }) => {
    const claude = getOptionalStringFlag(flags, 'claude')
    const codex = getOptionalStringFlag(flags, 'codex')
    if (Boolean(claude) === Boolean(codex)) {
      throw new RuntimeClientError('invalid_argument', 'Pass exactly one of --claude or --codex')
    }
    const provider = claude ? 'claude' : 'codex'
    const id = (claude ?? codex) as string
    const accountId = id === 'system' ? null : id
    const result = await client.call<unknown>(
      provider === 'claude' ? 'accounts.selectClaude' : 'accounts.selectCodex',
      { accountId }
    )
    printResult(result, json, () =>
      `${provider === 'claude' ? 'Claude' : 'Codex'} now uses ${accountId ? `account ${accountId}` : 'the system sign-in'}.`
    )
  }
}
