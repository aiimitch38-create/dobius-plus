import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { useFocusEffect } from 'expo-router'
import type { RpcClient } from '../transport/rpc-client'
import {
  DataCatalogPreviewClient,
  type DataCatalogPreviewScope,
  type DataCatalogPreviewViewState
} from '../../../src/shared/data-catalog-preview-client'
import type { DataCatalogPreviewPolicyResult } from '../../../src/shared/data-catalog-preview-schema'
import type { DataCatalogRootView } from '../../../src/shared/data-catalog-roots'
import {
  bindPreviewInvalidationSource,
  type PreviewInvalidationSource
} from '../../../src/shared/data-catalog-preview-invalidation'

export function useMobileDataCatalogPreview(
  hostId: string,
  client: Pick<RpcClient, 'sendRequest'> | null,
  connected: boolean,
  selectedRoot: DataCatalogRootView | null,
  invalidationSource: PreviewInvalidationSource | null = null
) {
  const screenFocused = useRef(false)
  const foregroundRef = useRef(AppState.currentState === 'active')
  const previewClient = useMemo(
    () =>
      new DataCatalogPreviewClient({
        rpc: async (method, params) => {
          if (!client || !connected) {
            throw new Error('The selected host is disconnected.')
          }
          const response = await client.sendRequest(method, params, { timeoutMs: 10_000 })
          if (!response.ok) {
            throw new Error('The selected host refused the preview request.')
          }
          return response.result
        },
        isForeground: () => foregroundRef.current && AppState.currentState === 'active'
      }),
    [client, connected, hostId]
  )
  const targetKey = `host:${hostId}`
  const [previewValue, setPreviewValue] = useState<{
    client: DataCatalogPreviewClient
    targetKey: string
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

  useEffect(
    () =>
      previewClient.subscribe((state, scope) => {
        setPreviewValue({ client: previewClient, targetKey, scope, state })
      }),
    [previewClient, targetKey]
  )

  useFocusEffect(
    useCallback(() => {
      screenFocused.current = true
      let unsubscribeInvalidation: (() => void) | null = null
      const stopInvalidation = (): void => {
        unsubscribeInvalidation?.()
        unsubscribeInvalidation = null
      }
      const updateForeground = (state: string | null = AppState.currentState): void => {
        const active = state === 'active' && screenFocused.current
        foregroundRef.current = active
        previewClient.setForeground(active)
        if (active && connected && client && invalidationSource && !unsubscribeInvalidation) {
          unsubscribeInvalidation = bindPreviewInvalidationSource(invalidationSource, (event) =>
            previewClient.handleInvalidation(event)
          )
        } else if (!active || !connected || !client) {
          stopInvalidation()
        }
      }
      updateForeground()
      const subscription = AppState.addEventListener('change', (state) => updateForeground(state))
      return () => {
        screenFocused.current = false
        foregroundRef.current = false
        previewClient.setForeground(false)
        stopInvalidation()
        subscription.remove()
      }
    }, [client, connected, invalidationSource, previewClient])
  )

  useEffect(() => {
    let current = true
    setPreviewPolicy(null)
    void previewClient.clear()
    if (selectedRoot && client && connected) {
      void previewClient
        .policy({ rootId: selectedRoot.rootId, generation: selectedRoot.generation })
        .then((result) => {
          if (current) {
            setPreviewPolicy(result)
          }
        })
    }
    return () => {
      current = false
      void previewClient.clear()
    }
  }, [client, connected, hostId, previewClient, selectedRoot])

  const previewEntry = useCallback(
    (entryId: string) => {
      if (!selectedRoot || !client || !connected) {
        return
      }
      void previewClient.preview({
        rootId: selectedRoot.rootId,
        generation: selectedRoot.generation,
        entryId
      })
    },
    [client, connected, previewClient, selectedRoot]
  )
  const clearPreview = useCallback(() => previewClient.clear(), [previewClient])

  return { preview, previewPolicy, previewEntry, clearPreview }
}
