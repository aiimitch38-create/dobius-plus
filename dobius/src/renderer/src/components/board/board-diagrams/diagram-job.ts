// Runs one Diagrams-tool request: asks a console agent to stream a diagram into
// a JSON-lines file in the repo, polls that file through the runtime client
// (local or SSH), and draws new nodes/edges as they appear. Stop keeps what's drawn.
import { toast } from 'sonner'
import { create } from 'zustand'
import { translate } from '@/i18n/i18n'
import { getConnectionId } from '@/lib/connection-context'
import { joinPath } from '@/lib/path'
import { getSettingsForWorktreeRuntimeOwner } from '@/lib/worktree-runtime-owner'
import { readRuntimeFileContent } from '@/runtime/runtime-file-client'
import { useAppStore } from '@/store'
import { getBoard } from '@/store/slices/board'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { diagramPlacement } from './diagram-board-scope'
import { pushNoteToConsole } from '../cards/note-push'
import {
  buildDiagramRequest,
  diagramSize,
  layoutDiagram,
  parseDiagramLines,
  type DiagramColorMode,
  type DiagramEffort,
  type DiagramTemplateId
} from './diagram-model'
import { diagramStarter, type DiagramStarterId } from './diagram-starters'

const POLL_MS = 1_500
// Why: give up when the file stops growing; the agent may have stalled or ignored the format.
const QUIET_LIMIT_MS = 5 * 60 * 1000
const ESTIMATED_LAYERS = 4
const ESTIMATED_ROWS = 5

export type DiagramJobStatus = 'waiting' | 'drawing' | 'done' | 'stopped' | 'quiet'

export type DiagramJob = {
  id: string
  worktreeId: string
  relativeFile: string
  status: DiagramJobStatus
  nodeCount: number
  edgeCount: number
  /** nodeId -> board card id, for edges and export. */
  cardByNode: Record<string, string>
}

type JobRuntime = {
  timer: number
  origin: { x: number; y: number }
  mode: DiagramColorMode
  filePath: string
  drawnLayers: Set<string>
  drawnEdges: Set<string>
  lastText: string
  lastGrowth: number
  busy: boolean
}

export const useDiagramJobs = create<{ job: DiagramJob | null }>(() => ({ job: null }))
const runtimes = new Map<string, JobRuntime>()

function patchJob(id: string, patch: Partial<DiagramJob>): void {
  useDiagramJobs.setState((s) => (s.job?.id === id ? { job: { ...s.job, ...patch } } : s))
}

function finish(id: string, status: DiagramJobStatus): void {
  const runtime = runtimes.get(id)
  if (runtime) {
    window.clearInterval(runtime.timer)
    runtimes.delete(id)
  }
  patchJob(id, { status })
}

async function poll(job: DiagramJob): Promise<void> {
  const runtime = runtimes.get(job.id)
  // Why: a slow (SSH) read can outlast the interval; overlapping polls would draw nodes twice.
  if (!runtime || runtime.busy) {
    return
  }
  runtime.busy = true
  try {
    await drawLatest(job, runtime)
  } finally {
    runtime.busy = false
  }
}

async function drawLatest(job: DiagramJob, runtime: JobRuntime): Promise<void> {
  let text: string
  try {
    const result = await readRuntimeFileContent({
      settings: getSettingsForWorktreeRuntimeOwner(useAppStore.getState(), job.worktreeId),
      filePath: runtime.filePath,
      relativePath: job.relativeFile,
      worktreeId: job.worktreeId,
      connectionId: getConnectionId(job.worktreeId) ?? undefined
    })
    text = result.isBinary ? '' : result.content
  } catch {
    text = '' // not written yet; the quiet timer below decides when to give up
  }
  if (!runtimes.has(job.id)) {
    return
  }
  const now = Date.now()
  if (text !== runtime.lastText) {
    runtime.lastText = text
    runtime.lastGrowth = now
  } else if (now - runtime.lastGrowth > QUIET_LIMIT_MS) {
    finish(job.id, 'quiet')
    toast.error(
      translate(
        'board.diagram.quiet',
        'The agent went quiet before finishing. What was drawn stays.'
      )
    )
    return
  }
  const diagram = parseDiagramLines(text)
  const layout = layoutDiagram(diagram, runtime.origin, runtime.mode)
  const state = useAppStore.getState()
  const current = useDiagramJobs.getState().job
  if (current?.id !== job.id) {
    return
  }
  const cardByNode = { ...current.cardByNode }
  for (const placement of layout.layers) {
    if (!runtime.drawnLayers.has(placement.layer)) {
      runtime.drawnLayers.add(placement.layer)
      state.addCard(job.worktreeId, placement.card)
    }
  }
  for (const placement of layout.nodes) {
    if (!cardByNode[placement.nodeId]) {
      cardByNode[placement.nodeId] = state.addCard(job.worktreeId, placement.card)
    }
  }
  for (const edge of diagram.edges) {
    const key = `${edge.from}\u0001${edge.to}`
    const from = cardByNode[edge.from]
    const to = cardByNode[edge.to]
    if (from && to && !runtime.drawnEdges.has(key)) {
      runtime.drawnEdges.add(key)
      state.addConnector(job.worktreeId, {
        fromCardId: from,
        toCardId: to,
        ...(edge.label ? { label: edge.label } : {})
      })
    }
  }
  patchJob(job.id, {
    status: diagram.nodes.length > 0 ? 'drawing' : 'waiting',
    nodeCount: diagram.nodes.length,
    edgeCount: runtime.drawnEdges.size,
    cardByNode
  })
  if (diagram.done) {
    finish(job.id, 'done')
  }
}

