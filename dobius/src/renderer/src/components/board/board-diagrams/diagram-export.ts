// Diagram exports: the board's diagram (latest Diagrams-tool drawing, else every shape) as `.excalidraw` (written
// next to its source) or as a PNG (SVG scene from diagram-png.ts rasterized on a
// canvas, saved through the native save dialog, which asks before replacing).
import { translate } from '@/i18n/i18n'
import { getConnectionId } from '@/lib/connection-context'
import { joinPath } from '@/lib/path'
import { getSettingsForWorktreeRuntimeOwner } from '@/lib/worktree-runtime-owner'
import { writeRuntimeFile } from '@/runtime/runtime-file-client'
import { useAppStore } from '@/store'
import { getBoard } from '@/store/slices/board'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { diagramScope, type DiagramScope } from './diagram-board-scope'
import { useDiagramJobs } from './diagram-job'
import { toExcalidraw } from './diagram-excalidraw'
import { diagramPngScale, diagramToSvg } from './diagram-png'

function fileContext(worktreeId: string, worktreePath: string) {
  return {
    settings: getSettingsForWorktreeRuntimeOwner(useAppStore.getState(), worktreeId),
    worktreeId,
    worktreePath,
    connectionId: getConnectionId(worktreeId) ?? undefined
  }
}

/**
 * The diagram an export covers, as it sits on the board now (moved or not):
 * this workspace's latest Diagrams-tool drawing (agent or starter) while any of
 * it remains, otherwise every shape on the board.
 */
function collectDrawnDiagram(worktreeId: string): DiagramScope & {
  /** Workspace-relative `.excalidraw` path. */
  relativeFile: string
  name: string
} {
  const job = useDiagramJobs.getState().job
  const ownJob = job?.worktreeId === worktreeId ? job : null
  const board = getBoard(useAppStore.getState(), worktreeId)
  const scope = diagramScope(
    board.cards,
    board.connectors ?? [],
    ownJob ? new Set(Object.values(ownJob.cardByNode)) : null
  )
  if (scope.shapes.length === 0) {
    throw new Error(translate('board.diagram.nothingToExport', 'There is no diagram to export.'))
  }
  const id = ownJob?.id ?? `board-${Date.now().toString(36)}`
  return {
    ...scope,
    relativeFile: ownJob
      ? ownJob.relativeFile.replace(/\.jsonl$/, '.excalidraw')
      : `.dobius/diagrams/${id}.excalidraw`,
    name: `diagram-${id}`
  }
}

/** Writes the board's diagram to the workspace as `.excalidraw`; returns the path or throws. */
export async function exportDiagramExcalidraw(worktreeId: string): Promise<string> {
  const { shapes, arrows, relativeFile } = collectDrawnDiagram(worktreeId)
  const worktreePath = findWorktreeById(useAppStore.getState().worktreesByRepo, worktreeId)?.path
  if (!worktreePath) {
    throw new Error(translate('board.diagram.nothingToExport', 'There is no diagram to export.'))
  }
  await writeRuntimeFile(
    fileContext(worktreeId, worktreePath),
    joinPath(worktreePath, relativeFile),
    toExcalidraw(shapes, arrows)
  )
  return relativeFile
}

async function rasterizeSvg(svg: string, width: number, height: number): Promise<string> {
  const scale = diagramPngScale(width, height)
  const image = new Image()
  image.decoding = 'async'
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error(translate('board.diagram.pngFailed', 'Could not draw the image.'))
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const dataUrl = canvas.toDataURL('image/png')
  return dataUrl.slice(dataUrl.indexOf(',') + 1)
}

/**
 * Renders the drawn diagram to a PNG and saves it through the native save
 * dialog (which asks before replacing a file). Returns the saved path, or null
 * when the user cancels; throws on failure.
 */
export async function exportDiagramPng(worktreeId: string): Promise<string | null> {
  const { name, shapes, arrows } = collectDrawnDiagram(worktreeId)
  const scene = diagramToSvg(shapes, arrows)
  if (!scene) {
    throw new Error(translate('board.diagram.nothingToExport', 'There is no diagram to export.'))
  }
  const base64 = await rasterizeSvg(scene.svg, scene.width, scene.height)
  const result = await window.api.fs.saveDownloadedFile({
    suggestedName: `${name}.png`,
    content: base64,
    encoding: 'base64'
  })
  return result.canceled ? null : result.destinationPath
}
