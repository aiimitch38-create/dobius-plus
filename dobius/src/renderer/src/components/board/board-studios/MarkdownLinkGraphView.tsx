import React, { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { getConnectionId } from '@/lib/connection-context'
import { getSettingsForWorktreeRuntimeOwner } from '@/lib/worktree-runtime-owner'
import { readRuntimeFileContent } from '@/runtime/runtime-file-client'
import { useAppStore } from '@/store'
import { collectMarkdownLinks, layoutMarkdownLinkGraph } from './markdown-link-graph'
import { StudioEmptyState } from './StudioEmptyState'
import type { RepoDocument } from './use-repo-documents'

// ponytail: reads at most this many docs (8 at a time); page or index in main if repos outgrow it.
const MAX_GRAPH_DOCS = 300
const READ_CONCURRENCY = 8
const LABEL_MAX_CHARS = 22

async function readContents(
  worktreeId: string,
  documents: readonly RepoDocument[],
  isCancelled: () => boolean
): Promise<Map<string, string>> {
  const settings = getSettingsForWorktreeRuntimeOwner(useAppStore.getState(), worktreeId)
  const connectionId = getConnectionId(worktreeId) ?? undefined
  const contents = new Map<string, string>()
  const queue = [...documents]
  const worker = async (): Promise<void> => {
    for (let doc = queue.shift(); doc && !isCancelled(); doc = queue.shift()) {
      try {
        const result = await readRuntimeFileContent({
          settings,
          filePath: doc.filePath,
          relativePath: doc.relativePath,
          worktreeId,
          connectionId
        })
        if (!result.isBinary) {
          contents.set(doc.relativePath, result.content)
        }
      } catch {
        // An unreadable doc just has no outgoing links; the rest of the graph still draws.
      }
    }
  }
  await Promise.all(Array.from({ length: READ_CONCURRENCY }, worker))
  return contents
}

/** Which repo docs link to which; click a node to open that doc in the editor. */
export function MarkdownLinkGraphView({
  worktreeId,
  documents,
  selectedPath,
  onOpen
}: {
  worktreeId: string
  documents: RepoDocument[]
  selectedPath: string | null
  onOpen: (doc: RepoDocument) => void
}): React.JSX.Element {
  const scanned = useMemo(() => documents.slice(0, MAX_GRAPH_DOCS), [documents])
  const [contents, setContents] = useState<Map<string, string> | null>(null)

  useEffect(() => {
    let cancelled = false
    setContents(null)
    void readContents(worktreeId, scanned, () => cancelled).then((result) => {
      if (!cancelled) {
        setContents(result)
      }
    })
    return () => {
      cancelled = true
    }
  }, [scanned, worktreeId])

  const graph = useMemo(
    () =>
      contents ? layoutMarkdownLinkGraph(scanned, collectMarkdownLinks(scanned, contents)) : null,
    [contents, scanned]
  )

  if (!graph) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-[12px] text-[var(--board-text-muted)]">
        <Loader2 className="size-4 animate-spin" />
        {translate('board.studio.markdown.graphLoading', 'Reading links…')}
      </div>
    )
  }
  if (graph.nodes.length === 0) {
    return (
      <StudioEmptyState
        title={translate('board.studio.markdown.graphEmpty', 'No links between these docs yet.')}
        detail={translate(
          'board.studio.markdown.graphEmptyDetail',
          'Link docs with [[name]] or a relative markdown link and they will show up here.'
        )}
      />
    )
  }

  const nodeByPath = new Map(graph.nodes.map((n) => [n.relativePath, n]))
  const docByPath = new Map(scanned.map((d) => [d.relativePath, d]))
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-auto p-4">
        <svg
          role="img"
          aria-label={translate('board.studio.markdown.graphLabel', 'Markdown link graph')}
          viewBox={`0 0 ${graph.size} ${graph.size}`}
          width={graph.size}
          height={graph.size}
          className="mx-auto block"
        >
          {graph.edges.map((edge) => {
            const from = nodeByPath.get(edge.from)
            const to = nodeByPath.get(edge.to)
            if (!from || !to) {
              return null
            }
            const touchesSelected = edge.from === selectedPath || edge.to === selectedPath
            return (
              <line
                key={`${edge.from}->${edge.to}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={touchesSelected ? 'var(--board-accent)' : 'var(--board-chip-border)'}
                strokeWidth={touchesSelected ? 1.75 : 1}
              />
            )
          })}
          {graph.nodes.map((node) => {
            const doc = docByPath.get(node.relativePath)
            const selected = node.relativePath === selectedPath
            const label =
              node.name.length > LABEL_MAX_CHARS
                ? `${node.name.slice(0, LABEL_MAX_CHARS - 1)}…`
                : node.name
            return (
              <g
                key={node.relativePath}
                role="button"
                tabIndex={0}
                aria-label={node.relativePath}
                className="cursor-pointer outline-none"
                onClick={() => doc && onOpen(doc)}
                onKeyDown={(event) => {
                  if (doc && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault()
                    onOpen(doc)
                  }
                }}
              >
                <title>{node.relativePath}</title>
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={5 + Math.min(node.degree, 8)}
                  fill={selected ? 'var(--board-accent)' : 'var(--board-panel-2)'}
                  stroke="var(--board-accent)"
                  strokeWidth={1.5}
                />
                <text
                  x={node.x}
                  y={node.y + 24}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--board-text)"
                >
                  {label}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
      <footer className="shrink-0 border-t border-[var(--board-panel-border)] px-4 py-2 text-[11px] text-[var(--board-text-muted)]">
        {translate(
          'board.studio.markdown.graphSummary',
          '{{linked}} linked docs · {{links}} links · {{unlinked}} without links',
          { linked: graph.nodes.length, links: graph.edges.length, unlinked: graph.unlinkedCount }
        )}
        {documents.length > MAX_GRAPH_DOCS
          ? ` · ${translate('board.studio.markdown.graphCapped', 'first {{count}} docs scanned', { count: MAX_GRAPH_DOCS })}`
          : ''}
      </footer>
    </div>
  )
}
