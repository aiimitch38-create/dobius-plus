// Settings and window navigation over RPC (CLI `dobius settings get|set`,
// `dobius view open`).
// - settings.read is the same view as settings.get with every agent command,
//   argument and environment value hidden (only whether one is set shows).
// - settings.set changes ONE key from a fixed allowlist. Agent launch args and
//   env (secrets, sandbox flags), agent status hooks (terminal delivery relies
//   on them), provider account ids and everything outside the client settings
//   (Pause crew, agent sandbox, auto-fix, live voice) are not reachable here.
// - ui.openView asks the app's main window to show the Board, Tasks or
//   Settings, the same events its menu and shortcuts send.
import { BrowserWindow } from 'electron'
import { z, type ZodType } from 'zod'
import { isTaskProvider } from '../../../../shared/task-providers'
import { isTuiAgent } from '../../../../shared/tui-agent-config'
import { normalizeDisabledTuiAgents } from '../../../../shared/tui-agent-selection'
import type { DobiusRuntimeService } from '../../dobius-runtime'
import { publicRateLimitState } from '../../../ipc/usage-access'
import { defineMethod, type RpcMethod } from '../core'

const TaskProvider = z.custom<string>(isTaskProvider, { message: 'Unknown task provider' })
const IdList = z.array(z.string().min(1).max(256)).max(200)

/** The only keys `dobius settings set` may change, each with its value check. */
export const SETTABLE_SETTING_SCHEMAS = {
  defaultTuiAgent: z.union([
    z.literal('blank'),
    z.null(),
    z.custom<string>(isTuiAgent, { message: 'Unknown agent' })
  ]),
  disabledTuiAgents: z
    .array(z.custom<string>(isTuiAgent, { message: 'Unknown agent' }))
    .max(50)
    .transform((value) => normalizeDisabledTuiAgents(value)),
  defaultTaskSource: TaskProvider,
  visibleTaskProviders: z.array(TaskProvider).max(20),
  defaultTaskViewPreset: z.enum(['issues', 'my-issues', 'prs', 'my-prs', 'review', 'all']),
  experimentalNewWorktreeCardStyle: z.boolean(),
  compactWorktreeCards: z.boolean(),
  defaultRepoSelection: IdList.nullable(),
  defaultLinearTeamSelection: IdList.nullable()
} satisfies Record<string, ZodType>

export type SettableSettingKey = keyof typeof SETTABLE_SETTING_SCHEMAS
export const SETTABLE_SETTING_KEYS = Object.keys(SETTABLE_SETTING_SCHEMAS) as SettableSettingKey[]

function isSettableKey(key: string): key is SettableSettingKey {
  return Object.hasOwn(SETTABLE_SETTING_SCHEMAS, key)
}

const SettingsSet = z.object({ key: z.string().min(1).max(100), value: z.unknown() }).strict()

const HIDDEN = '[hidden]'

// Why whole values: a command line can hold a key in any shape (quoted
// flags, JSON, env assignments), so no pattern can promise to find it. The
// command line only says whether an override exists; read it in the app.
function hideValues(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = entry === '' || entry === undefined || entry === null ? '' : HIDDEN
    }
  }
  return out
}

/** settings.get with every agent command, argument and env value hidden. */
export function redactClientSettings(
  settings: ReturnType<DobiusRuntimeService['getClientSettings']>
): Record<string, unknown> {
  const env: Record<string, Record<string, string>> = {}
  for (const [agent, vars] of Object.entries(settings.agentDefaultEnv ?? {})) {
    env[agent] = hideValues(vars)
  }
  return {
    ...settings,
    agentCmdOverrides: hideValues(settings.agentCmdOverrides),
    agentDefaultArgs: hideValues(settings.agentDefaultArgs),
    agentDefaultEnv: env
  }
}

export const VIEW_CHANNELS = {
  board: 'ui:openWorkspaceBoard',
  tasks: 'ui:openTasks',
  settings: 'ui:openSettings'
} as const

const OpenView = z.object({ view: z.enum(['board', 'tasks', 'settings']) }).strict()

export type AppUiDeps = {
  /** The app's main window (the runtime's authoritative window), or null. */
  mainWindow: (runtime: DobiusRuntimeService) => BrowserWindow | null
}

const LIVE_DEPS: AppUiDeps = {
  mainWindow: (runtime) => {
    const id = runtime.getStatus().authoritativeWindowId
    const win = id === null ? null : BrowserWindow.fromId(id)
    return win && !win.isDestroyed() && !win.webContents.isDestroyed() ? win : null
  }
}

export function buildAppUiMethods(deps: AppUiDeps = LIVE_DEPS): RpcMethod[] {
  return [
    defineMethod({
      name: 'settings.read',
      params: null,
      handler: (_params, { runtime }) => ({
        settings: redactClientSettings(runtime.getClientSettings()),
        settable: SETTABLE_SETTING_KEYS
      })
    }),
    defineMethod({
      name: 'settings.set',
      params: SettingsSet,
      handler: (params, { runtime }) => {
        if (!isSettableKey(params.key)) {
          throw new Error(
            `'${params.key}' cannot be changed from the command line. Allowed: ${SETTABLE_SETTING_KEYS.join(', ')}. Change other settings in the app.`
          )
        }
        const parsed = SETTABLE_SETTING_SCHEMAS[params.key].safeParse(params.value)
        if (!parsed.success) {
          throw new Error(
            `Invalid value for ${params.key}: ${parsed.error.issues[0]?.message ?? 'not allowed'}`
          )
        }
        const updated = runtime.updateClientSettings({
          [params.key]: parsed.data
        } as Parameters<DobiusRuntimeService['updateClientSettings']>[0])
        return { key: params.key, value: (updated as Record<string, unknown>)[params.key] }
      }
    }),
    defineMethod({
      // Why not accounts.list: that snapshot carries each provider's raw
      // `/usage` CLI screen text (cliOutput), which can hold account details.
      name: 'accounts.summary',
      params: null,
      handler: async (_params, { runtime }) => {
        await runtime.refreshAccountsForMobile()
        const snapshot = runtime.getAccountsSnapshot()
        return { ...snapshot, rateLimits: publicRateLimitState(snapshot.rateLimits) }
      }
    }),
    defineMethod({
      name: 'ui.openView',
      params: OpenView,
      handler: (params, { runtime }) => {
        const win = deps.mainWindow(runtime)
        if (!win) {
          throw new Error('The Dobius+ window is not open. Run `dobius open` first.')
        }
        if (win.isMinimized()) {
          win.restore()
        }
        win.show()
        win.focus()
        win.webContents.send(VIEW_CHANNELS[params.view])
        return { view: params.view, shown: true as const }
      }
    })
  ]
}

export const APP_UI_METHODS: RpcMethod[] = buildAppUiMethods()
