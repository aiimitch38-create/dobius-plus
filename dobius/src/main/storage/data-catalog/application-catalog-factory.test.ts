import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApplicationDataCatalog } from './application-catalog-factory'
import { ApplicationDataCatalog } from './application-catalog'
import { defaultMetadataFileSystem } from './metadata-scanner'
import type { CatalogRootIdentity } from './types'
import type { CatalogPreviewPrincipal } from './preview-principal'
import { DataCatalogPreviewClient } from '../../../shared/data-catalog-preview-client'

const deviceId = 'd6ea53cb-c589-459d-ad93-06b3cfc2479b'
const disposals: (() => Promise<void>)[] = []

function localPreviewPrincipal(): CatalogPreviewPrincipal {
  return {
    kind: 'local-webcontents',
    principalId: 'desktop',
    connectionId: 'local:42:fixture-document',
    hostId: 'fixture-host',
    webContentsId: 42,
    navigationId: '0',
    signal: new AbortController().signal
  }
}
afterEach(async () => {
  for (const dispose of disposals.splice(0)) {
    await dispose()
  }
})

async function fixture(packaged: boolean, missingHelper = false) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'dobius-catalog-application-')))
  const vault = join(base, 'Selected vault')
  await mkdir(vault)
  await writeFile(join(vault, 'original.md'), '# Private note bytes')
  let paired = [{ deviceId, name: 'Fixture phone' }]
  const resourcesPath = join(base, 'resources')
  if (packaged && !missingHelper) {
    await mkdir(join(resourcesPath, 'data-catalog'), { recursive: true })
    await copyFile(
      resolve('config/scripts/data-catalog/descriptor-directory-bridge.py'),
      join(resourcesPath, 'data-catalog', 'descriptor-directory-bridge.py')
    )
    await copyFile(
      resolve('config/scripts/data-catalog/native-root-identity.py'),
      join(resourcesPath, 'data-catalog', 'native-root-identity.py')
    )
  }
  const chooseDirectory = vi.fn(async () => vault as string | null)
  const onPreviewInvalidated = vi.fn()
  const catalog = createApplicationDataCatalog({
    registryPath: join(base, 'registry.json'),
    pairedDevices: () => paired,
    onPreviewInvalidated,
    chooseDirectory,
    packaged,
    resourcesPath,
    applicationPath: resolve('.')
  })
  disposals.push(async () => {
    await catalog.close()
    await rm(base, { force: true, recursive: true })
  })
  return {
    catalog,
    vault,
    chooseDirectory,
    onPreviewInvalidated,
    unpair: () => {
      paired = []
    }
  }
}

