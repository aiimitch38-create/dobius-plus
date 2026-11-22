import { z } from 'zod'
import type { SearchResult } from '../../../../shared/types'
import {
  AgentFileRefusedError,
  SECRET_SEARCH_EXCLUDE_GLOBS,
  assertAgentReadAllowed,
  assertAgentWriteAllowed,
  isSecretLookingPath
} from '../../agent-file-guard'
import { defineMethod, type RpcMethod } from '../core'
import { requiredString } from '../schemas'

/* Guarded file methods for `dobius file read|write|search`. Agents in Dobius
 * terminals hold the full runtime key, so these refuse paths outside the
 * named Dobius-managed worktree and secret-looking files before delegating to
 * the same runtime file commands the app uses. */

const MAX_WRITE_CHARS = 5 * 1024 * 1024
const MAX_SEARCH_RESULTS = 2000

const AgentFilePath = z.object({
  worktree: requiredString('Missing worktree selector'),
  relativePath: requiredString('Missing relative path')
})

const AgentFileWrite = AgentFilePath.extend({
  // Why: a missing content must error, never truncate the file to empty.
  content: z
    .unknown()
    .refine((v): v is string => typeof v === 'string', { message: 'Missing file content' })
    .pipe(z.string().max(MAX_WRITE_CHARS, 'File content is too large (5 MB max)'))
})

// Why: a trailing backslash escapes whatever the glob splitter sees next.
const UserGlob = z
  .string()
  .max(1000)
  .refine((value) => !value.trimEnd().endsWith('\\'), {
    message: 'Search patterns may not end in a backslash'
  })
  .optional()

const AgentFileSearch = z.object({
  worktree: requiredString('Missing worktree selector'),
  query: requiredString('Missing search query'),
  caseSensitive: z.boolean().optional(),
  wholeWord: z.boolean().optional(),
  // Why no useRegex: without ripgrep the fallback matches caller regexes in
  // Electron main, where a catastrophic-backtracking pattern freezes the app.
  includePattern: UserGlob,
  excludePattern: UserGlob,
  maxResults: z.number().int().positive().max(MAX_SEARCH_RESULTS).optional()
})

/** Belt and braces after the exclude globs (the name rules also fold
 *  Unicode). Nothing about a dropped file reaches the caller: totals and
 *  truncated are computed from the kept matches only, since a count would let
 *  a caller probe a secret's content one query at a time. */
export function withoutSecretFiles(result: SearchResult, maxResults: number): SearchResult {
  const files = result.files.filter((file) => !isSecretLookingPath(file.relativePath))
  const totalMatches = files.reduce(
    (sum, file) => sum + (file.matchCount ?? file.matches.length),
    0
  )
  // Why the backend flag counts only when nothing was dropped: it also marks a
  // timeout, but after a drop it could be the secret file that hit the limit.
  const dropped = files.length !== result.files.length
  return {
    files,
    totalMatches,
    truncated: totalMatches >= maxResults || (result.truncated && !dropped)
  }
}

export const AGENT_FILE_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'files.agentRead',
    params: AgentFilePath,
    handler: async (params, { runtime }) => {
      const { worktreeId, root, connectionId } = await runtime.resolveAgentFileTarget(params.worktree)
      const worktree = `id:${worktreeId}`
      await assertAgentReadAllowed({
        worktreeRoot: root,
        relativePath: params.relativePath,
        connectionId
      })
      return runtime.readMobileFile(worktree, params.relativePath)
    }
  }),
  defineMethod({
    name: 'files.agentWrite',
    params: AgentFileWrite,
    handler: async (params, { runtime }) => {
      const { worktreeId, root, connectionId } = await runtime.resolveAgentFileTarget(params.worktree)
      const worktree = `id:${worktreeId}`
      await assertAgentWriteAllowed({
        worktreeRoot: root,
        relativePath: params.relativePath,
        connectionId
      })
      await runtime.writeFileExplorerFile(worktree, params.relativePath, params.content)
      return {
        relativePath: params.relativePath,
        bytes: Buffer.byteLength(params.content, 'utf8')
      }
    }
  }),
  defineMethod({
    name: 'files.agentSearch',
    params: AgentFileSearch,
    handler: async (params, { runtime }) => {
      const { worktreeId, connectionId } = await runtime.resolveAgentFileTarget(params.worktree)
      const worktree = `id:${worktreeId}`
      // Why: the SSH relay may predate caseInsensitiveExcludeGlobs and would
      // then search secret files; refuse rather than rely on the post-filter.
      if (connectionId) {
        throw new AgentFileRefusedError("file search isn't available for remote worktrees yet")
      }
      const maxResults = params.maxResults ?? 200
      const result = await runtime.searchRuntimeFiles(worktree, {
        query: params.query,
        caseSensitive: params.caseSensitive,
        wholeWord: params.wholeWord,
        useRegex: false,
        includePattern: params.includePattern,
        excludePattern: params.excludePattern,
        // Why separate: never merged into the user's comma string, so no
        // escape or comma in excludePattern can unhook a secret exclude.
        caseInsensitiveExcludeGlobs: SECRET_SEARCH_EXCLUDE_GLOBS,
        maxResults
      })
      return withoutSecretFiles(result, maxResults)
    }
  })
]
