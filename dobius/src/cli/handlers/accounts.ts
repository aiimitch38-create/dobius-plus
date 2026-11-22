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
    const result = await client.call<AccountsSnapshot>('accounts.summary')
    printResult(result, json, formatAccounts)
  },
  'accounts use': async ({ flags, client, json }) => {
    // Why has(): `--claude --codex system` leaves --claude without a value,
    // which must not quietly fall through to Codex.
    const given = (['claude', 'codex'] as const).filter((name) => flags.has(name))
    if (given.length !== 1) {
      throw new RuntimeClientError('invalid_argument', 'Pass exactly one of --claude or --codex')
    }
    const provider = given[0]
    const id = getOptionalStringFlag(flags, provider)?.trim()
    if (!id) {
      throw new RuntimeClientError(
        'invalid_argument',
        `--${provider} needs an account id from \`dobius accounts list\`, or system`
      )
    }
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
