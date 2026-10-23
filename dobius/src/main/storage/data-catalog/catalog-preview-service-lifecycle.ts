import {
  DataCatalogPreviewCloseRequestSchema,
  DataCatalogPreviewCloseResultSchema
} from '../../../shared/data-catalog-preview-schema'
import {
  isLivePreviewPrincipal,
  catalogPreviewPrincipalKey,
  type CatalogPreviewPrincipal
} from './preview-principal'
import { CatalogPreviewTransferOperations } from './catalog-preview-transfer'

/** Connection and shutdown lifetime operations for preview state. */
export class CatalogPreviewLifecycleOperations extends CatalogPreviewTransferOperations {
  closeSession(principal: CatalogPreviewPrincipal, input: unknown) {
    const request = DataCatalogPreviewCloseRequestSchema.safeParse(input)
    if (!request.success || !isLivePreviewPrincipal(principal)) {
      return DataCatalogPreviewCloseResultSchema.parse({ state: 'denied' })
    }
    const session = this.sessions.get(request.data.previewSessionId)
    if (session && session.principalKey !== catalogPreviewPrincipalKey(principal)) {
      return DataCatalogPreviewCloseResultSchema.parse({ state: 'denied' })
    }
    if (session) {
      this.sessions.delete(session.id)
    }
    return DataCatalogPreviewCloseResultSchema.parse({ state: 'closed' })
  }

  invalidateConnection(connectionId: string): void {
    for (const [key, record] of this.witnesses) {
      if (record.connectionId === connectionId) {
        this.witnesses.delete(key)
      }
    }
    for (const [key, record] of this.references) {
      if (record.connectionId === connectionId) {
        this.references.delete(key)
      }
    }
    for (const [id, session] of this.sessions) {
      if (session.connectionId === connectionId) {
        this.sessions.delete(id)
      }
    }
  }

  invalidateRootAccess(rootId: string): void {
    this.invalidateRoot(rootId, 'revoked')
  }

  invalidateAuthority(): void {
    const affected = new Map<string, { connectionId: string; rootId: string; generation: string }>()
    const remember = (connectionId: string, rootId: string, generation: string) => {
      affected.set(`${connectionId}\0${rootId}\0${generation}`, {
        connectionId,
        rootId,
        generation
      })
    }
    for (const record of [...this.witnesses.values(), ...this.references.values()]) {
      remember(record.connectionId, record.root.id, record.root.generation)
    }
    for (const session of this.sessions.values()) {
      remember(session.connectionId, session.root.id, session.root.generation)
    }
    this.witnesses.clear()
    this.references.clear()
    this.sessions.clear()
    for (const target of affected.values()) {
      this.emitForConnection(target.connectionId, {
        rootId: target.rootId,
        generation: target.generation,
        reason: 'revoked'
      })
    }
  }

  async close(): Promise<void> {
    this.closed = true
    this.invalidateAuthority()
    if (this.inflight > 0) {
      await new Promise<void>((resolve) => this.drainWaiters.push(resolve))
    }
  }
}
