import type { CommandHandler } from '../dispatch'
import { getOptionalPositiveIntegerFlag, getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { safeText } from '../safe-text'

const SOURCES = ['claude', 'codex', 'project', 'adam', 'obsidian'] as const
type Source = (typeof SOURCES)[number]

export type LibraryHitResult = {
  source: Source
  project: string | null
  title: string
  path: string
  when: string
  snippet: string
}

type SearchResult = { results: LibraryHitResult[] }

type StatusResult = {
  fullTextSearch: boolean
  sizeBytes: number
  capBytes: number
  refreshing: boolean
  lastRefresh: {
    finishedAt: string
    durationMs: number
    indexed: number
    unchanged: number
    removed: number
    evicted: number
    compacted?: number
    droppedChunks: number
    stopped?: string | null
    errors: string[]
  } | null
  sources: { source: Source; documents: number; chunks: number; textBytes: number }[]
  classes?: { kind: string; documents: number; compacted: number }[]
}

const CLASS_NAMES: Record<string, string> = {
  'work-done': 'Finished work',
  'work-open': 'Unfinished work',
  chat: 'Chats',
  reference: 'Notes and docs'
}

const SOURCE_NAMES: Record<Source, string> = {
  claude: 'Claude conversation',
  codex: 'Codex conversation',
  project: 'Project notes',
  adam: 'ADAM conversation',
  obsidian: 'Obsidian note'
}

function day(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? 'unknown date'
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** "Claude conversation in epoxyitright on Nov 22, 2026". */
export function describeHit(hit: LibraryHitResult): string {
  const where = hit.project ? ` in ${hit.project}` : ''
  return `${SOURCE_NAMES[hit.source] ?? hit.source}${where} on ${day(hit.when)}`
}

export function formatLibrarySearch(result: SearchResult): string {
  if (result.results.length === 0) {
    return 'Nothing in the library matches that.'
  }
  return result.results
    .map((hit, index) =>
      [
        `${index + 1}. ${safeText(describeHit(hit))}: ${safeText(hit.title)}`,
        `   ${safeText(hit.snippet)}`,
        `   ${safeText(hit.path)}`
      ].join('\n')
    )
    .join('\n\n')
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatLibraryStatus(status: StatusResult): string {
  const lines = [
    `Library: ${megabytes(status.sizeBytes)} of ${megabytes(status.capBytes)}${
      status.fullTextSearch ? '' : ' (simple search: full-text search is unavailable)'
    }${status.refreshing ? ', refreshing now' : ''}.`
  ]
  for (const source of status.sources) {
    lines.push(
      `  ${SOURCE_NAMES[source.source] ?? source.source}s: ${source.documents} (${source.chunks} passages, ${megabytes(source.textBytes)} of text)`
    )
  }
  if (status.classes && status.classes.length > 0) {
    lines.push(
      `  By kind: ${status.classes
        .map((entry) => `${CLASS_NAMES[entry.kind] ?? safeText(entry.kind)} ${entry.documents}${entry.compacted > 0 ? ` (${entry.compacted} compacted)` : ''}`)
        .join(', ')}.`
    )
  }
  const last = status.lastRefresh
  if (!last) {
    lines.push('Not refreshed yet (the first pass runs two minutes after the app starts).')
  } else {
    lines.push(
      `Last refresh: ${new Date(last.finishedAt).toLocaleString('en-US')}, ${Math.round(last.durationMs / 1000)}s: ${last.indexed} read, ${last.unchanged} unchanged, ${last.removed} removed, ${last.compacted ?? 0} compacted, ${last.evicted} dropped for space.`
    )
    if (last.stopped) {
      lines.push(`  It stopped early: ${last.stopped}.`)
    }
    if (last.errors.length > 0) {
      lines.push(`  ${last.errors.length} could not be read, e.g. ${last.errors[0]}`)
    }
  }
  return lines.join('\n')
}

function getSource(flags: Map<string, string | boolean>): Source | undefined {
  const value = getOptionalStringFlag(flags, 'source')?.toLowerCase()
  if (value === undefined) {
    return undefined
  }
  if (!(SOURCES as readonly string[]).includes(value)) {
    throw new RuntimeClientError('invalid_argument', `Source must be one of: ${SOURCES.join(', ')}`)
  }
  return value as Source
}

export const LIBRARY_HANDLERS: Record<string, CommandHandler> = {
  'library search': async ({ flags, client, json }) => {
    const query = getRequiredStringFlag(flags, 'query')
    const project = getOptionalStringFlag(flags, 'project')
    const source = getSource(flags)
    const limit = getOptionalPositiveIntegerFlag(flags, 'limit')
    const result = await client.call<SearchResult>('library.search', {
      query,
      ...(project ? { project } : {}),
      ...(source ? { source } : {}),
      ...(limit !== undefined ? { limit } : {})
    })
    printResult(result, json, formatLibrarySearch)
  },
  'library status': async ({ client, json }) => {
    const result = await client.call<StatusResult>('library.status')
    printResult(result, json, formatLibraryStatus)
  }
}