describe('application-owned catalog bridge', () => {
  it.skipIf(process.platform === 'win32')(
    'forwards content-free invalidation for the connection that received metadata',
    async () => {
      const f = await fixture(false)
      const root = await f.catalog.chooseRoot('desktop', 'obsidian-vault')
      expect(root).not.toBeNull()
      const principal = localPreviewPrincipal()
      const page = await f.catalog.page('desktop', { rootId: root!.rootId }, principal)
      expect(page.state).toBe('complete')
      expect(page.entries).toHaveLength(1)
      f.catalog.setPreviewAccess('desktop', {
        rootId: root!.rootId,
        desktopPreviewEnabled: false,
        deviceIds: []
      })
      expect(f.onPreviewInvalidated).toHaveBeenCalledExactlyOnceWith(principal.connectionId, {
        rootId: root!.rootId,
        generation: root!.generation,
        reason: 'revoked'
      })
      expect(JSON.stringify(f.onPreviewInvalidated.mock.calls)).not.toContain(f.vault)
      expect(JSON.stringify(f.onPreviewInvalidated.mock.calls)).not.toContain('Private note bytes')
    }
  )

  it.skipIf(process.platform === 'win32').each([false, true])(
    'assembles an opted-in native preview and immediately clears on revocation (packaged=%s)',
    async (packaged) => {
      const f = await fixture(packaged)
      const root = await f.catalog.chooseRoot('desktop', 'obsidian-vault')
      expect(root).not.toBeNull()
      const principal = localPreviewPrincipal()
      const previewRoot = f.catalog.setPreviewAccess('desktop', {
        rootId: root!.rootId,
        desktopPreviewEnabled: true,
        deviceIds: []
      })
      const page = await f.catalog.page('desktop', { rootId: root!.rootId }, principal)
      expect(page.state).toBe('complete')
      expect(JSON.stringify(page)).not.toContain('# Private note bytes')
      const operations = {
        'data.catalog.preview.resolve': (request: unknown) =>
          f.catalog.previewResolve(principal, request),
        'data.catalog.preview.start': (request: unknown) =>
          f.catalog.previewStart(principal, request),
        'data.catalog.preview.chunk': (request: unknown) =>
          f.catalog.previewChunk(principal, request),
        'data.catalog.preview.finish': (request: unknown) =>
          f.catalog.previewFinish(principal, request),
        'data.catalog.preview.renew': (request: unknown) =>
          f.catalog.previewRenew(principal, request),
        'data.catalog.preview.close': (request: unknown) =>
          f.catalog.previewClose(principal, request)
      }
      const observed: { method: string; state: string | undefined }[] = []
      const client = new DataCatalogPreviewClient({
        isForeground: () => true,
        rpc: async (method, request) => {
          const operation = operations[method as keyof typeof operations]
          if (!operation) {
            throw new Error('Unexpected preview operation')
          }
          const result = await operation(request)
          observed.push({ method, state: result.state })
          return result
        }
      })
      disposals.push(() => client.clear())
      f.onPreviewInvalidated.mockImplementation((connectionId, event) => {
        if (connectionId === principal.connectionId) {
          client.handleInvalidation(event)
        }
      })
      await client.preview({
        rootId: root!.rootId,
        generation: previewRoot.generation,
        entryId: page.entries[0]!.entryId
      })
      expect(client.getState(), JSON.stringify(observed)).toMatchObject({
        phase: 'visible',
        text: '# Private note bytes'
      })
      f.catalog.setPreviewAccess('desktop', {
        rootId: root!.rootId,
        desktopPreviewEnabled: false,
        deviceIds: []
      })
      expect(client.getState().phase).toBe('failed')
      expect(JSON.stringify(client.getState())).not.toContain('# Private note bytes')
      await client.clear()
    }
  )

  it.skipIf(process.platform === 'win32').each([false, true])(
    'reads only metadata from the %s packaged helper location',
    async (packaged) => {
      const f = await fixture(packaged)
      const root = await f.catalog.chooseRoot('desktop', 'obsidian-vault')
      expect(root).not.toBeNull()
      expect(f.catalog.list(`device:${deviceId}`).roots).toEqual([])
      f.catalog.setAccess('desktop', root!.rootId, [deviceId])
      const result = await f.catalog.page(`device:${deviceId}`, { rootId: root!.rootId })
      expect(result.state).toBe('complete')
      expect(result.entries).toHaveLength(1)
      expect(result.entries[0]).toMatchObject({ name: 'original.md', relativePath: 'original.md' })
      expect(JSON.stringify(result)).not.toContain('# Private note bytes')
      expect(JSON.stringify(result)).not.toContain(f.vault)
      f.unpair()
      expect(await f.catalog.page(`device:${deviceId}`, { rootId: root!.rootId })).toMatchObject({
        state: 'denied',
        entries: []
      })
      await f.catalog.close()
      await f.catalog.close()
      expect(await readFile(join(f.vault, 'original.md'), 'utf8')).toBe('# Private note bytes')
    }
  )

  it('refuses granting a root when the packaged helper is missing', async () => {
    const f = await fixture(true, true)
    await expect(f.catalog.chooseRoot('desktop', 'folder-workspace')).rejects.toThrow(
      'cannot prove folder identity'
    )
    expect(f.catalog.roots.list('desktop')).toEqual([])
  })

  it('rejects a native picker result arriving after shutdown without persisting it', async () => {
    const f = await fixture(false)
    let picked!: (path: string | null) => void
    f.chooseDirectory.mockImplementation(
      () =>
        new Promise((resolve) => {
          picked = resolve
        })
    )
    const pending = f.catalog.chooseRoot('desktop', 'obsidian-vault')
    await f.catalog.close()
    picked(f.vault)
    await expect(pending).rejects.toThrow('closed')
    expect(f.catalog.roots.list('desktop')).toEqual([])
    expect(f.catalog.list('desktop')).toEqual({ state: 'unavailable', roots: [] })
    expect(() => f.catalog.setAccess('desktop', 'unused', [deviceId])).toThrow('closed')
  })

  it('cancels a native proof already pending during shutdown without persisting permission', async () => {
    const f = await fixture(false)
    const info = await stat(f.vault, { bigint: true })
    let release!: (identity: CatalogRootIdentity) => void
    let started!: () => void
    const entered = new Promise<void>((resolve) => (started = resolve))
    const catalog = new ApplicationDataCatalog({
      registryPath: join(f.vault, 'pending-registration.json'),
      pairedDevices: () => [{ deviceId, name: 'Fixture phone' }],
      chooseDirectory: async () => f.vault,
      fileSystem: {
        ...defaultMetadataFileSystem,
        captureRootIdentity: () => {
          started()
          return new Promise((resolve) => (release = resolve))
        }
      }
    })
    disposals.push(() => catalog.close())
    const pending = catalog.chooseRoot('desktop', 'folder-workspace')
    const rejected = expect(pending).rejects.toThrow('cancelled')
    await entered
    await catalog.close()
    await rejected
    release({
      dev: String(info.dev),
      ino: String(info.ino),
      incarnation: { provider: 'linux-inode-generation-v1', scope: '1122334455667788', token: '1' }
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(catalog.roots.list('desktop')).toEqual([])
    await expect(readFile(join(f.vault, 'pending-registration.json'))).rejects.toThrow()
  })
})
