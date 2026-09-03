import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Play, Plus, Square, Trash2 } from 'lucide-react'
import type {
  AgentProviderStatusSnapshot,
  CustomHarnessDefinition
} from '../../../../shared/agents'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { SettingsSubsectionHeader } from './SettingsFormControls'
import { translate } from '@/i18n/i18n'

// Phase 5 harness catalog: rows for every saved custom harness with real
// launch + live status through the agents:* IPC family. Env values entered
// here go to the main process and are write-only — they never render back.
const STATE_DOT: Record<AgentProviderStatusSnapshot['state'], string> = {
  idle: 'bg-muted-foreground/40',
  running: 'bg-emerald-500',
  finished: 'bg-sky-500',
  failed: 'bg-destructive'
}

function emptyDraft(): CustomHarnessDefinition {
  return {
    id: '',
    label: '',
    command: '',
    args: [],
    env: {},
    installInstructionsUrl: '',
    installHint: ''
  }
}

export function HarnessCatalogSection(): React.JSX.Element {
  const [harnesses, setHarnesses] = useState<CustomHarnessDefinition[]>([])
  const [statuses, setStatuses] = useState<AgentProviderStatusSnapshot[]>([])
  const [draft, setDraft] = useState<CustomHarnessDefinition>(emptyDraft())
  const [envDraft, setEnvDraft] = useState('')
  const [argsDraft, setArgsDraft] = useState('')
  const [promptDraft, setPromptDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [rows, snapshots] = await Promise.all([
        window.api.agents.listHarnesses(),
        window.api.agents.harnessStatuses()
      ])
      setHarnesses(rows)
      setStatuses(snapshots)
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const unsubscribe = window.api.agents.onRunsChanged(() => {
      void refresh()
    })
    return unsubscribe
  }, [refresh])

  const statusFor = (id: string): AgentProviderStatusSnapshot | undefined =>
    statuses.find((snapshot) => snapshot.agentId === `custom-harness-${id}`)

  async function saveDraft(): Promise<void> {
    setError(null)
    try {
      const env: Record<string, string> = {}
      for (const line of envDraft.split('\n')) {
        const separator = line.indexOf('=')
        if (separator <= 0) {
          continue
        }
        env[line.slice(0, separator).trim()] = line.slice(separator + 1)
      }
      await window.api.agents.saveHarness({
        ...draft,
        id:
          draft.id.trim() ||
          draft.label
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-') ||
          `harness-${Date.now()}`,
        args: argsDraft.split(/\s+/).filter(Boolean),
        env
      })
      setDraft(emptyDraft())
      setEnvDraft('')
      setArgsDraft('')
      await refresh()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    }
  }

  async function run(id: string): Promise<void> {
    setError(null)
    try {
      await window.api.agents.runHarness({ id, prompt: promptDraft || 'hello' })
      await refresh()
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError))
    }
  }

  async function stop(id: string): Promise<void> {
    await window.api.agents.stopHarness(id)
    await refresh()
  }

  async function remove(id: string): Promise<void> {
    await window.api.agents.deleteHarness(id)
    await refresh()
  }

  return (
    <section className="space-y-4">
      <SettingsSubsectionHeader
        title={translate('auto.components.settings.HarnessCatalogSection.title', 'Harness Catalog')}
        description={translate(
          'auto.components.settings.HarnessCatalogSection.description',
          'External agent CLIs you can launch and DM like built-in agents. Each one gets its own Communications identity.'
        )}
      />

      <div className="space-y-2">
        {harnesses.map((harness) => {
          const snapshot = statusFor(harness.id)
          const running = snapshot?.state === 'running'
          return (
            <div
              key={harness.id}
              className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
            >
              <span className={`size-2 shrink-0 rounded-full ${STATE_DOT[snapshot?.state ?? 'idle']}`} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{harness.label}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[harness.command, ...harness.args].join(' ')}
                  {snapshot?.detail ? ` · ${snapshot.detail}` : ''}
                </p>
              </div>
              {running ? (
                <Button size="sm" variant="outline" onClick={() => void stop(harness.id)}>
                  <Square className="size-3.5" />
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => void run(harness.id)}>
                  <Play className="size-3.5" />
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => void remove(harness.id)}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          )
        })}
        {harnesses.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.HarnessCatalogSection.empty',
              'No harnesses yet. Add an ACP-speaking CLI below.'
            )}
          </p>
        ) : null}
      </div>

      <Input
        value={promptDraft}
        onChange={(event) => setPromptDraft(event.target.value)}
        placeholder={translate(
          'auto.components.settings.HarnessCatalogSection.promptPlaceholder',
          'Prompt sent to a harness when you press play'
        )}
      />

      <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
        <div className="flex items-center gap-2">
          <Plus className="size-4 text-muted-foreground" />
          <p className="text-sm font-medium">
            {translate('auto.components.settings.HarnessCatalogSection.addTitle', 'Add harness')}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input
            value={draft.label}
            onChange={(event) => setDraft({ ...draft, label: event.target.value })}
            placeholder="Goose"
          />
          <Input
            value={draft.command}
            onChange={(event) => setDraft({ ...draft, command: event.target.value })}
            placeholder="/usr/local/bin/goose"
          />
        </div>
        <Input
          value={argsDraft}
          onChange={(event) => setArgsDraft(event.target.value)}
          placeholder={translate(
            'auto.components.settings.HarnessCatalogSection.argsPlaceholder',
            'Arguments, space separated (acp)'
          )}
        />
        <textarea
          value={envDraft}
          onChange={(event) => setEnvDraft(event.target.value)}
          placeholder={'KEY=value\nOTHER_KEY=value'}
          className="min-h-16 w-full rounded-md border border-border bg-transparent px-3 py-2 font-mono text-xs"
        />
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <Button size="sm" onClick={() => void saveDraft()}>
          {translate('auto.components.settings.HarnessCatalogSection.save', 'Save harness')}
        </Button>
      </div>
    </section>
  )
}
