import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DataCatalogRootsResult } from '../../../shared/data-catalog-roots'
import { DataCatalogRootEnrollmentStore } from './root-enrollment-store'
import { createDescriptorDirectoryBridge } from './descriptor-directory-bridge'
import { ReadOnlyDataCatalogService } from './catalog-service'

const device = '8de3037a-7171-4399-af40-9e31de2cb59e'
const directories: string[] = []
const bridges: ReturnType<typeof createDescriptorDirectoryBridge>[] = []
async function fixture() {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'dobius-catalog-enrollment-')))
  directories.push(path)
  const vault = join(path, 'Personal vault')
  await mkdir(vault)
  await writeFile(join(vault, 'original.md'), '# My original note')
  const file = join(path, 'registrations.json')
  let paired = [device]
  const bridge = createDescriptorDirectoryBridge({
    pythonExecutable: '/usr/bin/python3',
    scriptPath: resolve('config/scripts/data-catalog/descriptor-directory-bridge.py')
  })
  bridges.push(bridge)
  const captureIdentity = (path: string) => bridge.captureRootIdentity!(path)
  const store = new DataCatalogRootEnrollmentStore(
    file,
    () => paired,
    captureIdentity,
    undefined,
    () => paired
  )
  return {
    path,
    vault,
    file,
    store,
    captureIdentity,
    bridge,
    unpair: () => {
      paired = []
    }
  }
}
afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.dispose()))
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform === 'win32')('native catalog browse registration', () => {
  it('starts empty and never grants access from a root name or guessed device principal', async () => {
    const { store } = await fixture()
    expect(store.list('desktop')).toEqual([])
    expect(await store.resolveAuthorizedRoot('desktop', 'catalog:guess')).toBeNull()
    expect(await store.resolveAuthorizedRoot(`device:${device}`, 'catalog:guess')).toBeNull()
  })

  it('defaults local and mobile preview grants off, and keeps them separate from browse access', async () => {
    const { store, vault } = await fixture()
    const root = await store.enrollPickedDirectory(vault, 'obsidian-vault')
    const before = store.previewRegistration(root.rootId)!
    expect(before.desktopPreviewEnabled).toBe(false)
    expect(before.allowedPreviewDeviceIds).toEqual([])

    const browse = store.setDeviceAccess(root.rootId, [device])
    const afterBrowse = store.previewRegistration(root.rootId)!
    expect(afterBrowse.allowedDeviceIds).toEqual([device])
    expect(afterBrowse.desktopPreviewEnabled).toBe(false)
    expect(afterBrowse.allowedPreviewDeviceIds).toEqual([])

    const preview = store.setPreviewAccess(root.rootId, true, [device])
    const afterPreview = store.previewRegistration(root.rootId)!
    expect(preview.generation).not.toBe(browse.generation)
    expect(afterPreview.desktopPreviewEnabled).toBe(true)
    expect(afterPreview.allowedPreviewDeviceIds).toEqual([device])
    expect(afterPreview.allowedDeviceIds).toEqual([device])
  })

  it('keeps legacy registrations default-denied without upgrading browse grants', async () => {
    const { store, file, vault } = await fixture()
    const root = await store.enrollPickedDirectory(vault, 'obsidian-vault')
    store.setDeviceAccess(root.rootId, [device])
    const saved = JSON.parse(await readFile(file, 'utf8')) as {
      roots: Record<string, unknown>[]
    }
    delete saved.roots[0].desktopPreviewEnabled
    delete saved.roots[0].allowedPreviewDeviceIds
    await writeFile(file, JSON.stringify(saved))

    const reopened = new DataCatalogRootEnrollmentStore(file, () => [device])
    const legacy = reopened.previewRegistration(root.rootId)!
    expect(legacy.desktopPreviewEnabled).toBe(false)
    expect(legacy.allowedPreviewDeviceIds).toEqual([])
    expect(legacy.allowedDeviceIds).toEqual([device])
  })

  it('rejects preview grants for devices that are no longer paired', async () => {
    const { store, vault, unpair } = await fixture()
    const root = await store.enrollPickedDirectory(vault, 'obsidian-vault')
    unpair()
    expect(() => store.setPreviewAccess(root.rootId, true, [device])).toThrow(
      'no longer paired for mobile preview'
    )
    expect(store.previewRegistration(root.rootId)).toMatchObject({
      desktopPreviewEnabled: false,
      allowedPreviewDeviceIds: []
    })
  })

  it('does not treat a paired runtime device as a mobile preview principal', async () => {
    const { store, vault, file, captureIdentity } = await fixture()
    const root = await store.enrollPickedDirectory(vault, 'obsidian-vault')
    const runtimeOnlyStore = new DataCatalogRootEnrollmentStore(
      file,
      () => [device],
      captureIdentity,
      undefined,
      () => []
    )
    expect(() => runtimeOnlyStore.setPreviewAccess(root.rootId, false, [device])).toThrow(
      'no longer paired for mobile preview'
    )
    expect(runtimeOnlyStore.previewRegistration(root.rootId)?.allowedPreviewDeviceIds).toEqual([])
  })

  it('persists only a chosen root and returns a safe roster without absolute paths or note bytes', async () => {
    const { store, file, vault } = await fixture()
    const view = await store.enrollPickedDirectory(vault, 'obsidian-vault')
    const roster = DataCatalogRootsResult.parse({ state: 'ready', roots: store.list('desktop') })
    expect(roster.roots).toEqual([view])
    expect(JSON.stringify(roster)).not.toContain(vault)
    expect(JSON.stringify(roster)).not.toContain('My original note')
    expect(await readFile(join(vault, 'original.md'), 'utf8')).toBe('# My original note')
    if (process.platform !== 'win32') {
      expect((await stat(file)).mode & 0o777).toBe(0o600)
    }
    const reopened = new DataCatalogRootEnrollmentStore(file, () => [device])
    expect(reopened.list('desktop')).toEqual([view])
    expect(await reopened.resolveAuthorizedRoot('desktop', view.rootId)).toMatchObject({
      id: view.rootId,
      canonicalPath: vault,
      browseGranted: true
    })
  })

  it('requires explicit paired-device grants and observes unpairing immediately', async () => {
    const { store, vault, unpair } = await fixture()
    const view = await store.enrollPickedDirectory(vault, 'obsidian-vault')
    expect(store.list(`device:${device}`)).toEqual([])
    const granted = store.setDeviceAccess(view.rootId, [device])
    expect(granted.generation).not.toBe(view.generation)
    expect(store.list(`device:${device}`)[0]).not.toHaveProperty('allowedDeviceIds')
    expect(await store.resolveAuthorizedRoot(`device:${device}`, view.rootId)).not.toBeNull()
    unpair()
    expect(store.list(`device:${device}`)).toEqual([])
    expect(await store.resolveAuthorizedRoot(`device:${device}`, view.rootId)).toBeNull()
    expect(() => store.setDeviceAccess(view.rootId, [device])).toThrow('no longer paired')
  })

  it('revokes browse permission without touching original files', async () => {
    const { store, vault } = await fixture()
    const view = await store.enrollPickedDirectory(vault, 'obsidian-vault')
    store.setDeviceAccess(view.rootId, [device])
    store.revoke(view.rootId)
    expect(await store.resolveAuthorizedRoot('desktop', view.rootId)).toBeNull()
    expect(await store.resolveAuthorizedRoot(`device:${device}`, view.rootId)).toBeNull()
    expect(await readFile(join(vault, 'original.md'), 'utf8')).toBe('# My original note')
  })

  it('does not inherit phone grants when the chosen folder has been replaced', async () => {
    const { store, vault, path } = await fixture()
    const first = await store.enrollPickedDirectory(vault, 'obsidian-vault')
    store.setDeviceAccess(first.rootId, [device])
    await rename(vault, join(path, 'preserved-original'))
    await mkdir(vault)
    const replaced = await store.enrollPickedDirectory(vault, 'obsidian-vault')
    expect(replaced.rootId).toBe(first.rootId)
    expect(replaced.generation).not.toBe(first.generation)
    expect(replaced.allowedDeviceIds).toEqual([])
    expect(store.list(`device:${device}`)).toEqual([])
    expect(await readFile(join(path, 'preserved-original', 'original.md'), 'utf8')).toBe(
      '# My original note'
    )
  })

  it('refuses old access after actual empty-folder deletion and recreation', async () => {
    const { store, path, bridge } = await fixture()
    const selected = join(path, 'Replaceable empty folder')
    await mkdir(selected)
    const before = await store.enrollPickedDirectory(selected, 'folder-workspace')
    store.setDeviceAccess(before.rootId, [device])
    const registered = await store.resolveAuthorizedRoot('desktop', before.rootId)
    await rm(selected, { recursive: true })
    await mkdir(selected)
    const replacement = await bridge.captureRootIdentity!(selected)
    expect(replacement.incarnation).not.toEqual(registered!.identity.incarnation)
    const service = new ReadOnlyDataCatalogService(store, { fileSystem: bridge })
    try {
      expect(await service.page(`device:${device}`, { rootId: before.rootId })).toMatchObject({
        state: 'unavailable',
        reason: 'root_changed',
        entries: []
      })
      const after = await store.enrollPickedDirectory(selected, 'folder-workspace')
      expect(after.allowedDeviceIds).toEqual([])
      expect(store.list(`device:${device}`)).toEqual([])
    } finally {
      await service.close()
    }
  })

  it('retains grants when ordinary children change without replacing the native folder', async () => {
    const { store, vault, bridge } = await fixture()
    const first = await store.enrollPickedDirectory(vault, 'obsidian-vault')
    store.setDeviceAccess(first.rootId, [device])
    await mkdir(join(vault, 'New child'))
    const second = await store.enrollPickedDirectory(vault, 'obsidian-vault')
    expect(second.allowedDeviceIds).toEqual([device])
    const service = new ReadOnlyDataCatalogService(store, { fileSystem: bridge })
    try {
      expect(await service.page(`device:${device}`, { rootId: first.rootId })).toMatchObject({
        state: 'complete'
      })
    } finally {
      await service.close()
    }
  })

  it('refuses relative paths, absent folders, files and symlink selections', async () => {
    const { store, path, vault } = await fixture()
    await expect(store.enrollPickedDirectory('relative', 'folder-workspace')).rejects.toThrow()
    await expect(
      store.enrollPickedDirectory(join(path, 'absent'), 'folder-workspace')
    ).rejects.toThrow()
    await expect(
      store.enrollPickedDirectory(join(vault, 'original.md'), 'artifact')
    ).rejects.toThrow()
    if (process.platform !== 'win32') {
      const link = join(path, 'alias')
      await symlink(vault, link)
      await expect(store.enrollPickedDirectory(link, 'obsidian-vault')).rejects.toThrow(
        'real folder'
      )
    }
    expect(store.list('desktop')).toEqual([])
  })

  it('fails closed on corrupt registration and preserves its bytes', async () => {
    const { store, file, vault } = await fixture()
    await writeFile(file, '{ broken registration')
    expect(() => store.list('desktop')).toThrow('unavailable')
    await expect(store.resolveAuthorizedRoot('desktop', 'catalog:guess')).rejects.toThrow()
    await expect(store.enrollPickedDirectory(vault, 'obsidian-vault')).rejects.toThrow()
    expect(await readFile(file, 'utf8')).toBe('{ broken registration')
  })

  it('preserves independent simultaneous registrations and reuses one root id on reselection', async () => {
    const { store, path, vault } = await fixture()
    const repository = join(path, 'Repository')
    await mkdir(repository)
    const [one, two] = await Promise.all([
      store.enrollPickedDirectory(vault, 'obsidian-vault'),
      store.enrollPickedDirectory(repository, 'repository')
    ])
    expect(new Set(store.list('desktop').map((r) => r.rootId))).toEqual(
      new Set([one.rootId, two.rootId])
    )
    const selected = await store.enrollPickedDirectory(vault, 'obsidian-vault')
    expect(selected.rootId).toBe(one.rootId)
    expect(store.list('desktop')).toHaveLength(2)
  })

  it('refreshes separate store instances before every write and authorization', async () => {
    const { store, file, path, vault, captureIdentity } = await fixture()
    const other = new DataCatalogRootEnrollmentStore(file, () => [device], captureIdentity)
    expect(other.list('desktop')).toEqual([])
    const first = await store.enrollPickedDirectory(vault, 'obsidian-vault')
    store.setDeviceAccess(first.rootId, [device])
    expect(other.list(`device:${device}`)).toHaveLength(1)
    const secondPath = join(path, 'Another root')
    await mkdir(secondPath)
    await other.enrollPickedDirectory(secondPath, 'folder-workspace')
    expect(store.list('desktop')).toHaveLength(2)
    other.revoke(first.rootId)
    expect(await store.resolveAuthorizedRoot(`device:${device}`, first.rootId)).toBeNull()
    expect(store.list('desktop')).toHaveLength(1)
  })

  it("refuses contended writer locks without discarding someone else's lock", async () => {
    const { store, file, vault } = await fixture()
    const root = await store.enrollPickedDirectory(vault, 'obsidian-vault')
    const lock = `${file}.lock`
    await writeFile(lock, 'another writer')
    expect(() => store.revoke(root.rootId)).toThrow('busy')
    expect(() => store.setDeviceAccess(root.rootId, [device])).toThrow('busy')
    await expect(store.enrollPickedDirectory(vault, 'obsidian-vault')).rejects.toThrow('busy')
    expect(await readFile(lock, 'utf8')).toBe('another writer')
    expect(store.list('desktop')).toHaveLength(1)
  })

  it('refuses duplicate persisted root identities without choosing an ambiguous grant', async () => {
    const { store, file, vault } = await fixture()
    await store.enrollPickedDirectory(vault, 'obsidian-vault')
    const stored = JSON.parse(await readFile(file, 'utf8'))
    stored.roots.push({ ...stored.roots[0], allowedDeviceIds: [device] })
    await writeFile(file, JSON.stringify(stored))
    const reopened = new DataCatalogRootEnrollmentStore(file, () => [device])
    expect(() => reopened.list('desktop')).toThrow('unavailable')
    await expect(
      reopened.resolveAuthorizedRoot(`device:${device}`, stored.roots[0].id)
    ).rejects.toThrow()
  })
})
