import React, { useState } from 'react'
import {
  Boxes,
  Download,
  GitFork,
  ImageDown,
  Layers,
  Loader2,
  RefreshCcw,
  Route,
  Square,
  Workflow,
  type LucideIcon
} from 'lucide-react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { getBoard } from '@/store/slices/board'
import { notePushTargets } from '../cards/note-push'
import {
  drawStarterDiagram,
  startDiagramJob,
  stopDiagramJob,
  useDiagramJobs,
  type DiagramJobStatus
} from '../board-diagrams/diagram-job'
import { exportDiagramExcalidraw, exportDiagramPng } from '../board-diagrams/diagram-export'
import {
  DIAGRAM_TEMPLATES,
  diagramTemplateLabel,
  type DiagramColorMode,
  type DiagramEffort,
  type DiagramTemplateId
} from '../board-diagrams/diagram-model'
import { DIAGRAM_STARTERS, diagramStarterLabel } from '../board-diagrams/diagram-starters'
import { ToolOptionRow, ToolPanelFrame, ToolPanelSection } from './BoardToolPanelControls'

const TEMPLATE_ICONS: Record<Exclude<DiagramTemplateId, 'custom'>, LucideIcon> = {
  architecture: Layers,
  'user-flow': Route,
  'data-flow': Workflow,
  'component-map': Boxes,
  'request-lifecycle': RefreshCcw,
  'state-machine': GitFork
}
const PROJECT_TEMPLATES = DIAGRAM_TEMPLATES.filter(
  (t): t is Exclude<DiagramTemplateId, 'custom'> => t !== 'custom'
)
const EFFORTS: readonly DiagramEffort[] = ['quick', 'balanced', 'thorough']

const EXPORT_BUTTON =
  'flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full border border-[var(--board-panel-border)] text-[12px] font-medium text-[var(--board-text)] hover:bg-[var(--board-panel-2)]'

function exportErrorToast(error: unknown): void {
  toast.error(
    translate('board.diagram.exportFailed', 'Couldn’t export the file: {{error}}', {
      error: error instanceof Error ? error.message : String(error)
    })
  )
}

const TILE =
  'flex h-9 items-center gap-2 rounded-[10px] bg-[var(--board-panel-2)] px-2.5 text-left text-[12px] text-[var(--board-text)] hover:bg-[var(--board-accent-tint)] disabled:opacity-40'
const PILL =
  'rounded-full px-2.5 py-0.5 text-[12px] text-[var(--board-text-muted)] aria-pressed:bg-[var(--board-accent-tint)] aria-pressed:font-semibold aria-pressed:text-[var(--board-text)]'

function effortLabel(effort: DiagramEffort): string {
  switch (effort) {
    case 'quick':
      return translate('board.diagram.effort.quick', 'Quick')
    case 'balanced':
      return translate('board.diagram.effort.balanced', 'Balanced')
    case 'thorough':
      return translate('board.diagram.effort.thorough', 'Thorough')
  }
}

function statusText(status: DiagramJobStatus, nodes: number, edges: number): string {
  switch (status) {
    case 'waiting':
      return translate('board.diagram.status.waiting', 'Waiting for the agent to start drawing…')
    case 'drawing':
      return translate(
        'board.diagram.status.drawing',
        'Drawing… {{nodes}} shapes, {{edges}} arrows',
        {
          nodes,
          edges
        }
      )
    case 'done':
      return translate('board.diagram.status.done', 'Done: {{nodes}} shapes, {{edges}} arrows.', {
        nodes,
        edges
      })
    case 'stopped':
      return translate(
        'board.diagram.status.stopped',
        'Stopped. {{nodes}} shapes stay on the board.',
        {
          nodes
        }
      )
    case 'quiet':
      return translate(
        'board.diagram.status.quiet',
        'The agent went quiet. {{nodes}} shapes stay.',
        {
          nodes
        }
      )
  }
}

/** Export buttons for the board's diagram: the latest drawing (agent or starter), else every shape. */
function DiagramExportRow({ worktreeId }: { worktreeId: string }): React.JSX.Element {
  return (
    <div className="flex gap-1.5">
      <button
        type="button"
        onClick={() =>
          void exportDiagramExcalidraw(worktreeId).then(
            (path) =>
              toast.success(translate('board.diagram.exported', 'Saved {{path}}', { path })),
            exportErrorToast
          )
        }
        className={EXPORT_BUTTON}
      >
        <Download className="size-3.5" />
        {translate('board.diagram.exportExcalidraw', 'Export as Excalidraw')}
      </button>
      <button
        type="button"
        onClick={() =>
          void exportDiagramPng(worktreeId).then((path) => {
            if (path) {
              toast.success(translate('board.diagram.exported', 'Saved {{path}}', { path }))
            }
          }, exportErrorToast)
        }
        className={EXPORT_BUTTON}
      >
        <ImageDown className="size-3.5" />
        {translate('board.diagram.exportPng', 'Export as PNG')}
      </button>
    </div>
  )
}

