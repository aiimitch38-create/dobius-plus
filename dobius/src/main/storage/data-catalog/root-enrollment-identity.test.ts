import { mkdir, mkdtemp, realpath, rm, lstat, stat, readFile, writeFile } from 'node:fs/promises'
import type * as FsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DataCatalogRootEnrollmentStore } from './root-enrollment-store'
import type { CatalogRootIdentity } from './types'

vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof FsPromises>()
  return { ...fs, stat: vi.fn(fs.stat), lstat: vi.fn(fs.lstat) }
})
const paths: string[] = []
afterEach(async () => {
  vi.mocked(stat).mockClear()
  vi.mocked(lstat).mockClear()
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'dobius-root-identity-')))
  paths.push(base)
  const vault = join(base, 'vault')
  await mkdir(vault)
  const actual = await vi.importActual<typeof FsPromises>('node:fs/promises')
  const info = await actual.stat(vault, { bigint: true })
  const largeIdentity = (inode: bigint, birthtimeNs = info.birthtimeNs) =>
    Object.assign(Object.create(Object.getPrototypeOf(info)), info, {
      dev: 9007199254740995n,
      ino: inode,
      birthtimeNs
    }) as typeof info
  const nativeIdentity = (
    info: { dev: bigint; ino: bigint; birthtimeNs: bigint },
    token = '1'
  ): CatalogRootIdentity => ({
    dev: String(info.dev),
    ino: String(info.ino),
    birthtimeNs: String(info.birthtimeNs),
    incarnation: { provider: 'linux-inode-generation-v1', scope: '1122334455667788', token }
  })
  // An explicit injected native provider models full-width metadata; production never derives it from time.
  const capture = vi.fn(async () => nativeIdentity(await actual.stat(vault, { bigint: true })))
  return {
    vault,
    capture,
    nativeIdentity,
    file: join(base, 'registry.json'),
    largeIdentity,
    store: new DataCatalogRootEnrollmentStore(
      join(base, 'registry.json'),
      () => ['d6ea53cb-c589-459d-ad93-06b3cfc2479b'],
      capture
    )
  }
}

it('preserves exact full-width identity when registering a root for the descriptor bridge', async () => {
  const f = await fixture()
  const info = f.largeIdentity(9007199254740993n)
  f.capture.mockResolvedValue(f.nativeIdentity(info))
  vi.mocked(lstat).mockResolvedValueOnce(info).mockResolvedValueOnce(info)
  vi.mocked(stat).mockResolvedValueOnce(info)
  const view = await f.store.enrollPickedDirectory(f.vault, 'obsidian-vault')
  expect(vi.mocked(stat)).toHaveBeenCalledWith(f.vault, { bigint: true })
  expect(vi.mocked(lstat)).toHaveBeenNthCalledWith(1, f.vault, { bigint: true })
  expect(vi.mocked(lstat)).toHaveBeenNthCalledWith(2, f.vault, { bigint: true })
  expect(await f.store.resolveAuthorizedRoot('desktop', view.rootId)).toMatchObject({
    identity: { dev: '9007199254740995', ino: '9007199254740993' }
  })
})

it('refuses replacement between two large inode values that Number would collapse', async () => {
  const f = await fixture()
  const before = f.largeIdentity(9007199254740993n)
  const after = f.largeIdentity(9007199254740992n)
  f.capture.mockResolvedValue(f.nativeIdentity(before))
  vi.mocked(lstat).mockResolvedValueOnce(before).mockResolvedValueOnce(after)
  vi.mocked(stat).mockResolvedValueOnce(before)
  await expect(f.store.enrollPickedDirectory(f.vault, 'obsidian-vault')).rejects.toThrow()
  expect(f.store.list('desktop')).toEqual([])
})

it('drops device grants when both inode and birth time are reused with a different native token', async () => {
  const f = await fixture()
  const device = 'd6ea53cb-c589-459d-ad93-06b3cfc2479b'
  const first = f.largeIdentity(9007199254740993n, 1000000001n)
  f.capture.mockResolvedValue(f.nativeIdentity(first, '7'))
  vi.mocked(lstat).mockResolvedValueOnce(first).mockResolvedValueOnce(first)
  vi.mocked(stat).mockResolvedValueOnce(first)
  const before = await f.store.enrollPickedDirectory(f.vault, 'obsidian-vault')
  f.store.setDeviceAccess(before.rootId, [device])
  const second = f.largeIdentity(9007199254740993n, 1000000001n)
  f.capture.mockResolvedValue(f.nativeIdentity(second, '8'))
  vi.mocked(lstat).mockResolvedValueOnce(second).mockResolvedValueOnce(second)
  vi.mocked(stat).mockResolvedValueOnce(second)
  const after = await f.store.enrollPickedDirectory(f.vault, 'obsidian-vault')
  expect(after.rootId).toBe(before.rootId)
  expect(after.generation).not.toBe(before.generation)
  expect(after.allowedDeviceIds).toEqual([])
  expect(f.store.list(`device:${device}`)).toEqual([])
  expect(await f.store.resolveAuthorizedRoot('desktop', after.rootId)).toMatchObject({
    identity: { birthtimeNs: '1000000001', incarnation: { token: '8' } }
  })
})

