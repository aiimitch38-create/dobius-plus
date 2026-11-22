import { z } from 'zod'
import type { SearchResult } from '../../../../shared/types'
import {
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

const AgentFileSearch = z.object({
  worktree: requiredString('Missing worktree selector'),
  query: requiredString('Missing search query'),
  caseSensitive: z.boolean().optional(),
  wholeWord: z.boolean().optional(),
  // Why no useRegex: without ripgrep the fallback matches caller regexes in
  // Electron main, where a catastrophic-backtracking pattern freezes the app.
  includePattern: z.string().max(1000).optional(),
  excludePattern: z.string().max(1000).optional(),
  maxResults: z.number().int().positive().max(MAX_SEARCH_RESULTS).optional()
})

export function excludeSecretsPattern(excludePattern: string | undefined): string {
  const user = excludePattern?.trim()
  return [...(user ? [user] : []), ...SECRET_SEARCH_EXCLUDE_GLOBS].join(',')
}

/** Belt and braces after the exclude globs (they are case-sensitive, the name
 *  rules fold case). Says nothing about what was dropped: a count would let a
 *  caller probe a secret's content one query at a time. */
export function withoutSecretFiles(result: SearchResult): SearchResult {
  const files = result.files.filter((file) => !isSecretLookingPath(file.relativePath))
  return {
    files,
    totalMatches: files.reduce((sum, file) => sum + (file.matchCount ?? file.matches.length), 0),
    truncated: result.truncated
  }
}

export const AGENT_FILE_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'files.agentRead',
    params: AgentFilePath,
    handler: async (params, { runtime }) => {
      const { root, connectionId } = await runtime.resolveMobileWriteRoot(params.worktree)
      await assertAgentReadAllowed({
        worktreeRoot: root,
        relativePath: params.relativePath,
        connectionId
      })
      return runtime.readMobileFile(params.worktree, params.relativePath)
    }
  }),
  defineMethod({
    name: 'files.agentWrite',
    params: AgentFileWrite,
    handler: async (params, { runtime }) => {
      const { root, connectionId } = await runtime.resolveMobileWriteRoot(params.worktree)
      await assertAgentWriteAllowed({
        worktreeRoot: root,
        relativePath: params.relativePath,
        connectionId
      })
      await runtime.writeFileExplorerFile(params.worktree, params.relativePath, params.content)
      return {
        relativePath: params.relativePath,
        bytes: Buffer.byteLength(params.content, 'utf8')
      }
    }
  }),
  defineMethod({
    name: 'files.agentSearch',
    params: AgentFileSearch,
    handler: async (params, { runtime }) =>
      withoutSecretFiles(
        await runtime.searchRuntimeFiles(params.worktree, {
          query: params.query,
          caseSensitive: params.caseSensitive,
          wholeWord: params.wholeWord,
          useRegex: false,
          includePattern: params.includePattern,
          excludePattern: excludeSecretsPattern(params.excludePattern),
          maxResults: params.maxResults ?? 200
        })
      )
  })
]
