import { CatalogPreviewServiceAuthority } from './catalog-preview-service-authority'
import type { DataCatalogPreviewInvalidatedEvent } from '../../../shared/data-catalog-preview-schema'
import {
  failure,
  MAX_INFLIGHT_GLOBAL,
  PreviewOperationError,
  type PreviewFailure,
  type PreviewSession
} from './catalog-preview-service-state'

export class CatalogPreviewServiceMaintenance extends CatalogPreviewServiceAuthority {
  protected reserveSessionOperation(session: PreviewSession): boolean {
    if (session.busy || this.inflight >= MAX_INFLIGHT_GLOBAL) {
      return false
    }
    session.busy = true
    this.inflight += 1
    return true
  }

  protected finishSessionOperation(session: PreviewSession): void {
    this.releaseOperation()
    if (this.sessions.get(session.id) === session) {
      session.busy = false
    }
  }

  protected removeFailure(
    session: PreviewSession,
    state: PreviewFailure
  ): ReturnType<typeof failure> {
    if (this.sessions.get(session.id) === session) {
      this.sessions.delete(session.id)
    }
    return failure(state)
  }

  protected invalidateSession(
    session: PreviewSession,
    state: PreviewFailure
  ): ReturnType<typeof failure> {
    if (this.sessions.get(session.id) === session) {
      this.sessions.delete(session.id)
    }
    this.emitForConnection(session.connectionId, {
      rootId: session.root.id,
      generation: session.root.generation,
      reason: state === 'expired' ? 'expired' : 'revoked'
    })
    return failure(state)
  }

  protected failureFor(error: unknown): PreviewFailure {
    if (error instanceof PreviewOperationError) {
      return error.state
    }
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'unsupported'
    ) {
      return 'unsupported'
    }
    return 'unavailable'
  }

  protected expire(): void {
    const now = this.now()
    const wall = this.wallNow()
    for (const [key, record] of this.witnesses) {
      if (record.expiresAt <= now || record.expiresAtWall <= wall) {
        this.witnesses.delete(key)
      }
    }
    for (const [key, record] of this.references) {
      if (record.expiresAt <= now || record.expiresAtWall <= wall) {
        this.references.delete(key)
      }
    }
    for (const [key, session] of this.sessions) {
      if (
        !this.sessionNotExpired(session) ||
        (session.visibleUntil !== null && !this.leaseCurrent(session))
      ) {
        this.sessions.delete(key)
        this.emitForConnection(session.connectionId, {
          rootId: session.root.id,
          generation: session.root.generation,
          reason: 'expired'
        })
      }
    }
  }

  protected invalidateRoot(rootId: string, reason: 'revoked' | 'root_changed'): void {
    const affected = new Map<string, string>()
    for (const [key, record] of this.witnesses) {
      if (record.root.id === rootId) {
        affected.set(record.connectionId, record.root.generation)
        this.witnesses.delete(key)
      }
    }
    for (const [key, record] of this.references) {
      if (record.root.id === rootId) {
        affected.set(record.connectionId, record.root.generation)
        this.references.delete(key)
      }
    }
    for (const [key, session] of this.sessions) {
      if (session.root.id === rootId) {
        affected.set(session.connectionId, session.root.generation)
        this.sessions.delete(key)
      }
    }
    for (const [connectionId, generation] of affected) {
      this.emitForConnection(connectionId, { rootId, generation, reason })
    }
  }

  protected emitForConnection(
    connectionId: string,
    event: DataCatalogPreviewInvalidatedEvent
  ): void {
    try {
      this.options.emitInvalidated?.(connectionId, event)
    } catch {
      /* delivery is advisory; lease rechecks remain authoritative */
    }
  }

  protected connectionWitnessCount(connectionId: string): number {
    let count = 0
    for (const record of this.witnesses.values()) {
      if (record.connectionId === connectionId) {
        count += 1
      }
    }
    return count
  }

  protected referenceCount(principalKey: string): number {
    let count = 0
    for (const record of this.references.values()) {
      if (record.principalKey === principalKey) {
        count += 1
      }
    }
    return count
  }

  protected principalSessionCount(principalKey: string): number {
    let count = 0
    for (const session of this.sessions.values()) {
      if (session.principalKey === principalKey) {
        count += 1
      }
    }
    return count
  }
}
