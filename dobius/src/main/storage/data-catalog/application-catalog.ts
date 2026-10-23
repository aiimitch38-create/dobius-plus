import {
  DATA_CATALOG_DESKTOP_PRINCIPAL,
  type DataCatalogRootsResult
} from '../../../shared/data-catalog-roots'
import { ReadOnlyDataCatalogService } from './catalog-service'
import type { MetadataFileSystem } from './metadata-scanner'
import { DataCatalogRootEnrollmentStore } from './root-enrollment-store'
import type { CatalogRequest, CatalogResult, RegisteredCatalogRoot } from './types'
import { CatalogPreviewAuthorityEpoch } from './preview-authority'
import type { CatalogPreviewPrincipal } from './preview-principal'
import { CatalogPreviewSessionService } from './catalog-preview-service'

export type CatalogPairedDevice = { deviceId: string; name: string; scope?: 'mobile' | 'runtime' }

/** Main-only facade; native selection and current device registry supply all browse authority. */
export class ApplicationDataCatalog {
  readonly roots: DataCatalogRootEnrollmentStore
  private readonly catalog: ReadOnlyDataCatalogService
  private choosingRoot = false
  private closed = false
  private closing: Promise<void> | null = null
  private readonly chooserAbort = new AbortController()
  private readonly previewAuthority = new CatalogPreviewAuthorityEpoch()
  private readonly preview: CatalogPreviewSessionService

  constructor(
    private readonly options: {
      registryPath: string
      pairedDevices: () => readonly CatalogPairedDevice[]
      /** Separate server-owned mobile scope roster; omission fails closed for phone preview. */
      pairedMobileDevices?: () => readonly CatalogPairedDevice[]
      chooseDirectory: () => Promise<string | null>
      fileSystem?: MetadataFileSystem
      disposeFileSystem?: () => Promise<void>
      onPreviewInvalidated?: (connectionId: string, event: unknown) => void
    }
  ) {
    this.roots = new DataCatalogRootEnrollmentStore(
      options.registryPath,
      () => options.pairedDevices().map((device) => device.deviceId),
      options.fileSystem?.captureRootIdentity
        ? (path) => options.fileSystem!.captureRootIdentity!(path)
        : undefined,
      () => this.previewAuthority.advance(),
      () =>
        (options.pairedMobileDevices?.() ?? [])
          .filter((device) => device.scope === 'mobile')
          .map((device) => device.deviceId)
    )
    this.catalog = new ReadOnlyDataCatalogService(this.roots, { fileSystem: options.fileSystem })
    this.preview = new CatalogPreviewSessionService({
      roots: this.roots,
      fileSystem: options.fileSystem,
      authority: this.previewAuthority,
      pairedDevices: () =>
        (options.pairedMobileDevices?.() ?? [])
          .filter((device) => device.scope === 'mobile')
          .map((device) => ({ ...device, scope: 'mobile' as const })),
      emitInvalidated: options.onPreviewInvalidated
    })
  }

  list(principal: string | null): DataCatalogRootsResult {
    if (this.closed) {
      return { state: 'unavailable', roots: [] }
    }
    if (!principal) {
      return { state: 'denied', roots: [] }
    }
    try {
      return { state: 'ready', roots: this.roots.list(principal) }
    } catch {
      return { state: 'unavailable', roots: [] }
    }
  }

  page(
    principal: string | null,
    request: CatalogRequest,
    previewPrincipal?: CatalogPreviewPrincipal
  ): Promise<CatalogResult> {
    if (!principal) {
      return Promise.resolve({
        state: 'denied',
        rootId: null,
        entries: [],
        cursor: null,
        scannedEntries: 0,
        reason: 'access_denied'
      })
    }
    const trusted = previewPrincipal?.principalId === principal ? previewPrincipal : undefined
    return this.catalog.page(principal, request, trusted, (result, witnesses) => {
      if (trusted) {
        this.preview.registerEmittedPage(trusted, result, witnesses)
      }
    })
  }

  previewPolicy(principal: CatalogPreviewPrincipal, request: unknown) {
    return this.preview.policy(principal, request)
  }

  setPreviewAccess(principal: string | null, request: unknown) {
    this.requireDesktop(principal)
    return this.preview.setAccess(request)
  }

  previewResolve(principal: CatalogPreviewPrincipal, request: unknown) {
    return this.preview.resolve(principal, request)
  }

  previewStart(principal: CatalogPreviewPrincipal, request: unknown) {
    return this.preview.start(principal, request)
  }

  previewChunk(principal: CatalogPreviewPrincipal, request: unknown) {
    return this.preview.chunk(principal, request)
  }

  previewFinish(principal: CatalogPreviewPrincipal, request: unknown) {
    return this.preview.finish(principal, request)
  }

  previewRenew(principal: CatalogPreviewPrincipal, request: unknown) {
    return this.preview.renew(principal, request)
  }

  previewClose(principal: CatalogPreviewPrincipal, request: unknown) {
    return this.preview.closeSession(principal, request)
  }

  invalidatePreviewConnection(connectionId: string): void {
    this.preview.invalidateConnection(connectionId)
  }

  invalidatePreviewAuthority(): void {
    this.previewAuthority.advance()
    this.preview.invalidateAuthority()
  }

  async chooseRoot(principal: string | null, kind: RegisteredCatalogRoot['kind']) {
    this.requireDesktop(principal)
    if (this.choosingRoot) {
      throw new Error('A folder chooser is already open')
    }
    this.choosingRoot = true
    try {
      const picked = await this.options.chooseDirectory()
      this.requireDesktop(principal)
      const enrolled =
        picked === null
          ? null
          : await this.roots.enrollPickedDirectory(picked, kind, this.chooserAbort.signal)
      if (enrolled) {
        this.preview.invalidateAuthority()
      }
      return enrolled
    } finally {
      this.choosingRoot = false
    }
  }

  devices(principal: string | null): { devices: CatalogPairedDevice[] } {
    this.requireDesktop(principal)
    return {
      devices: this.options.pairedDevices().map(({ deviceId, name }) => ({ deviceId, name }))
    }
  }

  setAccess(principal: string | null, rootId: string, deviceIds: string[]) {
    this.requireDesktop(principal)
    const result = this.roots.setDeviceAccess(rootId, deviceIds)
    this.preview.invalidateRootAccess(rootId)
    return result
  }

  removeRoot(principal: string | null, rootId: string): { removed: true } {
    this.requireDesktop(principal)
    this.roots.revoke(rootId)
    this.preview.invalidateAuthority()
    return { removed: true }
  }

  close(): Promise<void> {
    this.closed = true
    this.chooserAbort.abort()
    this.closing ??= Promise.all([this.catalog.close(), this.preview.close()])
      .then(() => undefined)
      .finally(() => this.options.disposeFileSystem?.())
    return this.closing
  }

  private requireDesktop(principal: string | null): void {
    if (this.closed) {
      throw new Error('Folder catalog is closed')
    }
    if (principal !== DATA_CATALOG_DESKTOP_PRINCIPAL) {
      throw new Error('Folder registration requires this computer')
    }
  }
}
