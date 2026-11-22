import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { GitStatusEntry, GitStatusResult } from '../../shared/git-status-types'
import type { RuntimeFileOpenResult, RuntimeFileReadResult } from '../../shared/runtime-types'
import type { SearchResult } from '../../shared/types'
import type { CommandHandler, HandlerContext } from '../dispatch'
import {
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getRequiredStringFlag,
  getRequiredStringFlagAllowingEmpty
} from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { getOptionalWorktreeSelector, resolveCurrentWorktreeSelector } from '../selectors'

type FileOpenMode = 'edit' | 'diff'
type OpenChangedMode = FileOpenMode | 'both'

type FileOpenRecord = {
  path: string
  mode: FileOpenMode
  staged?: boolean
  opened: boolean
  kind?: RuntimeFileOpenResult['kind']
  skipped?: boolean
  reason?: string
}

type FileOpenChangedResult = {
  worktree: string
  mode: OpenChangedMode
  opened: FileOpenRecord[]
  skipped: FileOpenRecord[]
  totalChanged: number
}

async function getFileWorktreeSelector({ flags, cwd, client }: HandlerContext): Promise<string> {
  const worktree = flags.get('worktree')
  if (flags.has('worktree') && (typeof worktree !== 'string' || worktree.length === 0)) {
    throw new RuntimeClientError('invalid_argument', 'Missing value for --worktree.')
  }
  const explicit = await getOptionalWorktreeSelector(flags, 'worktree', cwd, client)
  if (explicit) {
    return explicit
  }
  if (client.isRemote) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Remote file commands require --worktree because the client cwd cannot identify a server worktree.'
    )
  }
  return await resolveCurrentWorktreeSelector(cwd, client)
}

function getOpenChangedMode(flags: Map<string, string | boolean>): OpenChangedMode {
  const value = flags.get('mode')
  if (flags.has('mode') && (typeof value !== 'string' || value.length === 0)) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Missing value for --mode. Use edit, diff, or both.'
    )
  }
  const mode = getOptionalStringFlag(flags, 'mode') ?? 'diff'
  if (mode === 'edit' || mode === 'diff' || mode === 'both') {
    return mode
  }
  throw new RuntimeClientError('invalid_argument', 'Invalid --mode. Use edit, diff, or both.')
}

function canOpenEntryForEdit(entry: GitStatusEntry): string | null {
  if (entry.status === 'deleted') {
    return 'deleted file has no edit target'
  }
  if (entry.conflictStatus === 'unresolved') {
    return 'unresolved conflict may not have a single editable file'
  }
  return null
}

async function openFileEdit(
  ctx: HandlerContext,
  worktree: string,
  path: string
): Promise<FileOpenRecord> {
  const result = await ctx.client.call<RuntimeFileOpenResult>('files.open', {
    worktree,
    relativePath: path
  })
  return {
    path,
    mode: 'edit',
    opened: result.result.opened,
    kind: result.result.kind,
    ...(result.result.opened ? {} : { skipped: true, reason: `${result.result.kind} file` })
  }
}

async function openFileDiff(
  ctx: HandlerContext,
  worktree: string,
  path: string,
  staged: boolean
): Promise<FileOpenRecord> {
  const result = await ctx.client.call<RuntimeFileOpenResult>('files.openDiff', {
    worktree,
    relativePath: path,
    staged
  })
  return {
    path,
    mode: 'diff',
    staged,
    opened: result.result.opened,
    kind: result.result.kind,
    ...(result.result.opened ? {} : { skipped: true, reason: `${result.result.kind} file` })
  }
}

function formatOpenChangedResult(result: FileOpenChangedResult): string {
  if (result.totalChanged === 0) {
    return 'No changed files.'
  }
  const lines = [`Opened ${result.opened.length} changed file targets.`]
  if (result.skipped.length > 0) {
    lines.push(`Skipped ${result.skipped.length} changed file targets:`)
    for (const skipped of result.skipped) {
      lines.push(`- ${skipped.path}: ${skipped.reason ?? 'not opened'}`)
    }
  }
  return lines.join('\n')
}

function formatFileOpen(result: RuntimeFileOpenResult): string {
  return result.opened
    ? `Opened ${result.relativePath}.`
    : `Did not open ${result.relativePath}: ${result.kind} file.`
}

function formatFileDiff(result: RuntimeFileOpenResult): string {
  return result.opened
    ? `Opened diff for ${result.relativePath}.`
    : `Did not open diff for ${result.relativePath}: ${result.kind} file.`
}

type FileWriteResult = { relativePath: string; bytes: number }
type FileSearchResult = SearchResult

const MAX_SEARCH_LIMIT = 2000
// Why: matches the server cap, so a huge pipe or file fails here instead of
// being buffered whole and then refused.
const MAX_WRITE_BYTES = 5 * 1024 * 1024

function tooLarge(): never {
  throw new RuntimeClientError('invalid_argument', 'File content is too large (5 MB max).')
}