/** Sends the request to `tabId` and starts drawing. Returns an error message or null. */
export async function startDiagramJob(args: {
  worktreeId: string
  tabId: string
  template: DiagramTemplateId
  description: string
  mode: DiagramColorMode
  effort: DiagramEffort
}): Promise<string | null> {
  const worktreePath = findWorktreeById(
    useAppStore.getState().worktreesByRepo,
    args.worktreeId
  )?.path
  if (!worktreePath) {
    return translate('board.diagram.noWorkspace', 'Open a workspace first.')
  }
  const id = crypto.randomUUID().slice(0, 8)
  const relativeFile = `.dobius/diagrams/${id}.jsonl`
  const prompt = buildDiagramRequest(args.template, args.description, relativeFile, args.effort)
  if (!prompt) {
    return translate('board.diagram.describe', 'Describe the diagram first.')
  }
  const error = await pushNoteToConsole(args.worktreeId, args.tabId, prompt)
  if (error) {
    return error
  }
  const previous = useDiagramJobs.getState().job
  if (previous) {
    finish(previous.id, 'stopped')
  }
  const placed = placeDiagram(args.worktreeId, diagramSize(ESTIMATED_LAYERS, ESTIMATED_ROWS))
  const job: DiagramJob = {
    id,
    worktreeId: args.worktreeId,
    relativeFile,
    status: 'waiting',
    nodeCount: 0,
    edgeCount: 0,
    cardByNode: {}
  }
  useDiagramJobs.setState({ job })
  runtimes.set(id, {
    timer: window.setInterval(() => void poll(job), POLL_MS),
    origin: placed,
    mode: args.mode,
    filePath: joinPath(worktreePath, relativeFile),
    drawnLayers: new Set(),
    drawnEdges: new Set(),
    lastText: '',
    lastGrowth: Date.now(),
    busy: false
  })
  return null
}

export function stopDiagramJob(): void {
  const job = useDiagramJobs.getState().job
  if (job && runtimes.has(job.id)) {
    finish(job.id, 'stopped')
  }
}

/** Draws a starter diagram at the centre of the view, no agent involved. */
export function drawStarterDiagram(
  worktreeId: string,
  starter: DiagramStarterId,
  mode: DiagramColorMode
): void {
  const diagram = diagramStarter(starter)
  const state = useAppStore.getState()
  const tallest = Math.max(
    ...diagram.layers.map((l) => diagram.nodes.filter((n) => n.layer === l).length)
  )
  const origin = placeDiagram(worktreeId, diagramSize(diagram.layers.length, tallest))
  const layout = layoutDiagram(diagram, origin, mode, false)
  const cardByNode = new Map(
    layout.nodes.map((p) => [p.nodeId, state.addCard(worktreeId, p.card)] as const)
  )
  let edgeCount = 0
  for (const edge of diagram.edges) {
    const from = cardByNode.get(edge.from)
    const to = cardByNode.get(edge.to)
    if (from && to) {
      state.addConnector(worktreeId, {
        fromCardId: from,
        toCardId: to,
        ...(edge.label ? { label: edge.label } : {})
      })
      edgeCount += 1
    }
  }
  // Why: the starter becomes the panel's current diagram so it exports like an
  // agent drawing; a drawing that is still streaming keeps the slot.
  const current = useDiagramJobs.getState().job
  if (current?.status !== 'waiting' && current?.status !== 'drawing') {
    const id = crypto.randomUUID().slice(0, 8)
    useDiagramJobs.setState({
      job: {
        id,
        worktreeId,
        relativeFile: `.dobius/diagrams/${id}.jsonl`,
        status: 'done',
        nodeCount: cardByNode.size,
        edgeCount,
        cardByNode: Object.fromEntries(cardByNode)
      }
    })
  }
}

/** Free top-left for a diagram of `size`, panning so it is on screen. */
function placeDiagram(
  worktreeId: string,
  size: { w: number; h: number }
): { x: number; y: number } {
  const state = useAppStore.getState()
  const board = getBoard(state, worktreeId)
  const { origin, viewport } = diagramPlacement(board, size, {
    w: window.innerWidth,
    h: window.innerHeight
  })
  if (viewport !== board.viewport) {
    state.setViewport(worktreeId, viewport)
  }
  return origin
}
