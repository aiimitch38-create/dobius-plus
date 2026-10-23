import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApplicationDataCatalog } from '../../../storage/data-catalog/application-catalog'
import { createDescriptorDirectoryBridge } from '../../../storage/data-catalog/descriptor-directory-bridge'
import type { DobiusRuntimeService } from '../../dobius-runtime'
import { RpcDispatcher } from '../dispatcher'
import { DATA_CATALOG_METHODS } from './data-catalog'

const deviceId = 'd6ea53cb-c589-459d-ad93-06b3cfc2479b'
const runtime = { getRuntimeId: () => 'fixture-runtime' } as DobiusRuntimeService
const disposals: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const dispose of disposals.splice(0)) {
    await dispose()
  }
})
const request = (method: string, params?: unknown) => ({
  id: 'request',
  authToken: 'opaque-token',
  method,
  params
})

async function fixture() {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'dobius-catalog-rpc-')))
  const vault = join(path, 'Selected vault')
  await mkdir(vault)
  await writeFile(join(vault, 'original.md'), '# Keep this original')
  const choose = vi.fn(async () => vault as string | null)
  let paired = [{ deviceId, name: 'Fixture phone' }]
  const bridge = createDescriptorDirectoryBridge({
    pythonExecutable: '/usr/bin/python3',
    scriptPath: resolve('config/scripts/data-catalog/descriptor-directory-bridge.py')
  })
  const dataCatalog = new ApplicationDataCatalog({
    registryPath: join(path, 'browse.json'),
    pairedDevices: () => paired,
    pairedMobileDevices: () => paired.map((device) => ({ ...device, scope: 'mobile' as const })),
    chooseDirectory: choose,
    fileSystem: bridge,
    disposeFileSystem: () => bridge.dispose()
  })
  const dispatcher = new RpcDispatcher({ runtime, dataCatalog, methods: DATA_CATALOG_METHODS })
  disposals.push(async () => {
    await dataCatalog.close()
    await rm(path, { recursive: true, force: true })
  })
  const local = (method: string, params?: unknown) =>
    dispatcher.dispatch(request(method, params), {
      authenticatedLocal: true,
      localPreviewConnection: {
        kind: 'local-webcontents',
        connectionId: 'local-fixture-connection',
        webContentsId: 1,
        navigationId: 0,
        signal: new AbortController().signal
      }
    })
  const phone = async (method: string, params?: unknown, identity: string | null = deviceId) => {
    const replies: string[] = []
    await dispatcher.dispatchStreaming(request(method, params), (reply) => replies.push(reply), {
      clientDeviceId: identity ?? undefined,
      clientId: 'private-bearer',
      clientKind: 'mobile',
      connectionId: 'phone-fixture-connection',
      connectionSignal: new AbortController().signal
    })
    return JSON.parse(replies[0]!)
  }
  return {
    dataCatalog,
    dispatcher,
    local,
    phone,
    choose,
    vault,
    unpair: () => {
      paired = []
    }
  }
}

