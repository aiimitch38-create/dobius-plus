import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { ApplicationDataCatalog } from './application-catalog'
import { previewFileVersion, type NativePreviewIdentity } from './descriptor-preview-contract'
import type { MetadataDirectoryHandle, MetadataFileSystem } from './metadata-scanner'
import type { CatalogRootIdentity, RegisteredCatalogRoot } from './types'
import type { LocalWebContentsPreviewPrincipal } from './preview-principal'

export const deviceId = '8de3037a-7171-4399-af40-9e31de2cb59e'
const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

export async function fixture(
  options: {
    includeIdentity?: boolean
    pairedMobile?: boolean
    missingMobileScope?: boolean
    deferStat?: boolean
    deferOpen?: boolean
    helperEpochAvailable?: boolean
  } = {}
) {
  const base = await mkdtemp(join(tmpdir(), 'dobius-preview-service-'))
  directories.push(base)
  const vault = join(base, 'fixture-vault')
  await mkdir(vault)
  const rootInfo = await stat(vault, { bigint: true })
  let childIdentity: NativePreviewIdentity = {
    dev: String(rootInfo.dev),
    ino: '99',
    sizeBytes: '4',
    mtimeNs: '1000000000',
    ctimeNs: '1000000001',
    fileType: 'regular'
  }
  let helperEpoch = 1
  let readCalls = 0
  let statCalls = 0
  let verifyRootCalls = 0
  const invalidations: { connectionId: string; event: unknown }[] = []
  let deferNextOpen = false
  let deferNextStat = false
  let deferNextClose = false
  let resolveOpen!: () => void
  let resolveStat!: () => void
  let resolveClose!: () => void
  let statEntered!: () => void
  let openEntered!: () => void
  let closeEntered!: () => void
  const openEnteredPromise = new Promise<void>((resolve) => (openEntered = resolve))
  const statEnteredPromise = new Promise<void>((resolve) => (statEntered = resolve))
  const closeEnteredPromise = new Promise<void>((resolve) => (closeEntered = resolve))
  const fileSystem: MetadataFileSystem = {
    supportsRaceSafeDirectoryHandles: true,
    captureRootIdentity: async (path) => {
      const current = await stat(path, { bigint: true })
      return {
        dev: String(current.dev),
        ino: String(current.ino),
        incarnation: {
          provider:
            process.platform === 'darwin' ? 'darwin-apfs-file-id-v1' : 'linux-inode-generation-v1',
          scope:
            process.platform === 'darwin' ? '0123456789abcdef0123456789abcdef' : '0123456789abcdef',
          token: '1'
        }
      } as CatalogRootIdentity
    },
    ...(options.helperEpochAvailable === false ? {} : { previewHelperEpoch: () => helperEpoch }),
    async openRoot(root: RegisteredCatalogRoot): Promise<MetadataDirectoryHandle> {
      if (options.deferOpen && deferNextOpen) {
        deferNextOpen = false
        openEntered()
        await new Promise<void>((resolve) => (resolveOpen = resolve))
      }
      let read = false
      return {
        identity: { dev: root.identity.dev, ino: root.identity.ino },
        async read() {
          if (read) {
            return null
          }
          read = true
          return { name: 'sample.md' }
        },
        async close() {
          if (deferNextClose) {
            deferNextClose = false
            closeEntered()
            await new Promise<void>((resolve) => (resolveClose = resolve))
          }
        }
      }
    },
    async verifyRoot() {
      verifyRootCalls += 1
      return true
    },
    async lstatChild(parent, _name) {
      void parent
      return {
        kind: 'file',
        identity: { dev: childIdentity.dev, ino: childIdentity.ino },
        size: Number(childIdentity.sizeBytes),
        modifiedAtMs: 1_700_000_000_000,
        ...(options.includeIdentity === false ? {} : { previewIdentity: childIdentity })
      }
    },
    async openChildDirectory() {
      throw new Error('not used')
    },
    async verifyChild() {
      return true
    },
    async statPreview(root, _openedRoot, components) {
      statCalls += 1
      if (options.deferStat && deferNextStat) {
        deferNextStat = false
        statEntered()
        await new Promise<void>((resolve) => (resolveStat = resolve))
      }
      const version = previewFileVersion(
        root.id,
        root.generation,
        root.identity,
        components,
        childIdentity
      )
      return { ...childIdentity, fileVersion: version }
    },
    async readPreviewChunk(root, _openedRoot, components, expectedStat, offset, length) {
      readCalls += 1
      const data = Buffer.from('text').subarray(offset, offset + length)
      const version = previewFileVersion(
        root.id,
        root.generation,
        root.identity,
        components,
        childIdentity
      )
      return {
        stat: { ...childIdentity, fileVersion: version },
        dataBase64: data.toString('base64'),
        offset,
        nextOffset: offset + data.byteLength,
        final: offset + data.byteLength === Number(expectedStat.sizeBytes)
      }
    }
  }
  const mobile = options.pairedMobile ?? true
  const catalog = new ApplicationDataCatalog({
    registryPath: join(base, 'registrations.json'),
    pairedDevices: () => [
      { deviceId, name: 'Fixture phone', scope: mobile ? 'mobile' : 'runtime' }
    ],
    pairedMobileDevices: () =>
      mobile
        ? [
            {
              deviceId,
              name: 'Fixture phone',
              scope: options.missingMobileScope ? undefined : 'mobile'
            }
          ]
        : [],
    chooseDirectory: async () => vault,
    fileSystem,
    onPreviewInvalidated: (connectionId, event) => invalidations.push({ connectionId, event })
  })
  const principal: LocalWebContentsPreviewPrincipal = {
    kind: 'local-webcontents',
    principalId: 'desktop',
    connectionId: 'ipc:fixture:navigation:1',
    hostId: 'fixture-host',
    webContentsId: 41,
    navigationId: 'navigation-1',
    signal: new AbortController().signal
  }
  return {
    base,
    vault,
    catalog,
    principal,
    invalidations,
    get readCalls() {
      return readCalls
    },
    get statCalls() {
      return statCalls
    },
    get verifyRootCalls() {
      return verifyRootCalls
    },
    get helperEpoch() {
      return helperEpoch
    },
    set helperEpoch(value: number) {
      helperEpoch = value
    },
    deferNextStat() {
      deferNextStat = true
    },
    deferNextOpen() {
      deferNextOpen = true
    },
    openEntered: openEnteredPromise,
    releaseOpen() {
      resolveOpen()
    },
    deferNextClose() {
      deferNextClose = true
    },
    statEntered: statEnteredPromise,
    releaseStat() {
      resolveStat()
    },
    closeEntered: closeEnteredPromise,
    releaseClose() {
      resolveClose()
    },
    changeChildIdentity() {
      childIdentity = {
        ...childIdentity,
        mtimeNs: String(BigInt(childIdentity.mtimeNs) + 1n),
        ctimeNs: String(BigInt(childIdentity.ctimeNs) + 1n)
      }
    }
  }
}

