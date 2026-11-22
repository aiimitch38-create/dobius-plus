import type { CommandHandler } from '../dispatch'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { getRequiredWorktreeSelector } from '../selectors'

const MAX_TITLE_CHARS = 120
const MAX_BODY_CHARS = 1000
const VIEWS = ['board', 'tasks', 'settings', 'worktree'] as const
type View = (typeof VIEWS)[number]

type SettingsReadResult = { settings: Record<string, unknown>; settable: string[] }

/** JSON when it parses (true, null, ["a"], 3), otherwise the plain text. */
export function parseSettingValue(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

export function formatSettings(result: SettingsReadResult, key?: string): string {
  const entries = Object.entries(result.settings).filter(([name]) => !key || name === key)
  if (key && entries.length === 0) {
    return `No setting named "${key}".`
  }
  const lines = entries.map(([name, value]) => {
    const mark = result.settable.includes(name) ? '' : '  (change in the app)'
    return `${name}: ${JSON.stringify(value)}${mark}`
  })
  return lines.join('\n')
}

function getView(flags: Map<string, string | boolean>): View {
  const view = getRequiredStringFlag(flags, 'view')
  if (!(VIEWS as readonly string[]).includes(view)) {
    throw new RuntimeClientError('invalid_argument', `View must be ${VIEWS.join(', ')}`)
  }
  return view as View
}

export const APP_UI_HANDLERS: Record<string, CommandHandler> = {
  'settings get': async ({ flags, client, json }) => {
    const key = getOptionalStringFlag(flags, 'key')
    const result = await client.call<SettingsReadResult>('settings.read')
    printResult(result, json, (value) => formatSettings(value, key))
  },
  'settings set': async ({ flags, client, json }) => {
    const key = getRequiredStringFlag(flags, 'key')
    const raw = flags.get('value')
    if (typeof raw !== 'string') {
      throw new RuntimeClientError('invalid_argument', 'Missing the value to set')
    }
    const result = await client.call<{ key: string; value: unknown }>('settings.set', {
      key,
      value: parseSettingValue(raw)
    })
    printResult(result, json, (value) => `${value.key} is now ${JSON.stringify(value.value)}.`)
  },
  'view open': async ({ flags, client, cwd, json }) => {
    const view = getView(flags)
    if (view === 'worktree') {
      const worktree = await getRequiredWorktreeSelector(flags, 'worktree', cwd, client)
      const result = await client.call<{ worktreeId: string }>('worktree.activate', { worktree })
      printResult(result, json, (value) => `Opened worktree ${value.worktreeId}.`)
      return
    }
    if (flags.has('worktree')) {
      throw new RuntimeClientError('invalid_argument', '--worktree only goes with the worktree view')
    }
    const result = await client.call<{ view: string }>('ui.openView', { view })
    printResult(result, json, (value) => `Showing ${value.view}.`)
  },
  notify: async ({ flags, client, json }) => {
    const title = getRequiredStringFlag(flags, 'title')
    const body = getRequiredStringFlag(flags, 'body')
    if (title.length > MAX_TITLE_CHARS || body.length > MAX_BODY_CHARS) {
      throw new RuntimeClientError(
        'invalid_argument',
        `Keep the title under ${MAX_TITLE_CHARS} characters and the text under ${MAX_BODY_CHARS}`
      )
    }
    const result = await client.call<{ shown: boolean }>('nativeUx.showNotification', {
      title,
      body
    })
    printResult(result, json, (value) =>
      value.shown ? 'Notification shown.' : 'Notifications are not available on this computer.'
    )
  }
}
