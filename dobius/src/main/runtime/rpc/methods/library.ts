// The library over RPC (CLI `dobius library search|status`). Read-only, and
// only for callers on this Mac holding the full runtime key: the index holds
// every conversation, so a paired phone or a sandboxed agent key (default
// deny, agent-rpc-scope.ts) gets nothing.
import { z } from 'zod'
import { getLibraryService } from '../../../library/library-app'
import {
  LIBRARY_MAX_RESULTS,
  LIBRARY_SOURCES,
  type LibraryHit,
  type LibrarySearchQuery,
  type LibraryStatus
} from '../../../library/library-types'
import { defineMethod, type RpcContext, type RpcMethod } from '../core'

const Search = z
  .object({
    query: z.string().trim().min(1, 'Missing search words').max(500, 'Search is too long'),
    project: z.string().trim().min(1).max(120).optional(),
    source: z.enum(LIBRARY_SOURCES).optional(),
    limit: z.number().int().min(1).max(LIBRARY_MAX_RESULTS).optional()
  })
  .strict()

export type LibraryMethodDeps = {
  search: (query: LibrarySearchQuery) => LibraryHit[]
  status: () => LibraryStatus
}

const LIVE_DEPS: LibraryMethodDeps = {
  search: (query) => getLibraryService().search(query),
  status: () => getLibraryService().status()
}

export const LIBRARY_LOCAL_ONLY = 'The library is only available from this Mac.'

function requireLocal(ctx: RpcContext): void {
  if (ctx.authenticatedLocal !== true) {
    throw new Error(LIBRARY_LOCAL_ONLY)
  }
}

export function buildLibraryMethods(deps: LibraryMethodDeps = LIVE_DEPS): RpcMethod[] {
  return [
    defineMethod({
      name: 'library.search',
      params: Search,
      handler: (params, ctx) => {
        requireLocal(ctx)
        return { results: deps.search(params) }
      }
    }),
    defineMethod({
      name: 'library.status',
      params: null,
      handler: (_params, ctx) => {
        requireLocal(ctx)
        return deps.status()
      }
    })
  ]
}

export const LIBRARY_METHODS: RpcMethod[] = buildLibraryMethods()
