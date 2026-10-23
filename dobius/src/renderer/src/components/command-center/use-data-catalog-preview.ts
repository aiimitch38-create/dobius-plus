import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DataCatalogPreviewClient,
  type DataCatalogPreviewScope,
  type DataCatalogPreviewViewState
} from '../../../../shared/data-catalog-preview-client'
import type { DataCatalogPreviewPolicyResult } from '../../../../shared/data-catalog-preview-schema'
import type { DataCatalogRootView } from '../../../../shared/data-catalog-roots'
import {
  bindPreviewInvalidationSource,
  type PreviewInvalidationSource
} from '../../../../shared/data-catalog-preview-invalidation'
import { callRuntimeRpc } from '../../runtime/runtime-rpc-client'

export function useDataCatalogPreview(
  target: { kind: 'local' } | { kind: 'environment'; environmentId: string } | null,
  selectedRoot: DataCatalogRootView | null,
  invalidationSource: PreviewInvalidationSource | null = null
) {
  const foregroundRef = useRef(false)
  const previewClient = useMemo(
    () =>
      new DataCatalogPreviewClient({
        rpc: (method, params) => {
          if (!target || target.kind !== 'local') {
            throw new Error('Preview is available only in this computer’s trusted window.')
          }
          return callRuntimeRpc<unknown>(target, method, params, { timeoutMs: 10_000 })
        },
        isForeground: () => foregroundRef.current
      }),
    [target]
  )
  const targetKey = target
    ? target.kind === 'local'
      ? 'local'
      : `environment:${target.environmentId}`
    : null
  const [previewValue, setPreviewValue] = useState<{
    client: DataCatalogPreviewClient
    targetKey: string | null
    scope: DataCatalogPreviewScope
    state: DataCatalogPreviewViewState
  }>(() => ({
    client: previewClient,
    targetKey,
    scope: null,
    state: { phase: 'idle' }
  }))
  const selectedScope = selectedRoot
    ? { rootId: selectedRoot.rootId, generation: selectedRoot.generation }
    : null
  const preview =
    previewValue.client === previewClient &&
    previewValue.targetKey === targetKey &&
    previewValue.scope?.rootId === selectedScope?.rootId &&
    previewValue.scope?.generation === selectedScope?.generation
      ? previewValue.state
      : { phase: 'idle' as const }
  const [previewPolicy, setPreviewPolicy] = useState<DataCatalogPreviewPolicyResult | null>(null)

  useEffect(() => {
    let unsubscribeInvalidation: (() => void) | null = null
    const stopInvalidation = (): void => {
      unsubscribeInvalidation?.()
      unsubscribeInvalidation = null
    }
    const clearForeground = (): void => {
      foregroundRef.current = false
      previewClient.setForeground(false)
      stopInvalidation()
    }
    const updateForeground = (): void => {
      const active = document.visibilityState === 'visible' && document.hasFocus()
      foregroundRef.current = active
      previewClient.setForeground(active)
      if (active && invalidationSource && !unsubscribeInvalidation) {
        unsubscribeInvalidation = bindPreviewInvalidationSource(invalidationSource, (event) =>
          previewClient.handleInvalidation(event)
        )
      } else if (!active) {
        stopInvalidation()
      }
    }
    updateForeground()
    document.addEventListener('visibilitychange', updateForeground)
    window.addEventListener('blur', clearForeground)
    window.addEventListener('focus', updateForeground)
    return () => {
      document.removeEventListener('visibilitychange', updateForeground)
      window.removeEventListener('blur', clearForeground)
      window.removeEventListener('focus', updateForeground)
      foregroundRef.current = false
      previewClient.setForeground(false)
      stopInvalidation()
    }
  }, [invalidationSource, previewClient])

  useEffect(
    () =>
      previewClient.subscribe((state, scope) => {
        setPreviewValue({ client: previewClient, targetKey, scope, state })
      }),
    [previewClient, targetKey]
  )

  useEffect(() => {
    let current = true
    setPreviewPolicy(null)
    void previewClient.clear()
    if (target?.kind === 'local' && selectedRoot) {
      void previewClient
        .policy({ rootId: selectedRoot.rootId, generation: selectedRoot.generation })
        .then((result) => {
          if (current) {
            setPreviewPolicy(result)
          }
        })
    } else if (target?.kind === 'environment' && selectedRoot) {
      setPreviewPolicy({ state: 'denied' })
    }
    return () => {
      current = false
      void previewClient.clear()
    }
  }, [previewClient, selectedRoot, target])

  const previewEntry = useCallback(
    (entryId: string) => {
      if (target?.kind !== 'local' || !selectedRoot) {
        return
      }
      void previewClient.preview({
        rootId: selectedRoot.rootId,
        generation: selectedRoot.generation,
        entryId
      })
    },
    [previewClient, selectedRoot, target?.kind]
  )

  const clearPreview = useCallback(() => previewClient.clear(), [previewClient])

  return { preview, previewPolicy, previewEntry, clearPreview }
}