async function readStdinText(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new RuntimeClientError('invalid_argument', '--stdin was passed but stdin is a terminal')
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    total += buffer.byteLength
    if (total > MAX_WRITE_BYTES) {
      tooLarge()
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Exactly one source: --content (may be empty on purpose), --stdin, or --from-file. */
async function getWriteContent(ctx: HandlerContext): Promise<string> {
  const sources = ['content', 'stdin', 'from-file'].filter((name) => ctx.flags.has(name))
  if (sources.length !== 1) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Pass exactly one of --content <text>, --stdin or --from-file <path>.'
    )
  }
  if (ctx.flags.has('content')) {
    return getRequiredStringFlagAllowingEmpty(ctx.flags, 'content')
  }
  if (ctx.flags.has('stdin')) {
    if (ctx.flags.get('stdin') !== true) {
      throw new RuntimeClientError('invalid_argument', '--stdin takes no value')
    }
    return await readStdinText()
  }
  const file = resolve(ctx.cwd, getRequiredStringFlag(ctx.flags, 'from-file'))
  let size: number
  try {
    size = statSync(file).size
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new RuntimeClientError('invalid_argument', `Could not read --from-file: ${message}`)
  }
  if (size > MAX_WRITE_BYTES) {
    tooLarge()
  }
  try {
    return readFileSync(file, 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new RuntimeClientError('invalid_argument', `Could not read --from-file: ${message}`)
  }
}

function formatSearch(result: FileSearchResult): string {
  if (result.files.length === 0) {
    return 'No matches.'
  }
  const lines: string[] = []
  for (const file of result.files) {
    for (const match of file.matches) {
      lines.push(`${file.relativePath}:${match.line}: ${match.lineContent.trim()}`)
    }
  }
  if (result.truncated) {
    lines.push('(more matches not shown; raise --limit or narrow --include)')
  }
  return lines.join('\n')
}

export const FILE_HANDLERS: Record<string, CommandHandler> = {
  'file open': async (ctx) => {
    const relativePath = getRequiredStringFlag(ctx.flags, 'path')
    const worktree = await getFileWorktreeSelector(ctx)
    const result = await ctx.client.call<RuntimeFileOpenResult>('files.open', {
      worktree,
      relativePath
    })
    printResult(result, ctx.json, formatFileOpen)
  },
  'file diff': async (ctx) => {
    const relativePath = getRequiredStringFlag(ctx.flags, 'path')
    const staged = ctx.flags.get('staged') === true
    const worktree = await getFileWorktreeSelector(ctx)
    const result = await ctx.client.call<RuntimeFileOpenResult>('files.openDiff', {
      worktree,
      relativePath,
      staged
    })
    printResult(result, ctx.json, formatFileDiff)
  },
  'file read': async (ctx) => {
    const relativePath = getRequiredStringFlag(ctx.flags, 'path')
    const worktree = await getFileWorktreeSelector(ctx)
    const result = await ctx.client.call<RuntimeFileReadResult>('files.agentRead', {
      worktree,
      relativePath
    })
    printResult(result, ctx.json, (value) => value.content)
  },
  'file write': async (ctx) => {
    const relativePath = getRequiredStringFlag(ctx.flags, 'path')
    const content = await getWriteContent(ctx)
    const worktree = await getFileWorktreeSelector(ctx)
    const result = await ctx.client.call<FileWriteResult>('files.agentWrite', {
      worktree,
      relativePath,
      content
    })
    printResult(result, ctx.json, (value) => `Wrote ${value.bytes} bytes to ${value.relativePath}.`)
  },
  'file search': async (ctx) => {
    const query = getRequiredStringFlag(ctx.flags, 'query')
    const limit = getOptionalPositiveIntegerFlag(ctx.flags, 'limit')
    if (limit !== undefined && limit > MAX_SEARCH_LIMIT) {
      throw new RuntimeClientError('invalid_argument', `--limit is at most ${MAX_SEARCH_LIMIT}`)
    }
    const worktree = await getFileWorktreeSelector(ctx)
    const result = await ctx.client.call<FileSearchResult>('files.agentSearch', {
      worktree,
      query,
      caseSensitive: ctx.flags.get('case-sensitive') === true,
      wholeWord: ctx.flags.get('whole-word') === true,
      includePattern: getOptionalStringFlag(ctx.flags, 'include'),
      excludePattern: getOptionalStringFlag(ctx.flags, 'exclude'),
      ...(limit !== undefined ? { maxResults: limit } : {})
    })
    printResult(result, ctx.json, formatSearch)
  },
  'file open-changed': async (ctx) => {
    const mode = getOpenChangedMode(ctx.flags)
    const worktree = await getFileWorktreeSelector(ctx)
    const status = await ctx.client.call<GitStatusResult>('git.status', { worktree })
    const opened: FileOpenRecord[] = []
    const skipped: FileOpenRecord[] = []
    const openedEditPaths = new Set<string>()

    for (const entry of status.result.entries) {
      if (mode === 'edit' || mode === 'both') {
        const editSkipReason = canOpenEntryForEdit(entry)
        if (editSkipReason) {
          skipped.push({
            path: entry.path,
            mode: 'edit',
            opened: false,
            skipped: true,
            reason: editSkipReason
          })
        } else if (!openedEditPaths.has(entry.path)) {
          openedEditPaths.add(entry.path)
          const record = await openFileEdit(ctx, worktree, entry.path)
          const records = record.opened ? opened : skipped
          records.push(record)
        }
      }

      if (mode === 'diff' || mode === 'both') {
        const staged = entry.area === 'staged'
        if (entry.conflictStatus === 'unresolved') {
          skipped.push({
            path: entry.path,
            mode: 'diff',
            staged,
            opened: false,
            skipped: true,
            reason: 'unresolved conflict may not have a single diff target'
          })
        } else {
          const record = await openFileDiff(ctx, worktree, entry.path, staged)
          const records = record.opened ? opened : skipped
          records.push(record)
        }
      }
    }

    printResult(
      {
        ...status,
        result: {
          worktree,
          mode,
          opened,
          skipped,
          totalChanged: status.result.entries.length
        }
      },
      ctx.json,
      formatOpenChangedResult
    )
  }
}
