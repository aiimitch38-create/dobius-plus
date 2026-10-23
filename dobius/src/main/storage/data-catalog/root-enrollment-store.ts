import { randomUUID } from 'node:crypto'
import { lstat, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import {
  DATA_CATALOG_DESKTOP_PRINCIPAL,
  DataCatalogDeviceIds,
  type DataCatalogRootView
} from '../../../shared/data-catalog-roots'
import { SafeJsonFile } from '../safe-json-file'
import { withRootEnrollmentWrite } from './root-enrollment-lock'
import { runBounded } from './registered-roots'
import {
  RegisteredCatalogRootSchema,
  type CatalogRootIdentity,
  type RegisteredCatalogRoot,
  type RegisteredCatalogRootProvider
} from './types'

const Enrollment = RegisteredCatalogRootSchema.extend({
  // Legacy registrations remain manageable locally, but cannot authorize a native scan or phone.
  identity: RegisteredCatalogRootSchema.shape.identity.partial({
    birthtimeNs: true,
    incarnation: true
  }),
  generation: z.string().uuid(),
  allowedDeviceIds: DataCatalogDeviceIds,
  desktopPreviewEnabled: z.boolean().default(false),
  allowedPreviewDeviceIds: DataCatalogDeviceIds.refine(
    (ids) => new Set(ids).size === ids.length,
    'Preview device IDs must be unique'
  ).default([])
}).strict()
const EnrollmentState = z
  .object({ version: z.literal(1), roots: z.array(Enrollment).max(100) })
  .strict()
  .refine(
    ({ roots }) =>
      new Set(roots.map((root) => root.id)).size === roots.length &&
      new Set(roots.map((root) => root.canonicalPath)).size === roots.length,
    'Folder registrations must have unique identities and locations'
  )
type EnrollmentState = z.infer<typeof EnrollmentState>

/** Stores browse grants only; human files and job/task records remain authoritative elsewhere. */
export class DataCatalogRootEnrollmentStore implements RegisteredCatalogRootProvider {
  private readonly file: SafeJsonFile<EnrollmentState>

  constructor(
    private readonly filePath: string,
    private readonly pairedDeviceIds: () => readonly string[],
    private readonly captureRootIdentity?: (path: string) => Promise<CatalogRootIdentity>,
    private readonly onAuthorityChanged: () => void = () => undefined,
    private readonly pairedMobileDeviceIds: () => readonly string[] = () => []
  ) {
    this.file = new SafeJsonFile({
      filePath: () => filePath,
      parse: (raw) => {
        const parsed = EnrollmentState.safeParse(raw)
        return parsed.success ? parsed.data : undefined
      },
      fallback: () => ({ version: 1, roots: [] }),
      label: '[data-catalog] browse registration',
      mode: 0o600
    })
  }

  list(principalId: string): DataCatalogRootView[] {
    return this.read()
      .roots.filter((root) => this.allowed(root, principalId))
      .map((root) => ({
        rootId: root.id,
        kind: root.kind,
        label: root.label,
        generation: root.generation,
        ...(principalId === DATA_CATALOG_DESKTOP_PRINCIPAL
          ? { allowedDeviceIds: root.identity.incarnation ? [...root.allowedDeviceIds] : [] }
          : {})
      }))
  }

  async resolveAuthorizedRoot(
    principalId: string,
    rootId: string,
    signal?: AbortSignal
  ): Promise<RegisteredCatalogRoot | null> {
    if (signal?.aborted) {
      return null
    }
    const root = this.read().roots.find((value) => value.id === rootId)
    if (!root || !root.identity.incarnation || !this.allowed(root, principalId)) {
      return null
    }
    const {
      allowedDeviceIds: _devices,
      desktopPreviewEnabled: _desktopPreview,
      allowedPreviewDeviceIds: _previewDevices,
      ...registration
    } = root
    void _devices
    void _desktopPreview
    void _previewDevices
    return RegisteredCatalogRootSchema.parse(registration)
  }

  /** Called with a native picker result by main; no RPC accepts this filesystem path. */
  async enrollPickedDirectory(
    pickedPath: string,
    kind: RegisteredCatalogRoot['kind'],
    signal?: AbortSignal
  ): Promise<DataCatalogRootView> {
    if (!this.captureRootIdentity) {
      throw new Error('This filesystem cannot prove folder identity; no access was granted')
    }
    if (!isAbsolute(pickedPath)) {
      throw new Error('Choose an existing folder')
    }
    const selected = resolve(pickedPath)
    const link = await lstat(selected, { bigint: true })
    if (!link.isDirectory() || link.isSymbolicLink()) {
      throw new Error('Choose a real folder')
    }
    const canonicalPath = await realpath(selected)
    // Descriptor helpers retain full-width integers; Number would round large inode values.
    const identity = await stat(canonicalPath, { bigint: true })
    const capture = this.captureRootIdentity
    const nativeIdentity = RegisteredCatalogRootSchema.shape.identity.parse(
      await runBounded(() => capture(canonicalPath), 1000, signal)
    )
    const rechecked = await lstat(selected, { bigint: true })
    const nativeRecheck = RegisteredCatalogRootSchema.shape.identity.parse(
      await runBounded(() => capture(canonicalPath), 1000, signal)
    )
    if (
      !identity.isDirectory() ||
      rechecked.isSymbolicLink() ||
      identity.dev !== rechecked.dev ||
      identity.ino !== rechecked.ino ||
      nativeIdentity.dev !== String(identity.dev) ||
      nativeIdentity.ino !== String(identity.ino) ||
      !sameNativeRootIdentity(nativeIdentity, nativeRecheck) ||
      (await realpath(selected)) !== canonicalPath
    ) {
      throw new Error('The selected folder changed; choose it again')
    }

    // Read after awaiting the picker path so concurrent changes are never overwritten.
    return withRootEnrollmentWrite(this.filePath, () => {
      if (signal?.aborted) {
        throw new Error('Folder selection was cancelled; no access was granted')
      }
      const state = this.read()
      const existing = state.roots.find((root) => root.canonicalPath === canonicalPath)
      if (!existing && state.roots.length >= 100) {
        throw new Error('Folder registration limit reached')
      }
      const root = Enrollment.parse({
        id: existing?.id ?? `catalog:${randomUUID()}`,
        kind,
        label: (basename(canonicalPath) || 'Selected folder').slice(0, 128),
        canonicalPath,
        identity: nativeIdentity,
        generation: randomUUID(),
        browseGranted: true,
        // Selecting a replaced folder does not inherit old phone grants.
        allowedDeviceIds:
          existing && sameNativeRootIdentity(existing.identity, nativeIdentity)
            ? existing.allowedDeviceIds
            : [],
        desktopPreviewEnabled:
          existing && sameNativeRootIdentity(existing.identity, nativeIdentity)
            ? existing.desktopPreviewEnabled
            : false,
        allowedPreviewDeviceIds:
          existing && sameNativeRootIdentity(existing.identity, nativeIdentity)
            ? existing.allowedPreviewDeviceIds
            : []
      })
      this.file.save({ version: 1, roots: [...state.roots.filter((r) => r.id !== root.id), root] })
      this.onAuthorityChanged()
      return this.list(DATA_CATALOG_DESKTOP_PRINCIPAL).find((r) => r.rootId === root.id)!
    })
  }

  setDeviceAccess(rootId: string, deviceIds: readonly string[]): DataCatalogRootView {
    return withRootEnrollmentWrite(this.filePath, () => {
      const parsed = DataCatalogDeviceIds.parse(deviceIds)
      const paired = new Set(this.pairedDeviceIds())
      if (parsed.some((id) => !paired.has(id))) {
        throw new Error('Device is no longer paired')
      }
      const state = this.read()
      const root = state.roots.find((value) => value.id === rootId)
      if (!root) {
        throw new Error('Folder is no longer registered')
      }
      if (!root.identity.incarnation) {
        throw new Error('Choose this folder again before sharing access')
      }
      const next = { ...root, allowedDeviceIds: [...new Set(parsed)], generation: randomUUID() }
      this.file.save({ version: 1, roots: state.roots.map((r) => (r.id === rootId ? next : r)) })
      this.onAuthorityChanged()
      return this.list(DATA_CATALOG_DESKTOP_PRINCIPAL).find((r) => r.rootId === rootId)!
    })
  }

  setPreviewAccess(
    rootId: string,
    desktopPreviewEnabled: boolean,
    deviceIds: readonly string[]
  ): DataCatalogRootView {
    return withRootEnrollmentWrite(this.filePath, () => {
      const parsed = Enrollment.shape.allowedPreviewDeviceIds.parse(deviceIds)
      const paired = new Set(this.pairedMobileDeviceIds())
      if (parsed.some((id) => !paired.has(id))) {
        throw new Error('Device is no longer paired for mobile preview')
      }
      const state = this.read()
      const root = state.roots.find((value) => value.id === rootId)
      if (!root) {
        throw new Error('Folder is no longer registered')
      }
      if (!root.identity.incarnation) {
        throw new Error('Choose this folder again before enabling preview')
      }
      const next = {
        ...root,
        desktopPreviewEnabled,
        allowedPreviewDeviceIds: [...new Set(parsed)],
        generation: randomUUID()
      }
      this.file.save({ version: 1, roots: state.roots.map((r) => (r.id === rootId ? next : r)) })
      this.onAuthorityChanged()
      return this.list(DATA_CATALOG_DESKTOP_PRINCIPAL).find((r) => r.rootId === rootId)!
    })
  }

  /** Main-only authority snapshot; never serialize or return its canonical path to a client. */
  previewRegistration(rootId: string): {
    root: RegisteredCatalogRoot
    allowedDeviceIds: string[]
    desktopPreviewEnabled: boolean
    allowedPreviewDeviceIds: string[]
  } | null {
    const value = this.read().roots.find((root) => root.id === rootId)
    if (!value || !value.identity.incarnation) {
      return null
    }
    const { allowedDeviceIds, desktopPreviewEnabled, allowedPreviewDeviceIds, ...registration } =
      value
    return {
      root: RegisteredCatalogRootSchema.parse(registration),
      allowedDeviceIds: [...allowedDeviceIds],
      desktopPreviewEnabled,
      allowedPreviewDeviceIds: [...allowedPreviewDeviceIds]
    }
  }

  revoke(rootId: string): void {
    withRootEnrollmentWrite(this.filePath, () => {
      const state = this.read()
      this.file.save({ version: 1, roots: state.roots.filter((r) => r.id !== rootId) })
      this.onAuthorityChanged()
    })
  }

  private read(): EnrollmentState {
    // Grants may change through another authenticated app/server process.
    this.file.invalidate()
    const state = this.file.get()
    if (this.file.getStatus().status === 'unreadable') {
      throw new Error('Folder registrations are unavailable; original files are unchanged')
    }
    return state
  }

  private allowed(root: z.infer<typeof Enrollment>, principalId: string): boolean {
    if (principalId === DATA_CATALOG_DESKTOP_PRINCIPAL) {
      return true
    }
    const deviceId = principalId.startsWith('device:') ? principalId.slice(7) : null
    return (
      deviceId !== null &&
      root.identity.incarnation !== undefined &&
      root.allowedDeviceIds.includes(deviceId) &&
      this.pairedDeviceIds().includes(deviceId)
    )
  }

  /** Preview is mobile-only and requires the current paired-device scope to remain mobile. */
  isPreviewDeviceCurrent(deviceId: string): boolean {
    return this.pairedMobileDeviceIds().includes(deviceId)
  }
}

function sameNativeRootIdentity(
  left: { dev: string; ino: string; incarnation?: CatalogRootIdentity['incarnation'] },
  right: CatalogRootIdentity
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.incarnation?.provider === right.incarnation.provider &&
    left.incarnation.scope === right.incarnation.scope &&
    left.incarnation.token === right.incarnation.token
  )
}