/** Diagrams tool: an agent in this workspace draws from your project, or drop a starter. */
export function DiagramToolPanel({ worktreeId }: { worktreeId: string }): React.JSX.Element {
  const targets = notePushTargets(useAppStore((s) => getBoard(s, worktreeId)))
  const job = useDiagramJobs((s) => (s.job?.worktreeId === worktreeId ? s.job : null))
  const [description, setDescription] = useState('')
  const [mode, setMode] = useState<DiagramColorMode>('mono')
  const [effort, setEffort] = useState<DiagramEffort>('balanced')
  const [tabId, setTabId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const hasShapes = useAppStore((s) =>
    getBoard(s, worktreeId).cards.some((c) => c.kind === 'shape')
  )
  const target = targets.find((t) => t.tabId === tabId) ?? targets[0] ?? null
  const running = job?.status === 'waiting' || job?.status === 'drawing'
  const canGenerate = Boolean(target) && !busy && !running

  const generate = async (template: DiagramTemplateId): Promise<void> => {
    if (!target) {
      return
    }
    setBusy(true)
    try {
      const error = await startDiagramJob({
        worktreeId,
        tabId: target.tabId,
        template,
        description,
        mode,
        effort
      })
      if (error) {
        toast.error(error)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <ToolPanelFrame label={translate('board.tools.screen', 'Diagrams')}>
      <ToolPanelSection title={translate('board.diagram.agent', 'Agent')}>
        {targets.length === 0 ? (
          <p className="text-[12px] text-[var(--board-text-muted)]">
            {translate(
              'board.diagram.noAgents',
              'Spawn a console to draw from your project. Starter shapes work without one.'
            )}
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {targets.map((t) => (
              <button
                key={t.cardId}
                type="button"
                aria-pressed={target?.tabId === t.tabId}
                onClick={() => setTabId(t.tabId)}
                className="rounded-full border border-[var(--board-panel-border)] px-2.5 py-1 text-[12px] text-[var(--board-text)] hover:bg-[var(--board-panel-2)] aria-pressed:border-[var(--board-accent)] aria-pressed:bg-[var(--board-accent-tint)]"
              >
                {t.title}
              </button>
            ))}
          </div>
        )}
      </ToolPanelSection>
      <ToolPanelSection title={translate('board.diagram.effortLabel', 'Effort')}>
        <ToolOptionRow
          options={EFFORTS}
          value={effort}
          onChange={setEffort}
          label={effortLabel}
          render={(e) => <span className="text-[12px]">{effortLabel(e)}</span>}
        />
      </ToolPanelSection>
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold tracking-[0.12em] text-[var(--board-text-muted)] uppercase">
          {translate('board.diagram.style', 'Style')}
        </h3>
        <div className="flex gap-1">
          <button
            type="button"
            aria-pressed={mode === 'mono'}
            onClick={() => setMode('mono')}
            className={PILL}
          >
            {translate('board.diagram.ink', 'Ink')}
          </button>
          <button
            type="button"
            aria-pressed={mode === 'auto'}
            onClick={() => setMode('auto')}
            className={PILL}
          >
            {translate('board.diagram.colorful', 'Colorful')}
          </button>
        </div>
      </div>
      <ToolPanelSection title={translate('board.diagram.fromProject', 'From your project')}>
        <div className="grid grid-cols-2 gap-1.5">
          {PROJECT_TEMPLATES.map((id) => {
            const Icon = TEMPLATE_ICONS[id]
            return (
              <button
                key={id}
                type="button"
                disabled={!canGenerate}
                onClick={() => void generate(id)}
                className={TILE}
              >
                <Icon aria-hidden className="size-3.5 shrink-0 text-[var(--board-text-muted)]" />
                <span className="truncate">{diagramTemplateLabel(id)}</span>
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-1.5 rounded-[10px] bg-[var(--board-panel-2)] p-1 pl-2.5">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) =>
              e.key === 'Enter' && description.trim() && canGenerate && void generate('custom')
            }
            aria-label={translate('board.diagram.describeLabel', 'Describe a diagram')}
            placeholder={translate('board.diagram.describePlaceholder', 'Describe a diagram…')}
            className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--board-text)] outline-none placeholder:text-[var(--board-text-muted)]"
          />
          <button
            type="button"
            disabled={!canGenerate || !description.trim()}
            onClick={() => void generate('custom')}
            className="flex h-7 items-center gap-1 rounded-full bg-[var(--board-accent)] px-3 text-[12px] font-semibold text-[var(--board-accent-fg)] disabled:opacity-40"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {translate('board.diagram.generate', 'Generate')}
          </button>
        </div>
      </ToolPanelSection>
      {job ? (
        <div className="flex flex-col gap-2">
          <p role="status" className="text-[12px] text-[var(--board-text-muted)]">
            {statusText(job.status, job.nodeCount, job.edgeCount)}
          </p>
          {running ? (
            <button
              type="button"
              onClick={stopDiagramJob}
              className="flex h-8 items-center justify-center gap-1.5 rounded-full border border-[var(--board-panel-border)] text-[12px] font-medium text-[var(--board-text)] hover:bg-[var(--board-panel-2)]"
            >
              <Square className="size-3.5" />
              {translate('board.diagram.stop', 'Stop (keep what’s drawn)')}
            </button>
          ) : null}
        </div>
      ) : null}
      {!running && hasShapes ? <DiagramExportRow worktreeId={worktreeId} /> : null}
      <ToolPanelSection title={translate('board.diagram.starters', 'Starter shapes')}>
        <div className="grid grid-cols-2 gap-1.5">
          {DIAGRAM_STARTERS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => drawStarterDiagram(worktreeId, id, mode)}
              className={`${TILE} justify-center`}
            >
              {diagramStarterLabel(id)}
            </button>
          ))}
        </div>
      </ToolPanelSection>
    </ToolPanelFrame>
  )
}
