import { z } from 'zod'
import {
  DATA_CATALOG_DESKTOP_PRINCIPAL,
  DataCatalogDeviceIds,
  DataCatalogRootId,
  DataCatalogRootKind
} from '../../../../shared/data-catalog-roots'
import {
  DataCatalogPreviewChunkRequestSchema,
  DataCatalogPreviewCloseRequestSchema,
  DataCatalogPreviewFinishRequestSchema,
  DataCatalogPreviewPolicyRequestSchema,
  DataCatalogPreviewRenewRequestSchema,
  DataCatalogPreviewResolveRequestSchema,
  DataCatalogPreviewStartRequestSchema,
  DataCatalogSetPreviewAccessRequestSchema
} from '../../../../shared/data-catalog-preview-schema'
import type { CatalogPreviewPrincipal } from '../../../storage/data-catalog/preview-principal'
import { defineMethod, type RpcContext, type RpcMethod } from '../core'

function principal(context: RpcContext): string | null {
  if (context.authenticatedLocal === true) {
    return DATA_CATALOG_DESKTOP_PRINCIPAL
  }
  return context.clientDeviceId ? `device:${context.clientDeviceId}` : null
}

function configured(context: RpcContext) {
  if (!context.dataCatalog) {
    throw new Error('Data catalog is unavailable on this host')
  }
  return context.dataCatalog
}

function previewPrincipal(context: RpcContext): CatalogPreviewPrincipal | null {
  return context.catalogPreviewPrincipal ?? null
}

export const DATA_CATALOG_METHODS: readonly RpcMethod[] = [
  defineMethod({
    name: 'data.catalog.roots',
    params: null,
    handler: (_params, context) =>
      context.dataCatalog?.list(principal(context)) ?? { state: 'unavailable', roots: [] }
  }),
  defineMethod({
    name: 'data.catalog.page',
    params: z
      .object({
        rootId: DataCatalogRootId,
        cursor: z.string().min(32).max(128).nullable().optional(),
        pageSize: z.number().int().min(1).max(200).optional()
      })
      .strict(),
    handler: (params, context) =>
      configured(context).page(principal(context), { ...params, signal: context.signal })
  }),
  defineMethod({
    name: 'data.catalog.preview.policy',
    params: DataCatalogPreviewPolicyRequestSchema,
    handler: (params, context) => {
      const trusted = previewPrincipal(context)
      if (!trusted) {
        return { state: 'denied' }
      }
      return context.dataCatalog?.previewPolicy(trusted, params) ?? { state: 'unavailable' }
    }
  }),
  defineMethod({
    name: 'data.catalog.setPreviewAccess',
    params: DataCatalogSetPreviewAccessRequestSchema,
    handler: (params, context) => {
      if (previewPrincipal(context)?.kind !== 'local-webcontents') {
        return { state: 'denied' }
      }
      return (
        context.dataCatalog?.setPreviewAccess(DATA_CATALOG_DESKTOP_PRINCIPAL, params) ?? {
          state: 'unavailable'
        }
      )
    }
  }),
  defineMethod({
    name: 'data.catalog.preview.resolve',
    params: DataCatalogPreviewResolveRequestSchema,
    handler: (params, context) => {
      const trusted = previewPrincipal(context)
      if (!trusted) {
        return { state: 'denied' }
      }
      return context.dataCatalog?.previewResolve(trusted, params) ?? { state: 'unavailable' }
    }
  }),
  defineMethod({
    name: 'data.catalog.preview.start',
    params: DataCatalogPreviewStartRequestSchema,
    handler: (params, context) => {
      const trusted = previewPrincipal(context)
      if (!trusted) {
        return { state: 'denied' }
      }
      return context.dataCatalog?.previewStart(trusted, params) ?? { state: 'unavailable' }
    }
  }),
  defineMethod({
    name: 'data.catalog.preview.chunk',
    params: DataCatalogPreviewChunkRequestSchema,
    handler: (params, context) => {
      const trusted = previewPrincipal(context)
      if (!trusted) {
        return { state: 'denied' }
      }
      return context.dataCatalog?.previewChunk(trusted, params) ?? { state: 'unavailable' }
    }
  }),
  defineMethod({
    name: 'data.catalog.preview.finish',
    params: DataCatalogPreviewFinishRequestSchema,
    handler: (params, context) => {
      const trusted = previewPrincipal(context)
      if (!trusted) {
        return { state: 'denied' }
      }
      return context.dataCatalog?.previewFinish(trusted, params) ?? { state: 'unavailable' }
    }
  }),
  defineMethod({
    name: 'data.catalog.preview.renew',
    params: DataCatalogPreviewRenewRequestSchema,
    handler: (params, context) => {
      const trusted = previewPrincipal(context)
      if (!trusted) {
        return { state: 'denied' }
      }
      return context.dataCatalog?.previewRenew(trusted, params) ?? { state: 'unavailable' }
    }
  }),
  defineMethod({
    name: 'data.catalog.preview.close',
    params: DataCatalogPreviewCloseRequestSchema,
    handler: (params, context) => {
      const trusted = previewPrincipal(context)
      if (!trusted) {
        return { state: 'denied' }
      }
      return context.dataCatalog?.previewClose(trusted, params) ?? { state: 'denied' }
    }
  }),
  defineMethod({
    name: 'data.catalog.chooseRoot',
    params: z.object({ kind: DataCatalogRootKind }).strict(),
    handler: (params, context) => configured(context).chooseRoot(principal(context), params.kind)
  }),
  defineMethod({
    name: 'data.catalog.devices',
    params: null,
    handler: (_params, context) => configured(context).devices(principal(context))
  }),
  defineMethod({
    name: 'data.catalog.setAccess',
    params: z.object({ rootId: DataCatalogRootId, deviceIds: DataCatalogDeviceIds }).strict(),
    handler: (params, context) =>
      configured(context).setAccess(principal(context), params.rootId, params.deviceIds)
  }),
  defineMethod({
    name: 'data.catalog.removeRoot',
    params: z.object({ rootId: DataCatalogRootId }).strict(),
    handler: (params, context) => configured(context).removeRoot(principal(context), params.rootId)
  })
]
