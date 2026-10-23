import { useCallback, useEffect, useRef, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { useMobileDataCatalogPreview } from './use-mobile-data-catalog-preview'
import type { PreviewInvalidationSource } from '../../../src/shared/data-catalog-preview-invalidation'
import {
  EMPTY_MOBILE_CATALOG_PAGE,
  EMPTY_MOBILE_CATALOG_ROOTS,
  MOBILE_CATALOG_MAX_LOADED_ENTRIES,
  MOBILE_CATALOG_PAGE_SIZE,
  parseMobileCatalogPage,
  parseMobileCatalogRoots,
  unavailableMobileCatalogPage,
  type MobileCatalogPageState,
  type MobileCatalogRootsState
} from './mobile-data-catalog-reader-state'

export function useMobileDataCatalog(
  hostId: string,
  client: Pick<RpcClient, 'sendRequest'> | null,
  connected: boolean,
  invalidationSource: PreviewInvalidationSource | null = null
) {
  const [rootsValue, setRootsValue] = useState<{
    hostId: string
    state: MobileCatalogRootsState
  } | null>(null)
  const [selection, setSelection] = useState<{
    hostId: string
    rootId: string
    generation: string
  } | null>(null)
  const [pageValue, setPageValue] = useState<{
    key: string
    state: MobileCatalogPageState
  } | null>(null)
  const rootsRequest = useRef(0)
  const pageRequest = useRef(0)
  const loadMoreInFlight = useRef<string | null>(null)
  const roots = rootsValue?.hostId === hostId ? rootsValue.state : EMPTY_MOBILE_CATALOG_ROOTS
  const selectedRoot =
    selection?.hostId === hostId
      ? (roots.roots.find(
          (root) => root.rootId === selection.rootId && root.generation === selection.generation
        ) ?? null)
      : null
  const pageKey = selectedRoot ? `${hostId}:${selectedRoot.rootId}:${selectedRoot.generation}` : ''
  const page = pageValue?.key === pageKey ? pageValue.state : EMPTY_MOBILE_CATALOG_PAGE
  const previewState = useMobileDataCatalogPreview(
    hostId,
    client,
    connected,
    selectedRoot,
    invalidationSource
  )

  const refreshRoots = useCallback(async () => {
    const request = ++rootsRequest.current
    if (!client || !connected) {
      setRootsValue({
        hostId,
        state: {
          ...EMPTY_MOBILE_CATALOG_ROOTS,
          phase: 'unavailable',
          error: 'Connect to this host to view its registered folders.'
        }
      })
      setSelection(null)
      return
    }
    setRootsValue({
      hostId,
      state: { ...EMPTY_MOBILE_CATALOG_ROOTS, phase: 'loading' }
    })
    try {
      const response = await client.sendRequest('data.catalog.roots')
      const result = rpcResult(response)
      const parsed = parseMobileCatalogRoots(result)
      if (request !== rootsRequest.current) {
        return
      }
      if (!parsed) {
        setRootsValue({
          hostId,
          state: {
            ...EMPTY_MOBILE_CATALOG_ROOTS,
            phase: 'unavailable',
            error: 'The catalog response was invalid.'
          }
        })
        setSelection(null)
        return
      }
      setRootsValue({
        hostId,
        state: {
          ...parsed
        }
      })
      setSelection((current) => {
        if (current?.hostId !== hostId) {
          return null
        }
        return parsed.roots.some(
          (root) => root.rootId === current.rootId && root.generation === current.generation
        )
          ? current
          : null
      })
    } catch (error) {
      if (request !== rootsRequest.current) {
        return
      }
      setRootsValue({
        hostId,
        state: {
          ...EMPTY_MOBILE_CATALOG_ROOTS,
          phase: 'unavailable',
          error: error instanceof Error ? error.message : 'Catalog is unavailable on this host.'
        }
      })
      setSelection(null)
    }
  }, [client, connected, hostId])

  useEffect(() => {
    const rootsRequestSequence = rootsRequest
    const pageRequestSequence = pageRequest
    ++pageRequestSequence.current
    setSelection(null)
    setPageValue(null)
    if (!client || !connected) {
      ++rootsRequestSequence.current
      setRootsValue({
        hostId,
        state: {
          ...EMPTY_MOBILE_CATALOG_ROOTS,
          phase: 'unavailable',
          error: 'Connect to this host to view its registered folders.'
        }
      })
      return
    }
    void refreshRoots()
    return () => {
      ++rootsRequestSequence.current
      ++pageRequestSequence.current
    }
  }, [client, connected, hostId, refreshRoots])

  useEffect(() => {
    const pageRequestSequence = pageRequest
    if (!selectedRoot || !client || !connected || !pageKey) {
      ++pageRequestSequence.current
      setPageValue(null)
      return
    }
    const request = ++pageRequest.current
    setPageValue({
      key: pageKey,
      state: { ...EMPTY_MOBILE_CATALOG_PAGE, phase: 'loading' }
    })
    void client
      .sendRequest('data.catalog.page', {
        rootId: selectedRoot.rootId,
        pageSize: MOBILE_CATALOG_PAGE_SIZE
      })
      .then((response) => {
        if (request !== pageRequest.current) {
          return
        }
        setPageValue({
          key: pageKey,
          state: parseMobileCatalogPage(rpcResult(response), selectedRoot.rootId)
        })
      })
      .catch((error: unknown) => {
        if (request !== pageRequest.current) {
          return
        }
        setPageValue({
          key: pageKey,
          state: unavailableMobileCatalogPage(error)
        })
      })
    return () => {
      ++pageRequestSequence.current
    }
  }, [client, connected, pageKey, selectedRoot])

  const selectRoot = useCallback(
    (rootId: string) => {
      const root = roots.roots.find((candidate) => candidate.rootId === rootId)
      setSelection(root ? { hostId, rootId, generation: root.generation } : null)
    },
    [hostId, roots.roots]
  )

  const loadMore = useCallback(async () => {
    if (
      !client ||
      !connected ||
      !selectedRoot ||
      !pageKey ||
      !page.cursor ||
      page.phase === 'loading'
    ) {
      return
    }
    const requestKey = `${pageKey}:${page.cursor}`
    if (requestKey === loadMoreInFlight.current) {
      return
    }
    if (page.entries.length >= MOBILE_CATALOG_MAX_LOADED_ENTRIES) {
      setPageValue({
        key: pageKey,
        state: {
          ...page,
          phase: 'partial',
          cursor: null,
          reason: 'response_limit'
        }
      })
      return
    }
    loadMoreInFlight.current = requestKey
    const request = ++pageRequest.current
    const previousEntries = page.entries
    setPageValue({ key: pageKey, state: { ...page, phase: 'loading', error: null } })
    try {
      const response = await client.sendRequest('data.catalog.page', {
        rootId: selectedRoot.rootId,
        cursor: page.cursor,
        pageSize: MOBILE_CATALOG_PAGE_SIZE
      })
      if (request !== pageRequest.current) {
        return
      }
      setPageValue({
        key: pageKey,
        state: parseMobileCatalogPage(rpcResult(response), selectedRoot.rootId, previousEntries)
      })
    } catch (error) {
      if (request !== pageRequest.current) {
        return
      }
      setPageValue({ key: pageKey, state: unavailableMobileCatalogPage(error, page) })
    } finally {
      if (loadMoreInFlight.current === requestKey) {
        loadMoreInFlight.current = null
      }
    }
  }, [client, connected, page, pageKey, selectedRoot])

  const refreshRoot = useCallback(async () => {
    if (!client || !connected || !selectedRoot || !pageKey) {
      return
    }
    const request = ++pageRequest.current
    setPageValue({
      key: pageKey,
      state: { ...EMPTY_MOBILE_CATALOG_PAGE, phase: 'loading' }
    })
    try {
      const response = await client.sendRequest('data.catalog.page', {
        rootId: selectedRoot.rootId,
        pageSize: MOBILE_CATALOG_PAGE_SIZE
      })
      if (request !== pageRequest.current) {
        return
      }
      setPageValue({
        key: pageKey,
        state: parseMobileCatalogPage(rpcResult(response), selectedRoot.rootId)
      })
    } catch (error) {
      if (request !== pageRequest.current) {
        return
      }
      setPageValue({
        key: pageKey,
        state: {
          ...unavailableMobileCatalogPage(error)
        }
      })
    }
  }, [client, connected, pageKey, selectedRoot])

  return {
    roots,
    selectedRoot,
    page,
    ...previewState,
    selectRoot,
    refreshRoots,
    refreshRoot,
    loadMore
  }
}

function rpcResult(response: RpcResponse): unknown {
  if (!response.ok) {
    throw new Error(response.error?.message || 'Catalog request failed.')
  }
  return response.result
}
