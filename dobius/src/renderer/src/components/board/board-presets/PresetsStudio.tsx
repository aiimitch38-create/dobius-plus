import { useCallback, useEffect, useMemo, useState } from 'react'
import { Cable, Globe, KanbanSquare, Layers, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useConfirmationDialog } from '@/components/confirmation-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { getRepoIdFromWorktreeId } from '../../../../../shared/worktree-id'
import type { BoardPreset } from './board-preset'
import { deleteBoardPreset, listBoardPresets, saveBoardPreset } from './board-preset-store'
import {
  presetCatalog,
  presetConsoleCount,
  type PresetDefinition,
  type PresetLane
} from './preset-catalog'
import type { BoardPoint } from '../board-canvas/board-viewport'
import { deployPresetPlan, PRESET_DEPLOY_BLOCK } from './preset-deploy'
import {
  buildCatalogDeployPlan,
  buildUserDeployPlan,
  cycleLaneAgent,
  fillLaneAgents,
  initialLaneAgents,
  userPresetAgents,
  userPresetLanes,
  type LaneAgents
} from './preset-deploy-plan'
import { catalogDiagram, userDiagram, type DiagramModel } from './preset-diagram-model'
import { PresetDetail, type PresetExtraRow } from './PresetDetail'
import { presetAgentLabel } from './PresetAgentIcon'
import { PresetDiagram } from './PresetDiagram'

type Selection =
  | { kind: 'catalog'; preset: PresetDefinition }
  | { kind: 'user'; preset: BoardPreset }

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const ungroupedName = (): string => translate('board.presets.ungrouped', 'Loose consoles')

function selectionLanes(sel: Selection): PresetLane[] {
  return sel.kind === 'catalog' ? sel.preset.lanes : userPresetLanes(sel.preset, ungroupedName())
}

function selectionAgents(sel: Selection): LaneAgents {
  return sel.kind === 'catalog'
    ? initialLaneAgents(sel.preset.lanes)
    : userPresetAgents(sel.preset, selectionLanes(sel))
}

function extraRows(sel: Selection): PresetExtraRow[] {
  const kinds =
    sel.kind === 'catalog'
      ? sel.preset.extras.map((e) => ({ kind: e.kind, url: e.kind === 'web' ? e.url : undefined }))
      : sel.preset.cards.flatMap((c) =>
          c.kind === 'orchestrator' || c.kind === 'kanban' || c.kind === 'web'
            ? [{ kind: c.kind, url: c.kind === 'web' ? c.url : undefined }]
            : []
        )
  return kinds.map((e, i) => {
    if (e.kind === 'orchestrator') {
      return {
        key: `o${i}`,
        icon: <Cable />,
        label: translate('board.presets.extra.orchestrator', 'Orchestrator'),
        detail: translate('board.presets.extra.orchestratorDetail', 'Directs every group')
      }
    }
    if (e.kind === 'kanban') {
      return {
        key: `k${i}`,
        icon: <KanbanSquare />,
        label: translate('board.presets.extra.kanban', 'Task board'),
        detail: translate('board.presets.extra.kanbanDetail', 'Starts empty')
      }
    }
    return {
      key: `w${i}`,
      icon: <Globe />,
      label: translate('board.presets.extra.web', 'Live preview'),
      detail: e.url || translate('board.presets.extra.webDetail', 'No address yet')
    }
  })
}

function PresetTile({
  name,
  meta,
  model,
  selected,
  onSelect,
  onDelete
}: {
  name: string
  meta: string
  model: DiagramModel
  selected: boolean
  onSelect: () => void
  onDelete?: () => void
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'group/tile relative flex flex-col gap-2 rounded-2xl border p-2 text-left transition-colors',
        selected
          ? 'border-[var(--board-accent)] bg-[var(--board-accent-tint)]'
          : 'border-transparent hover:border-[var(--board-panel-border)]'
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="flex flex-col gap-2 text-left"
      >
        <div className="aspect-[16/8] w-full rounded-xl border border-[var(--board-panel-border)] bg-[var(--board-canvas)] p-3">
          <PresetDiagram model={model} />
        </div>
        <div className="px-1">
          <div className="truncate text-[14px] font-semibold">{name}</div>
          <div className="text-[12px] text-[var(--board-text-muted)]">{meta}</div>
        </div>
      </button>
      {onDelete && (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={translate('board.presets.delete', 'Delete preset')}
          onClick={onDelete}
          className="absolute top-3 right-3 opacity-0 group-hover/tile:opacity-100 focus-visible:opacity-100"
        >
          <Trash2 />
        </Button>
      )}
    </div>
  )
}