it('refuses enrollment when the native incarnation provider is unavailable', async () => {
  const f = await fixture()
  const unavailable = f.largeIdentity(9007199254740993n, 0n)
  f.capture.mockRejectedValue(new Error('Native incarnation unavailable'))
  vi.mocked(lstat).mockResolvedValueOnce(unavailable).mockResolvedValueOnce(unavailable)
  vi.mocked(stat).mockResolvedValueOnce(unavailable)
  await expect(f.store.enrollPickedDirectory(f.vault, 'obsidian-vault')).rejects.toThrow()
  expect(f.store.list('desktop')).toEqual([])
})

it('retains legacy registrations for local recovery while refusing their old phone grants', async () => {
  const f = await fixture()
  const device = 'd6ea53cb-c589-459d-ad93-06b3cfc2479b'
  const enrolled = await f.store.enrollPickedDirectory(f.vault, 'obsidian-vault')
  f.store.setDeviceAccess(enrolled.rootId, [device])
  const legacy = JSON.parse(await readFile(f.file, 'utf8')) as {
    roots: { identity: { incarnation?: CatalogRootIdentity['incarnation'] } }[]
  }
  delete legacy.roots[0]!.identity.incarnation
  await writeFile(f.file, JSON.stringify(legacy))
  expect(f.store.list('desktop')).toHaveLength(1)
  expect(f.store.list('desktop')[0]?.allowedDeviceIds).toEqual([])
  expect(f.store.list(`device:${device}`)).toEqual([])
  expect(await f.store.resolveAuthorizedRoot('desktop', enrolled.rootId)).toBeNull()
  expect(() => f.store.setDeviceAccess(enrolled.rootId, [device])).toThrow('again')
  const repaired = await f.store.enrollPickedDirectory(f.vault, 'obsidian-vault')
  expect(repaired.rootId).toBe(enrolled.rootId)
  expect(repaired.allowedDeviceIds).toEqual([])
  expect(await f.store.resolveAuthorizedRoot('desktop', enrolled.rootId)).not.toBeNull()
})

it('refuses a native provider result for a different opened inode', async () => {
  const f = await fixture()
  const before = f.largeIdentity(9007199254740993n)
  f.capture.mockResolvedValue(f.nativeIdentity(f.largeIdentity(9007199254740992n)))
  vi.mocked(lstat).mockResolvedValueOnce(before).mockResolvedValueOnce(before)
  vi.mocked(stat).mockResolvedValueOnce(before)
  await expect(f.store.enrollPickedDirectory(f.vault, 'obsidian-vault')).rejects.toThrow('changed')
  expect(f.store.list('desktop')).toEqual([])
})

it('refuses a changed native token between capture and the selected-path recheck', async () => {
  const f = await fixture()
  const before = f.largeIdentity(9007199254740993n)
  f.capture
    .mockResolvedValueOnce(f.nativeIdentity(before, '7'))
    .mockResolvedValueOnce(f.nativeIdentity(before, '8'))
  vi.mocked(lstat).mockResolvedValueOnce(before).mockResolvedValueOnce(before)
  vi.mocked(stat).mockResolvedValueOnce(before)
  await expect(f.store.enrollPickedDirectory(f.vault, 'obsidian-vault')).rejects.toThrow('changed')
  expect(f.store.list('desktop')).toEqual([])
})

it('cancels an in-flight native proof without persisting late enrollment', async () => {
  const f = await fixture()
  let resolve!: (value: CatalogRootIdentity) => void
  const entered = new Promise<void>((ready) => {
    f.capture.mockImplementation(() => {
      ready()
      return new Promise((done) => {
        resolve = done
      })
    })
  })
  const abort = new AbortController()
  const pending = f.store.enrollPickedDirectory(f.vault, 'obsidian-vault', abort.signal)
  const rejected = expect(pending).rejects.toThrow('cancelled')
  await entered
  abort.abort()
  await rejected
  resolve(f.nativeIdentity(f.largeIdentity(9007199254740993n)))
  await new Promise((done) => setTimeout(done, 0))
  expect(f.store.list('desktop')).toEqual([])
})
