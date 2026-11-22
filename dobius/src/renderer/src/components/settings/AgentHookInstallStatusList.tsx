import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import {
  AGENT_HOOK_TARGETS,
  type AgentHookInstallState,
  type AgentHookInstallStatus,
  type AgentHookTarget
} from '../../../../shared/agent-hook-types'
import type { PreloadApi } from '../../../../preload/api-types'
import { AgentIcon, getAgentCatalog } from '@/lib/agent-catalog'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { Button } from '../ui/button'
import { SettingsBadge, SettingsSubsectionHeader } from './SettingsFormControls'

type AgentHooksApi = PreloadApi['agentHooks']

const STATUS_METHOD: Record<AgentHookTarget, keyof AgentHooksApi> = {
  claude: 'claudeStatus',
  openclaude: 'openClaudeStatus',
  codex: 'codexStatus',
  gemini: 'geminiStatus',
  antigravity: 'antigravityStatus',
  amp: 'ampStatus',
  cursor: 'cursorStatus',
  droid: 'droidStatus',
  'command-code': 'commandCodeStatus',
  grok: 'grokStatus',
  copilot: 'copilotStatus',
  hermes: 'hermesStatus',
  devin: 'devinStatus',
  kimi: 'kimiStatus'
}

export type AgentHookStatusLoader = () => Promise<AgentHookInstallStatus[]>

function errorStatus(agent: AgentHookTarget, reason: unknown): AgentHookInstallStatus {
  return {
    agent,
    state: 'error',
    configPath: '',
    managedHooksPresent: false,
    detail: reason instanceof Error ? reason.message : reason ? String(reason) : null
  }
}

export function createAgentHookStatusLoader(api: AgentHooksApi | null): AgentHookStatusLoader {
  return async () => {
    const results = await Promise.allSettled(
      AGENT_HOOK_TARGETS.map((agent) => {
        const read = api?.[STATUS_METHOD[agent]]
        if (typeof read !== 'function') {
          return Promise.reject(new Error(getUnavailableText()))
        }
        return read()
      })
    )
    return results.map((result, index) =>
      result.status === 'fulfilled'
        ? result.value
        : errorStatus(AGENT_HOOK_TARGETS[index], result.reason)
    )
  }
}

function getUnavailableText(): string {
  return translate(
    'auto.components.settings.AgentHookInstallStatusList.eebabd6f45',
    'Hook status is not available in this window.'
  )
}

function getStateLabel(state: AgentHookInstallState): string {
  switch (state) {
    case 'installed':
      return translate('auto.components.settings.AgentHookInstallStatusList.eb158c05a1', 'Installed')
    case 'partial':
      return translate(
        'auto.components.settings.AgentHookInstallStatusList.17597647d9',
        'Partly installed'
      )
    case 'not_installed':
      return translate(
        'auto.components.settings.AgentHookInstallStatusList.7d4147c2ea',
        'Not installed'
      )
    case 'error':
      return translate(
        'auto.components.settings.AgentHookInstallStatusList.80664f8df6',
        'Could not check'
      )
  }
}

function defaultLoader(): AgentHookStatusLoader {
  const api = typeof window === 'undefined' ? null : (window.api?.agentHooks ?? null)
  return createAgentHookStatusLoader(api)
}

export function AgentHookInstallStatusList({
  loadStatuses,
  reloadKey = 0
}: {
  loadStatuses?: AgentHookStatusLoader
  /** Bump after the hooks switch is saved so the list re-reads disk state. */
  reloadKey?: number
}): React.JSX.Element {
  const [statuses, setStatuses] = useState<AgentHookInstallStatus[] | null>(null)
  const [loading, setLoading] = useState(false)
  const loaderRef = useRef<AgentHookStatusLoader | null>(null)
  loaderRef.current = loadStatuses ?? loaderRef.current ?? defaultLoader()
  // Why: a later "Check again" must win over an earlier slow read, and an
  // unmounted pane must not receive a late result.
  const requestRef = useRef(0)

  const load = useCallback(async (): Promise<void> => {
    const request = ++requestRef.current
    setLoading(true)
    try {
      const next = await (loaderRef.current ?? defaultLoader())()
      if (requestRef.current === request) {
        setStatuses(next)
      }
    } catch (error) {
      if (requestRef.current === request) {
        setStatuses(AGENT_HOOK_TARGETS.map((agent) => errorStatus(agent, error)))
      }
    } finally {
      if (requestRef.current === request) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    void load()
    return () => {
      requestRef.current += 1
    }
  }, [load, reloadKey])

  const labels = new Map(getAgentCatalog().map((entry) => [entry.id, entry.label]))

  return (
    <div className="space-y-3" data-testid="agent-hook-install-status">
      <SettingsSubsectionHeader
        title={translate(
          'auto.components.settings.AgentHookInstallStatusList.df34aa74f8',
          'Hook install status'
        )}
        description={translate(
          'auto.components.settings.AgentHookInstallStatusList.7581ca3f93',
          'While the switch is on, Dobius+ installs these hooks each time it starts. To reinstall them now, turn the switch off and back on.'
        )}
        action={
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => void load()}
            disabled={loading}
            className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={cn('size-3', loading && 'animate-spin')} />
            {loading
              ? translate('auto.components.settings.AgentHookInstallStatusList.f35aa93b4a', 'Checking…')
              : translate(
                  'auto.components.settings.AgentHookInstallStatusList.5c6d64246c',
                  'Check again'
                )}
          </Button>
        }
      />
      {statuses ? (
        <ul className="divide-y divide-border/40">
          {statuses.map((status) => (
            <li
              key={status.agent}
              data-agent-hook={status.agent}
              data-state={status.state}
              className="flex items-start justify-between gap-3 py-2"
            >
              <div className="flex min-w-0 items-start gap-2">
                <span className="mt-0.5 shrink-0">
                  <AgentIcon agent={status.agent} size={14} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm">{labels.get(status.agent) ?? status.agent}</p>
                  {status.configPath ? (
                    <p
                      className="truncate font-mono text-[11px] text-muted-foreground"
                      title={status.configPath}
                    >
                      {status.configPath}
                    </p>
                  ) : null}
                  {status.detail ? (
                    <p className="break-words text-[11px] text-muted-foreground">
                      {status.detail}
                    </p>
                  ) : null}
                </div>
              </div>
              <SettingsBadge
                tone={
                  status.state === 'installed'
                    ? 'accent'
                    : status.state === 'not_installed'
                      ? 'muted'
                      : 'neutral'
                }
                className={cn(
                  'shrink-0',
                  status.state === 'error' && 'border-destructive/40 text-destructive'
                )}
              >
                {getStateLabel(status.state)}
              </SettingsBadge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          {translate('auto.components.settings.AgentHookInstallStatusList.f35aa93b4a', 'Checking…')}
        </p>
      )}
    </div>
  )
}
