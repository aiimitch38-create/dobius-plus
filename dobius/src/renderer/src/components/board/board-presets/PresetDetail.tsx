import { Loader2, Plus, Rocket } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { AGENT_CATALOG } from '@/lib/agent-catalog'
import { cn } from '@/lib/utils'
import { swatchEdge } from '../cards/card-swatch'
import { FILL_AGENTS, type PresetAgent, type PresetLane } from './preset-catalog'
import { uniformAgent, type LaneAgents } from './preset-deploy-plan'
import type { DiagramModel } from './preset-diagram-model'
import { PresetAgentIcon, presetAgentLabel } from './PresetAgentIcon'
import { PresetDiagram } from './PresetDiagram'

export type PresetExtraRow = { key: string; icon: React.ReactNode; label: string; detail: string }

const ICON_BUTTON =
  'flex size-8 items-center justify-center rounded-lg border border-[var(--board-chip-border)] bg-[var(--board-chip)] hover:bg-[var(--board-panel-2)]'

function FillRow({ onFill }: { onFill: (agent: PresetAgent) => void }): React.JSX.Element {
  const more = AGENT_CATALOG.filter((a) => !FILL_AGENTS.includes(a.id))
  return (
    <div className="flex flex-col gap-2 px-3 py-2.5">
      <span className="text-[12px] text-[var(--board-text-muted)]">
        {translate('board.presets.fillAll', 'Fill every lane with')}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {FILL_AGENTS.map((agent) => (
          <button
            key={agent}
            type="button"
            aria-label={presetAgentLabel(agent)}
            title={presetAgentLabel(agent)}
            onClick={() => onFill(agent)}
            className="flex size-7 items-center justify-center rounded-full hover:bg-[var(--board-panel-2)]"
          >
            <PresetAgentIcon agent={agent} />
          </button>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={translate('board.presets.moreAgents', 'More agents')}
              className="flex size-7 items-center justify-center rounded-full border border-[var(--board-panel-border)] hover:bg-[var(--board-panel-2)]"
            >
              <Plus className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
            {more.map((a) => (
              <DropdownMenuItem key={a.id} onSelect={() => onFill(a.id)}>
                <PresetAgentIcon agent={a.id} />
                {a.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

export function PresetDetail({
  model,
  name,
  description,
  lanes,
  agents,
  extras,
  deploying,
  onCycle,
  onFill,
  onDeploy
}: {
  model: DiagramModel
  name: string
  description: string
  lanes: readonly PresetLane[]
  agents: LaneAgents
  extras: readonly PresetExtraRow[]
  deploying: boolean
  onCycle: (laneId: string, slot: number) => void
  onFill: (agent: PresetAgent) => void
  onDeploy: () => void
}): React.JSX.Element {
  const uniform = uniformAgent(agents)
  const consoleCount = Object.values(agents).flat().length
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
        <div className="aspect-[16/8] rounded-xl border border-[var(--board-panel-border)] bg-[var(--board-canvas)] p-4">
          <PresetDiagram model={model} />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-[18px] font-semibold">{name}</h3>
          <p className="text-[13px] leading-relaxed text-[var(--board-text-muted)]">
            {description}
          </p>
        </div>
        {lanes.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-[13px] font-semibold">
                {translate('board.presets.agents', 'Agents')}
              </h4>
              <span className="flex items-center gap-1.5 rounded-full border border-[var(--board-chip-border)] bg-[var(--board-chip)] px-2.5 py-0.5 text-[12px] text-[var(--board-text-muted)]">
                {uniform && <PresetAgentIcon agent={uniform} size={12} />}
                {uniform
                  ? translate('board.presets.allAgent', 'All {{agent}} · {{count}} consoles', {
                      agent: presetAgentLabel(uniform),
                      count: consoleCount
                    })
                  : translate('board.presets.mixed', 'Mixed · {{count}} consoles', {
                      count: consoleCount
                    })}
              </span>
            </div>
            <div className="divide-y divide-[var(--board-panel-border)] rounded-xl border border-[var(--board-panel-border)]">
              {lanes.map((lane) => (
                <div key={lane.id} className="flex items-center gap-3 px-3 py-2.5">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: swatchEdge(lane.color) }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                    {lane.name}
                  </span>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {(agents[lane.id] ?? []).map((agent, slot) => (
                      <button
                        key={slot}
                        type="button"
                        className={ICON_BUTTON}
                        title={translate(
                          'board.presets.cycleAgent',
                          '{{agent}} · click to change',
                          {
                            agent: presetAgentLabel(agent)
                          }
                        )}
                        aria-label={translate(
                          'board.presets.consoleAgent',
                          '{{lane}} console {{n}}: {{agent}}',
                          {
                            lane: lane.name,
                            n: slot + 1,
                            agent: presetAgentLabel(agent)
                          }
                        )}
                        onClick={() => onCycle(lane.id, slot)}
                      >
                        <PresetAgentIcon agent={agent} size={16} />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <FillRow onFill={onFill} />
            </div>
          </section>
        )}
        {extras.length > 0 && (
          <section className="space-y-2">
            <h4 className="text-[13px] font-semibold">
              {translate('board.presets.alsoOnBoard', 'Also on the board')}
            </h4>
            <div className="divide-y divide-[var(--board-panel-border)] rounded-xl border border-[var(--board-panel-border)]">
              {extras.map((row) => (
                <div key={row.key} className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
                  <span className="text-[var(--board-text-muted)] [&_svg]:size-4">{row.icon}</span>
                  <span className="font-medium">{row.label}</span>
                  <span className="ml-auto text-right text-[var(--board-text-muted)]">
                    {row.detail}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
      <div className="shrink-0 border-t border-[var(--board-panel-border)] p-4">
        <button
          type="button"
          disabled={deploying || consoleCount + extras.length === 0}
          onClick={onDeploy}
          className={cn(
            'flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[var(--board-accent)] text-[14px] font-semibold text-[var(--board-accent-fg)] disabled:opacity-50'
          )}
        >
          {deploying ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
          {deploying
            ? translate('board.presets.deploying', 'Starting consoles…')
            : translate('board.presets.deploy', 'Deploy')}
        </button>
      </div>
    </div>
  )
}
