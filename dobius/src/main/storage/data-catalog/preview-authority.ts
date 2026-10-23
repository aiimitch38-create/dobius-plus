import {
  catalogPreviewPrincipalKey,
  isLivePreviewPrincipal,
  type CatalogPreviewAuthorityTicket,
  type CatalogPreviewPrincipal
} from './preview-principal'

/** Synchronous generation fence for authority owned by this main-process instance. */
export class CatalogPreviewAuthorityEpoch {
  private value = 0

  capture(principal: CatalogPreviewPrincipal): CatalogPreviewAuthorityTicket | null {
    if (!isLivePreviewPrincipal(principal)) {
      return null
    }
    return {
      epoch: this.value,
      principalKey: catalogPreviewPrincipalKey(principal),
      connectionId: principal.connectionId
    }
  }

  advance(): void {
    if (this.value >= Number.MAX_SAFE_INTEGER) {
      throw new Error('Preview authority epoch exhausted')
    }
    this.value += 1
  }

  isCurrent(ticket: CatalogPreviewAuthorityTicket, principal: CatalogPreviewPrincipal): boolean {
    return (
      !principal.signal.aborted &&
      this.value === ticket.epoch &&
      principal.connectionId === ticket.connectionId &&
      catalogPreviewPrincipalKey(principal) === ticket.principalKey &&
      isLivePreviewPrincipal(principal)
    )
  }
}