describe.skipIf(process.platform === 'win32')(
  'native data catalog authenticated RPC boundary',
  () => {
    it('does not infer desktop privilege from transport token or request parameters', async () => {
      const f = await fixture()
      expect(
        await f.dispatcher.dispatch(request('data.catalog.roots', { principal: 'desktop' }))
      ).toMatchObject({ ok: true, result: { state: 'denied', roots: [] } })
      expect(await f.phone('data.catalog.chooseRoot', { kind: 'obsidian-vault' })).toMatchObject({
        ok: false
      })
      expect(await f.phone('data.catalog.devices')).toMatchObject({ ok: false })
      expect(f.choose).not.toHaveBeenCalled()
    })

    it('accepts only a native-picker choice and rejects caller filesystem paths', async () => {
      const f = await fixture()
      expect(
        await f.local('data.catalog.chooseRoot', { kind: 'obsidian-vault', path: f.vault })
      ).toMatchObject({ ok: false })
      expect(f.choose).not.toHaveBeenCalled()
      const response = await f.local('data.catalog.chooseRoot', { kind: 'obsidian-vault' })
      expect(response).toMatchObject({
        ok: true,
        result: { kind: 'obsidian-vault', label: 'Selected vault' }
      })
      expect(JSON.stringify(response)).not.toContain(f.vault)
      expect(f.choose).toHaveBeenCalledOnce()
    })

    it('binds phone reads to the authenticated device grant and revokes immediately', async () => {
      const f = await fixture()
      const enrolled = await f.local('data.catalog.chooseRoot', { kind: 'obsidian-vault' })
      expect(enrolled.ok).toBe(true)
      if (!enrolled.ok) {
        throw new Error('Fixture enrollment failed')
      }
      const rootId = (enrolled.result as { rootId: string }).rootId
      expect(await f.phone('data.catalog.roots')).toMatchObject({
        result: { state: 'ready', roots: [] }
      })
      expect(await f.phone('data.catalog.page', { rootId })).toMatchObject({
        result: { state: 'denied', entries: [] }
      })
      expect(
        await f.local('data.catalog.setAccess', { rootId, deviceIds: [deviceId] })
      ).toMatchObject({ ok: true })
      const roster = await f.phone('data.catalog.roots')
      expect(roster.result.roots).toHaveLength(1)
      expect(roster.result.roots[0]).not.toHaveProperty('allowedDeviceIds')
      expect(await f.phone('data.catalog.roots', undefined, null)).toMatchObject({
        result: { state: 'denied', roots: [] }
      })
      f.unpair()
      expect(await f.phone('data.catalog.roots')).toMatchObject({ result: { roots: [] } })
      expect(await f.phone('data.catalog.page', { rootId })).toMatchObject({
        result: { state: 'denied', entries: [] }
      })
    })

    it('refuses remote permission edits and never deletes original notes on removal', async () => {
      const f = await fixture()
      const view = await f.dataCatalog.chooseRoot('desktop', 'obsidian-vault')
      const rootId = view!.rootId
      expect(
        await f.phone('data.catalog.setAccess', { rootId, deviceIds: [deviceId] })
      ).toMatchObject({ ok: false })
      expect(await f.phone('data.catalog.removeRoot', { rootId })).toMatchObject({ ok: false })
      expect(await f.local('data.catalog.removeRoot', { rootId })).toMatchObject({
        result: { removed: true }
      })
      expect(await readFile(join(f.vault, 'original.md'), 'utf8')).toBe('# Keep this original')
      expect(await f.local('data.catalog.roots')).toMatchObject({ result: { roots: [] } })
    })

    it('requires the trusted local WebContents principal for preview grant mutation', async () => {
      const f = await fixture()
      const root = await f.dataCatalog.chooseRoot('desktop', 'obsidian-vault')
      expect(root).not.toBeNull()
      const params = {
        rootId: root!.rootId,
        desktopPreviewEnabled: true,
        deviceIds: [deviceId]
      }
      expect(
        await f.local('data.catalog.setPreviewAccess', { ...params, canonicalPath: f.vault })
      ).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })

      const unixLocal = await f.dispatcher.dispatch(
        request('data.catalog.setPreviewAccess', params),
        {
          authenticatedLocal: true
        }
      )
      expect(unixLocal).toMatchObject({ ok: true, result: { state: 'denied' } })
      expect(await f.phone('data.catalog.setPreviewAccess', params)).toMatchObject({
        ok: true,
        result: { state: 'denied' }
      })
      expect(f.dataCatalog.list('desktop').roots[0]?.generation).toBe(root!.generation)

      const trustedLocal = await f.local('data.catalog.setPreviewAccess', params)
      expect(trustedLocal).toMatchObject({ ok: true, result: { generation: expect.any(String) } })
      expect(JSON.stringify(trustedLocal)).not.toContain(f.vault)
    })

    it('keeps mobile preview separate from browse access and requires explicit preview grant', async () => {
      const f = await fixture()
      const root = await f.dataCatalog.chooseRoot('desktop', 'obsidian-vault')
      expect(root).not.toBeNull()
      await f.local('data.catalog.setAccess', { rootId: root!.rootId, deviceIds: [deviceId] })
      const browsableRoot = f.dataCatalog.roots
        .list('desktop')
        .find((item) => item.rootId === root!.rootId)
      expect(browsableRoot).toBeDefined()

      expect(
        await f.phone('data.catalog.preview.policy', {
          rootId: root!.rootId,
          generation: browsableRoot!.generation
        })
      ).toMatchObject({ result: { state: 'mobile', enabled: false } })

      const updated = await f.local('data.catalog.setPreviewAccess', {
        rootId: root!.rootId,
        desktopPreviewEnabled: false,
        deviceIds: [deviceId]
      })
      expect(updated.ok).toBe(true)
      const currentRoot = f.dataCatalog.roots
        .list('desktop')
        .find((item) => item.rootId === root!.rootId)
      expect(currentRoot).toBeDefined()
      expect(
        await f.phone('data.catalog.preview.policy', {
          rootId: root!.rootId,
          generation: currentRoot!.generation
        })
      ).toMatchObject({ result: { state: 'mobile', enabled: true } })
    })

    it('cancelled native selection creates no root and concurrent picks cannot open two dialogs', async () => {
      const f = await fixture()
      let release: (value: string | null) => void = () => undefined
      f.choose.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve
          })
      )
      const first = f.local('data.catalog.chooseRoot', { kind: 'obsidian-vault' })
      const second = await f.local('data.catalog.chooseRoot', { kind: 'obsidian-vault' })
      expect(second).toMatchObject({ ok: false })
      release(null)
      expect(await first).toMatchObject({ result: null })
      expect(f.choose).toHaveBeenCalledOnce()
      expect(await f.local('data.catalog.roots')).toMatchObject({ result: { roots: [] } })
    })
  }
)
