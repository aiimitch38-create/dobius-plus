import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { callRuntimeRpc } from '../../runtime/runtime-rpc-client'
import { useDataCatalogPreview } from './use-data-catalog-preview'
import type { PreviewInvalidationSource } from '../../../../shared/data-catalog-preview-invalidation'
import {
  DESKTOP_CATALOG_MAX_LOADED_ENTRIES,
  DESKTOP_CATALOG_PAGE_SIZE,
  EMPTY_DESKTOP_CATALOG_PAGE,
  EMPTY_DESKTOP_CATALOG_ROOTS,
  desktopCatalogTargetForKey,
  desktopCatalogTargetKey,
  parseDesktopCatalogPage,
  parseDesktopCatalogRoots,
  unavailableDesktopCatalogPage,
  type DesktopCatalogTarget,
  type DesktopCatalogPageState,
  type DesktopCatalogRootsState
} from './data-catalog-reader-state'
export { catalogTargetFromSelection, desktopCatalogTargetKey } from './data-catalog-reader-state'

export function useDataCatalog(
  target: DesktopCatalogTarget,
  invalidationSource: PreviewInvalidationSource | null = null
) {
  const targetKey = desktopCatalogTargetKey(target)
  const stableTarget = useMemo(() => desktopCatalogTargetForKey(targetKey), [targetKey])
  const [rootsValue, setRootsValue] = useState<{
    key: string | null
    state: DesktopCatalogRootsState
  }>({
    key: null,
    state: EMPTY_DESKTOP_CATALOG_ROOTS
  })
  const [selection, setSelection] = useState<{
    targetKey: string
    rootId: string
    generation: string
  } | null>(null)
  const [pageValue, setPageValue] = useState<{
    key: string | null
    state: DesktopCatalogPageState
  }>({ key: null, state: EMPTY_DESKTOP_CATALOG_PAGE })
  const rootsRequest = useRef(0)
  const pageRequest = useRef(0)
  const loadMoreInFlight = useRef<string | null>(null)
  const roots = rootsValue.key === targetKey ? rootsValue.state : EMPTY_DESKTOP_CATALOG_ROOTS
  const selectedRoot = useMemo(
    () =>
      selection?.targetKey === targetKey
        ? (roots.roots.find(
            (root) => root.rootId === selection.rootId && root.generation === selection.generation
          ) ?? null)
        : null,
    [roots.roots, selection, targetKey]
  )
  const pageKey = selectedRoot
    ? `${targetKey}:${selectedRoot.rootId}:${selectedRoot.generation}`
    : null
  const page = pageValue.key === pageKey ? pageValue.state : EMPTY_DESKTOP_CATALOG_PAGE
  const previewState = useDataCatalogPreview(stableTarget, selectedRoot, invalidationSource)

  const refreshRoots = useCallback(async () => {
    const request = ++rootsRequest.current
    if (!stableTarget || !targetKey) {
      setRootsValue({ key: null, state: EMPTY_DESKTOP_CATALOG_ROOTS })
      setSelection(null)
      return
    }
    setRootsValue({
      key: targetKey,
      state: { ...EMPTY_DESKTOP_CATALOG_ROOTS, phase: 'loading' }
    })
    try {
      const raw = await callRuntimeRpc<unknown>(stableTarget, 'data.catalog.roots', undefined, {
        timeoutMs: 15_000
      })
      const parsed = parseDesktopCatalogRoots(raw)
      if (request !== rootsRequest.current) {
        return
      }
      if (!parsed) {
        setRootsValue({
          key: targetKey,
          state: {
            ...EMPTY_DESKTOP_CATALOG_ROOTS,
            phase: 'unavailable',
            error: 'The catalog response was invalid.'
          }
        })
        setSelection(null)
        return
      }
      const nextRoots = parsed.roots
      setRootsValue({
        key: targetKey,
        state: parsed
      })
      setSelection((current) => {
        if (current?.targetKey !== targetKey) {
          return null
        }
        const existing = nextRoots.find(
          (root) => root.rootId === current.rootId && root.generation === current.generation
        )
        return existing ? current : null
      })
    } catch (error) {
      if (request !== rootsRequest.current) {
        return
      }
      setRootsValue({
        key: targetKey,
        state: {
          ...EMPTY_DESKTOP_CATALOG_ROOTS,
          phase: 'unavailable',
          error: error instanceof Error ? error.message : 'Catalog is unavailable on this host.'
        }
      })
      setSelection(null)
    }
  }, [stableTarget, targetKey])

  useEffect(() => {
    const rootsRequestSequence = rootsRequest
    const pageRequestSequence = pageRequest
    if (!stableTarget || !targetKey) {
      ++rootsRequestSequence.current
      ++pageRequestSequence.current
      setRootsValue({ key: null, state: EMPTY_DESKTOP_CATALOG_ROOTS })
      setSelection(null)
      setPageValue({ key: null, state: EMPTY_DESKTOP_CATALOG_PAGE })
      return
    }
    void refreshRoots()
    return () => {
      ++rootsRequestSequence.current
      ++pageRequestSequence.current
    }
  }, [refreshRoots, stableTarget, targetKey])

  useEffect(() => {
    const pageRequestSequence = pageRequest
    if (!selectedRoot || !stableTarget || !targetKey || !pageKey) {
      ++pageRequestSequence.current
      setPageValue({ key: null, state: EMPTY_DESKTOP_CATALOG_PAGE })
      return
    }
    const request = ++pageRequest.current
    const rootId = selectedRoot.rootId
    setPageValue({
      key: pageKey,
      state: { ...EMPTY_DESKTOP_CATALOG_PAGE, phase: 'loading' }
    })
    void callRuntimeRpc<unknown>(
      stableTarget,
      'data.catalog.page',
      { rootId, pageSize: DESKTOP_CATALOG_PAGE_SIZE },
      {
        timeoutMs: 15_000
      }
    )
      .then((raw) => {
        if (request !== pageRequest.current) {
          return
        }
        setPageValue({ key: pageKey, state: parseDesktopCatalogPage(raw, rootId) })
      })
      .catch((error: unknown) => {
        if (request !== pageRequest.current) {
          return
        }
        setPageValue({ key: pageKey, state: unavailableDesktopCatalogPage(error) })
      })
    return () => {
      ++pageRequestSequence.current
    }
  }, [pageKey, selectedRoot, stableTarget, targetKey])

  const selectRoot = useCallback(
    (rootId: string) => {
      const root = roots.roots.find((candidate) => candidate.rootId === rootId)
      setSelection(root && targetKey ? { targetKey, rootId, generation: root.generation } : null)
    },
    [roots.roots, targetKey]
  )

  const loadMore = useCallback(async () => {
    const cursor = page.cursor
    if (
      !selectedRoot ||
      !stableTarget ||
      !targetKey ||
      !pageKey ||
      !cursor ||
      page.phase === 'loading'
    ) {
      return
    }
    const requestKey = `${pageKey}:${cursor}`
    if (requestKey === loadMoreInFlight.current) {
      return
    }
    if (page.entries.length >= DESKTOP_CATALOG_MAX_LOADED_ENTRIES) {
      setPageValue((current) =>
        current.key === pageKey
          ? {
              ...current,
              state: {
                ...current.state,
                phase: 'partial',
                cursor: null,
                reason: 'response_limit'
              }
            }
          : current
      )
      return
    }
    loadMoreInFlight.current = requestKey
    const request = ++pageRequest.current
    const previousEntries = page.entries
    setPageValue({ key: pageKey, state: { ...page, phase: 'loading', error: null } })
    try {
      const raw = await callRuntimeRpc<unknown>(
        stableTarget,
        'data.catalog.page',
        { rootId: selectedRoot.rootId, cursor, pageSize: DESKTOP_CATALOG_PAGE_SIZE },
        { timeoutMs: 15_000 }
      )
      if (request !== pageRequest.current) {
        return
      }
      setPageValue({
        key: pageKey,
        state: parseDesktopCatalogPage(raw, selectedRoot.rootId, previousEntries)
      })
    } catch (error) {
      if (request !== pageRequest.current) {
        return
      }
      setPageValue({ key: pageKey, state: unavailableDesktopCatalogPage(error, page) })
    } finally {
      if (loadMoreInFlight.current === requestKey) {
        loadMoreInFlight.current = null
      }
    }
  }, [page, pageKey, selectedRoot, stableTarget, targetKey])

  const refreshRoot = useCallback(() => {
    if (!selectedRoot || !stableTarget || !targetKey || !pageKey) {
      return
    }
    const request = ++pageRequest.current
    setPageValue({
      key: pageKey,
      state: { ...EMPTY_DESKTOP_CATALOG_PAGE, phase: 'loading' }
    })
    void callRuntimeRpc<unknown>(
      stableTarget,
      'data.catalog.page',
      { rootId: selectedRoot.rootId, pageSize: DESKTOP_CATALOG_PAGE_SIZE },
      { timeoutMs: 15_000 }
    )
      .then((raw) => {
        if (request !== pageRequest.current) {
          return
        }
        setPageValue({
          key: pageKey,
          state: parseDesktopCatalogPage(raw, selectedRoot.rootId)
        })
      })
      .catch((error: unknown) => {
        if (request !== pageRequest.current) {
          return
        }
        setPageValue({
          key: pageKey,
          state: {
            ...unavailableDesktopCatalogPage(error)
          }
        })
      })
  }, [pageKey, selectedRoot, stableTarget, targetKey])

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