function metaLine(consoles: number, groups: number): string {
  return translate('board.presets.meta', '{{consoles}} consoles · {{groups}} groups', {
    consoles,
    groups
  })
}

function Section({
  title,
  subtitle,
  children
}: {
  title: string
  subtitle: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-[15px] font-semibold">{title}</h3>
        <p className="text-[12px] text-[var(--board-text-muted)]">{subtitle}</p>
      </div>
      {children}
    </section>
  )
}

export function PresetsStudio({
  worktreeId,
  freeCenter,
  onDone
}: {
  worktreeId: string
  /** The Board's free-spot finder, shared with spawns and the planner's deploy. */
  freeCenter: (block: { w: number; h: number }) => BoardPoint
  onDone: () => void
}): React.JSX.Element {
  const catalog = useMemo(() => presetCatalog(), [])
  const repoId = getRepoIdFromWorktreeId(worktreeId)
  const confirm = useConfirmationDialog()
  const [userPresets, setUserPresets] = useState<BoardPreset[]>([])
  const [selection, setSelection] = useState<Selection>({ kind: 'catalog', preset: catalog[0] })
  const [agents, setAgents] = useState<LaneAgents>(() =>
    selectionAgents({ kind: 'catalog', preset: catalog[0] })
  )
  const [saveName, setSaveName] = useState('')
  const [deploying, setDeploying] = useState(false)

  useEffect(() => {
    listBoardPresets(repoId)
      .then(setUserPresets)
      .catch((e: unknown) => toast.error(errorText(e)))
  }, [repoId])

  const select = useCallback((next: Selection) => {
    setSelection(next)
    setAgents(selectionAgents(next))
  }, [])

  const lanes = selectionLanes(selection)
  const model =
    selection.kind === 'catalog' ? catalogDiagram(selection.preset) : userDiagram(selection.preset)

  const deploy = async (): Promise<void> => {
    const center = freeCenter(PRESET_DEPLOY_BLOCK)
    const newId = (): string => crypto.randomUUID()
    const plan =
      selection.kind === 'catalog'
        ? buildCatalogDeployPlan(selection.preset, agents, center, {
            newId,
            agentLabel: presetAgentLabel
          })
        : buildUserDeployPlan(selection.preset, lanes, agents, center, { newId })
    if (plan.needsConfirm) {
      const ok = await confirm({
        title: translate('board.presets.confirmTitle', 'Start {{count}} consoles?', {
          count: plan.consoles.length
        }),
        description: translate(
          'board.presets.confirmBody',
          'Each console launches its own agent, which uses your plan limits and machine resources.'
        ),
        confirmLabel: translate('board.presets.confirmAction', 'Start {{count}}', {
          count: plan.consoles.length
        })
      })
      if (!ok) {
        return
      }
    }
    const reportFailed = (failed: number): void => {
      toast.error(
        translate('board.presets.partial', '{{failed}} of {{count}} consoles did not start.', {
          failed,
          count: plan.consoles.length
        })
      )
    }
    setDeploying(true)
    try {
      const { failed } = await deployPresetPlan(plan, worktreeId, reportFailed)
      if (failed > 0) {
        reportFailed(failed)
      }
      onDone()
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setDeploying(false)
    }
  }

  const tileFor = (preset: PresetDefinition): React.JSX.Element => (
    <PresetTile
      key={preset.id}
      name={preset.name}
      meta={metaLine(presetConsoleCount(preset), preset.lanes.length)}
      model={catalogDiagram(preset)}
      selected={selection.kind === 'catalog' && selection.preset.id === preset.id}
      onSelect={() => select({ kind: 'catalog', preset })}
    />
  )

  return (
    <div className="flex h-full min-h-0 flex-col text-[var(--board-text)]">
      {/* The studio header now carries this subtitle (reference layout); kept for screen readers. */}
      <div className="sr-only">
        <span className="flex size-9 items-center justify-center rounded-xl bg-[var(--board-accent-tint)] text-[var(--board-accent)]">
          <Layers className="size-4" />
        </span>
        <p className="text-[13px] text-[var(--board-text-muted)]">
          {translate(
            'board.presets.subtitle',
            'Whole arrangements of crews, task boards and previews, wired up for you. Choose one, pick its agents, deploy.'
          )}
        </p>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_380px]">
        <div className="scrollbar-sleek min-h-0 space-y-6 overflow-y-auto p-5">
          <Section
            title={translate('board.presets.workspaces', 'Full workspaces')}
            subtitle={translate(
              'board.presets.workspacesSub',
              'Crews with roles around a task board or preview, directed by one orchestrator.'
            )}
          >
            <div className="grid grid-cols-3 gap-2">
              {catalog.filter((p) => p.section === 'workspace').map(tileFor)}
            </div>
          </Section>
          <Section
            title={translate('board.presets.plainTitle', 'Plain groups')}
            subtitle={translate(
              'board.presets.plainSub',
              'Just consoles in frames. The sizes people reach for most.'
            )}
          >
            <div className="grid grid-cols-3 gap-2">
              {catalog.filter((p) => p.section === 'plain').map(tileFor)}
            </div>
          </Section>
          <Section
            title={translate('board.presets.yours', 'Your presets')}
            subtitle={translate(
              'board.presets.yoursSub',
              'Saved from this project’s boards. Agents restart fresh on deploy.'
            )}
          >
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (saveName.trim()) {
                  saveBoardPreset(repoId, worktreeId, saveName)
                    .then((list) => {
                      setUserPresets(list)
                      setSaveName('')
                    })
                    .catch((err: unknown) => toast.error(errorText(err)))
                }
              }}
            >
              <Input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder={translate('board.presets.namePlaceholder', 'Name this arrangement')}
                aria-label={translate('board.presets.name', 'Preset name')}
                className="h-8"
              />
              <Button type="submit" size="sm" variant="outline" disabled={!saveName.trim()}>
                {translate('board.presets.saveCurrent', 'Save current board as preset')}
              </Button>
            </form>
            <div className="grid grid-cols-3 gap-2">
              {userPresets.map((preset) => (
                <PresetTile
                  key={preset.id}
                  name={preset.name}
                  meta={metaLine(
                    preset.cards.filter((c) => c.kind === 'console').length,
                    preset.groups.length
                  )}
                  model={userDiagram(preset)}
                  selected={selection.kind === 'user' && selection.preset.id === preset.id}
                  onSelect={() => select({ kind: 'user', preset })}
                  onDelete={() =>
                    deleteBoardPreset(repoId, preset.id)
                      .then(setUserPresets)
                      .catch((err: unknown) => toast.error(errorText(err)))
                  }
                />
              ))}
            </div>
          </Section>
        </div>
        <div className="min-h-0 border-l border-[var(--board-panel-border)]">
          <PresetDetail
            model={model}
            name={selection.preset.name}
            description={
              selection.kind === 'catalog'
                ? selection.preset.description
                : translate(
                    'board.presets.userDescription',
                    'A board you saved, laid out exactly as it was.'
                  )
            }
            lanes={lanes}
            agents={agents}
            extras={extraRows(selection)}
            deploying={deploying}
            onCycle={(laneId, slot) => setAgents((a) => cycleLaneAgent(a, laneId, slot))}
            onFill={(agent) => setAgents(fillLaneAgents(lanes, agent))}
            onDeploy={() => void deploy()}
          />
        </div>
      </div>
    </div>
  )
}