export async function prepared(f: Awaited<ReturnType<typeof fixture>>) {
  const root = await f.catalog.chooseRoot('desktop', 'obsidian-vault')
  if (!root) {
    throw new Error('fixture root was not enrolled')
  }
  f.catalog.setPreviewAccess('desktop', {
    rootId: root.rootId,
    desktopPreviewEnabled: true,
    deviceIds: []
  })
  const page = await f.catalog.page('desktop', { rootId: root.rootId }, f.principal)
  const entry = page.entries[0]
  if (!entry) {
    throw new Error('fixture row was not emitted')
  }
  const current = f.catalog.roots.list('desktop').find((item) => item.rootId === root.rootId)
  if (!current) {
    throw new Error('fixture root was not available after preview grant')
  }
  return { rootId: root.rootId, generation: current.generation, entryId: entry.entryId }
}

export async function completedSession(f: Awaited<ReturnType<typeof fixture>>) {
  const target = await prepared(f)
  const resolved = await f.catalog.previewResolve(f.principal, target)
  if (resolved.state !== 'ready') {
    throw new Error('fixture reference unavailable')
  }
  const started = await f.catalog.previewStart(f.principal, { entryRef: resolved.entryRef })
  if (started.state !== 'ready') {
    throw new Error('fixture session unavailable')
  }
  const chunk = await f.catalog.previewChunk(f.principal, {
    previewSessionId: started.previewSessionId,
    offset: 0
  })
  if (chunk.state !== 'chunk') {
    throw new Error('fixture chunk unavailable')
  }
  return { target, started }
}
