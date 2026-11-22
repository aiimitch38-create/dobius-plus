import type {
  RuntimeMobileSessionClientTab,
  RuntimeMobileSessionTabsResult
} from '../../shared/runtime-types'
import type { CommandHandler, HandlerContext } from '../dispatch'
import { getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { getOptionalWorktreeSelector, resolveCurrentWorktreeSelector } from '../selectors'

async function getTabsWorktreeSelector(ctx: HandlerContext): Promise<string> {
  const { flags, cwd, client } = ctx
  if (flags.has('worktree')) {
    const value = flags.get('worktree')
    if (typeof value !== 'string' || value.length === 0) {
      throw new RuntimeClientError('invalid_argument', 'Missing value for --worktree.')
    }
    const explicit = await getOptionalWorktreeSelector(flags, 'worktree', cwd, client)
    if (explicit) {
      return explicit
    }
  }
  if (client.isRemote) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Remote tabs commands require --worktree (or --all) because the client cwd cannot identify a server worktree.'
    )
  }
  return await resolveCurrentWorktreeSelector(cwd, client)
}

function describeTab(tab: RuntimeMobileSessionClientTab): string {
  const active = tab.isActive ? '*' : ' '
  const detail =
    tab.type === 'terminal'
      ? tab.status === 'ready'
        ? tab.terminal
        : 'not running'
      : tab.type === 'browser'
        ? tab.url
        : tab.relativePath
  return `${active} ${tab.id}  ${tab.type.padEnd(8)}  ${tab.title}  (${detail})`
}

function formatSnapshot(snapshot: RuntimeMobileSessionTabsResult): string {
  if (snapshot.tabs.length === 0) {
    return `${snapshot.worktree}: no tabs`
  }
  return [`${snapshot.worktree}:`, ...snapshot.tabs.map(describeTab)].join('\n')
}

export const TABS_HANDLERS: Record<string, CommandHandler> = {
  'tabs list': async (ctx) => {
    if (ctx.flags.get('all') === true) {
      if (ctx.flags.has('worktree')) {
        throw new RuntimeClientError('invalid_argument', 'Choose either --all or --worktree.')
      }
      const result = await ctx.client.call<{ snapshots: RuntimeMobileSessionTabsResult[] }>(
        'session.tabs.listAll'
      )
      printResult(result, ctx.json, ({ snapshots }) =>
        snapshots.length === 0 ? 'No tabs.' : snapshots.map(formatSnapshot).join('\n\n')
      )
      return
    }
    const result = await ctx.client.call<RuntimeMobileSessionTabsResult>('session.tabs.list', {
      worktree: await getTabsWorktreeSelector(ctx)
    })
    printResult(result, ctx.json, formatSnapshot)
  },
  'tabs activate': async (ctx) => {
    const tabId = getRequiredStringFlag(ctx.flags, 'tab')
    const result = await ctx.client.call<RuntimeMobileSessionTabsResult>('session.tabs.activate', {
      worktree: await getTabsWorktreeSelector(ctx),
      tabId
    })
    printResult(result, ctx.json, (snapshot) => `Activated ${tabId} in ${snapshot.worktree}.`)
  }
}
