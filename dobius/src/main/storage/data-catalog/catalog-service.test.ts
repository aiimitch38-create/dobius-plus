import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ReadOnlyDataCatalogService } from './catalog-service'
import { CatalogEntrySchema, CatalogResultSchema } from './types'
import type {
  MetadataDirectoryHandle,
  MetadataEntryStat,
  MetadataFileSystem
} from './metadata-scanner'
import type {
  CatalogFileIdentity,
  RegisteredCatalogRoot,
  RegisteredCatalogRootProvider
} from './types'

const directories: string[] = []

async function fixtureDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'dobius-catalog-service-'))
  directories.push(path)
  return realpath(path)
}

async function makeRoot(
  path: string,
  generation = 'registration-v1'
): Promise<RegisteredCatalogRoot> {
  const info = await stat(path, { bigint: true })
  return {
    id: 'vault-main',
    kind: 'obsidian-vault',
    label: 'Fixture Research Vault',
    canonicalPath: path,
    identity: {
      dev: String(info.dev),
      ino: String(info.ino),
      birthtimeNs: String(info.birthtimeNs),
      incarnation: {
        provider: 'darwin-apfs-file-id-v1',
        scope: '0123456789abcdef0123456789abcdef',
        token: '1'
      }
    },
    generation,
    browseGranted: true
  }
}

function fixtureMetadataFileSystem(
  root: RegisteredCatalogRoot,
  names: string[]
): MetadataFileSystem {
  const nodes = new Map<string, MetadataEntryStat>()
  names.forEach((name, index) =>
    nodes.set(name, {
      kind: 'file',
      identity: { dev: root.identity.dev, ino: String(index + 100) },
      size: 1,
      modifiedAtMs: 1
    })
  )
  let index = 0
  const openFixtureDirectory = (identity: CatalogFileIdentity): MetadataDirectoryHandle => ({
    identity,
    async read() {
      const name = names[index++]
      return name === undefined ? null : { name }
    },
    async close() {}
  })
  return {
    supportsRaceSafeDirectoryHandles: true,
    async captureRootIdentity() {
      return root.identity
    },
    async openRoot() {
      return openFixtureDirectory(root.identity)
    },
    async verifyRoot(_root, handle) {
      return handle.identity.ino === root.identity.ino
    },
    async lstatChild(_parent, name) {
      const entry = nodes.get(name)
      if (!entry) {
        throw new Error('ENOENT')
      }
      return entry
    },
    async openChildDirectory(_parent, name) {
      const entry = nodes.get(name)
      if (!entry || entry.kind !== 'directory') {
        throw new Error('ENOTDIR')
      }
      return openFixtureDirectory(entry.identity)
    },
    async verifyChild(_parent, name, expected) {
      const entry = nodes.get(name)
      return Boolean(
        entry && entry.identity.dev === expected.dev && entry.identity.ino === expected.ino
      )
    }
  }
}

const limits = { pageSize: 1, maxOperationsPerPage: 12, maxElapsedMs: 1000, sessionTtlMs: 100 }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('read-only data catalog service', () => {
  it('exports strict shared DTO validators without backup or content claims', () => {
    const entry = {
      entryId: 'a'.repeat(64),
      rootId: 'vault-main',
      relativePath: 'Research/note.md',
      name: 'note.md',
      kind: 'file',
      sizeBytes: 12,
      modifiedAtMs: null,
      contentDigestSha256: null,
      backupCoverage: 'unknown',
      availability: 'available',
      observedAtMs: Date.UTC(2026, 9, 13)
    }
    expect(CatalogEntrySchema.safeParse(entry).success).toBe(true)
    expect(
      CatalogEntrySchema.safeParse({ ...entry, contentDigestSha256: 'a'.repeat(64) }).success
    ).toBe(false)
    expect(
      CatalogEntrySchema.safeParse({ ...entry, absolutePath: '/private/vault/note.md' }).success
    ).toBe(false)
    expect(
      CatalogResultSchema.safeParse({
        state: 'complete',
        rootId: 'vault-main',
        entries: [entry],
        cursor: null,
        scannedEntries: 1,
        reason: null
      }).success
    ).toBe(true)
  })

  it('denies unknown principals without echoing root input or exposing any path', async () => {
    const path = await fixtureDirectory()
    const root = await makeRoot(path)
    const provider: RegisteredCatalogRootProvider = {
      resolveAuthorizedRoot: async (principal, rootId) =>
        principal === 'allowed' && rootId === root.id ? root : null
    }
    const service = new ReadOnlyDataCatalogService(provider)
    const denied = await service.page('unknown', { rootId: root.id })
    const malformed = await service.page('unknown', { rootId: path })
    expect(denied).toMatchObject({ state: 'denied', rootId: null, entries: [], cursor: null })
    expect(malformed).toMatchObject({ state: 'denied', rootId: null, entries: [] })
    expect(JSON.stringify(denied)).not.toContain(path)
    await service.close()
  })

  it('authorizes and completes an empty selected root with its positive birth identity', async () => {
    const path = await fixtureDirectory()
    const root = await makeRoot(path)
    expect(root.identity.birthtimeNs).toMatch(/^[1-9][0-9]*$/)
    const provider: RegisteredCatalogRootProvider = {
      resolveAuthorizedRoot: async (principal, rootId) =>
        principal === 'window-1' && rootId === root.id ? root : null
    }
    const service = new ReadOnlyDataCatalogService(provider, {
      limits,
      fileSystem: fixtureMetadataFileSystem(root, [])
    })

    await expect(service.page('window-1', { rootId: root.id })).resolves.toMatchObject({
      state: 'complete',
      rootId: root.id,
      entries: [],
      reason: null
    })
    await service.close()
  })

  it('binds opaque single-use cursors to principal and root while returning relative metadata only', async () => {
    const path = await fixtureDirectory()
    await Promise.all([
      writeFile(join(path, 'one.md'), '# one original'),
      writeFile(join(path, 'two.md'), '# two original')
    ])
    const root = await makeRoot(path)
    const provider: RegisteredCatalogRootProvider = {
      resolveAuthorizedRoot: async (principal, rootId) =>
        principal === 'window-1' && rootId === root.id ? root : null
    }
    const service = new ReadOnlyDataCatalogService(provider, {
      limits,
      fileSystem: fixtureMetadataFileSystem(root, ['one.md', 'two.md'])
    })
    const first = await service.page('window-1', { rootId: root.id })
    expect(first.state).toBe('partial')
    expect(first.cursor).toMatch(/^[A-Za-z0-9_-]{40,50}$/)
    expect(first.entries).toHaveLength(1)
    expect(first.entries[0]?.contentDigestSha256).toBeNull()
    expect(first.entries[0]?.backupCoverage).toBe('unknown')
    expect(JSON.stringify(first)).not.toContain(path)
    expect(JSON.stringify(first)).not.toContain('original')

    const rejectedOtherPrincipal = await service.page('window-2', {
      rootId: root.id,
      cursor: first.cursor
    })
    expect(rejectedOtherPrincipal.state).toBe('denied')
    let second = await service.page('window-1', { rootId: root.id, cursor: first.cursor })
    const listed = [...first.entries, ...second.entries]
    while (second.cursor) {
      second = await service.page('window-1', { rootId: root.id, cursor: second.cursor })
      listed.push(...second.entries)
    }
    expect(second.state).toBe('complete')
    expect(listed.filter((entry) => entry.kind === 'file')).toHaveLength(2)
    expect(listed.every((entry) => entry.relativePath && entry.contentDigestSha256 === null)).toBe(
      true
    )
    const replay = await service.page('window-1', { rootId: root.id, cursor: first.cursor })
    expect(replay).toMatchObject({ state: 'unavailable', reason: 'invalid_cursor', entries: [] })
    await service.close()
  })

  it('rechecks permission after asynchronous scan work and discards page data after revocation', async () => {
    const path = await fixtureDirectory()
    await writeFile(join(path, 'private.md'), 'private note bytes')
    const root = await makeRoot(path)
    let calls = 0
    const provider: RegisteredCatalogRootProvider = {
      resolveAuthorizedRoot: async () => {
        calls += 1
        return calls < 3 ? root : null
      }
    }
    const service = new ReadOnlyDataCatalogService(provider, {
      fileSystem: fixtureMetadataFileSystem(root, ['private.md'])
    })
    const result = await service.page('window-1', { rootId: root.id })
    expect(calls).toBe(3)
    expect(result).toMatchObject({
      state: 'denied',
      rootId: null,
      entries: [],
      reason: 'access_denied'
    })
    expect(JSON.stringify(result)).not.toContain(path)
    await service.close()
  })

  it('invalidates continuation when the registered generation or root directory changes', async () => {
    const parent = await fixtureDirectory()
    const path = join(parent, 'vault')
    await mkdir(path)
    await writeFile(join(path, 'a.md'), 'a')
    await writeFile(join(path, 'b.md'), 'b')
    let root = await makeRoot(await realpath(path))
    const provider: RegisteredCatalogRootProvider = {
      resolveAuthorizedRoot: async () => root
    }
    const service = new ReadOnlyDataCatalogService(provider, {
      limits,
      fileSystem: fixtureMetadataFileSystem(root, ['a.md', 'b.md'])
    })
    const first = await service.page('window-1', { rootId: root.id })
    expect(first.cursor).toBeTruthy()
    root = { ...root, generation: 'registration-v2' }
    const second = await service.page('window-1', { rootId: root.id, cursor: first.cursor })
    expect(second).toMatchObject({
      state: 'unavailable',
      rootId: null,
      entries: [],
      reason: 'root_changed'
    })
    await service.close()
  })

  it('expires inactive cursors and closes their open directory handles', async () => {
    const path = await fixtureDirectory()
    await writeFile(join(path, 'a.md'), 'a')
    await writeFile(join(path, 'b.md'), 'b')
    const root = await makeRoot(path)
    let now = 1
    const service = new ReadOnlyDataCatalogService(
      { resolveAuthorizedRoot: async () => root },
      { limits, now: () => now, fileSystem: fixtureMetadataFileSystem(root, ['a.md', 'b.md']) }
    )
    const first = await service.page('window-1', { rootId: root.id })
    expect(first.cursor).toBeTruthy()
    now += 101
    const expired = await service.page('window-1', { rootId: root.id, cursor: first.cursor })
    expect(expired).toMatchObject({ state: 'unavailable', reason: 'expired', entries: [] })
    await service.close()
  })

  it('expires a cursor across suspend when wall time advances but monotonic time pauses', async () => {
    const path = await fixtureDirectory()
    await writeFile(join(path, 'a.md'), 'a')
    await writeFile(join(path, 'b.md'), 'b')
    const root = await makeRoot(path)
    let monotonic = 10
    let wall = 1_000
    const service = new ReadOnlyDataCatalogService(
      { resolveAuthorizedRoot: async () => root },
      {
        limits,
        now: () => monotonic,
        wallClockNow: () => wall,
        fileSystem: fixtureMetadataFileSystem(root, ['a.md', 'b.md'])
      }
    )
    const first = await service.page('window-1', { rootId: root.id })
    expect(first.cursor).toBeTruthy()
    monotonic = 11
    wall += limits.sessionTtlMs + 1
    await expect(
      service.page('window-1', { rootId: root.id, cursor: first.cursor })
    ).resolves.toMatchObject({ state: 'unavailable', reason: 'expired', entries: [] })
    await service.close()
  })

  it('expires a cursor on monotonic elapsed time despite wall-clock rollback', async () => {
    const path = await fixtureDirectory()
    await writeFile(join(path, 'a.md'), 'a')
    await writeFile(join(path, 'b.md'), 'b')
    const root = await makeRoot(path)
    let monotonic = 10
    let wall = 1_000
    const service = new ReadOnlyDataCatalogService(
      { resolveAuthorizedRoot: async () => root },
      {
        limits,
        now: () => monotonic,
        wallClockNow: () => wall,
        fileSystem: fixtureMetadataFileSystem(root, ['a.md', 'b.md'])
      }
    )
    const first = await service.page('window-1', { rootId: root.id })
    expect(first.cursor).toBeTruthy()
    monotonic += limits.sessionTtlMs + 1
    wall = 5
    await expect(
      service.page('window-1', { rootId: root.id, cursor: first.cursor })
    ).resolves.toMatchObject({ state: 'unavailable', reason: 'expired', entries: [] })
    await service.close()
  })

  it('cancels without retaining a resumable session and bounds cursor creation', async () => {
    const path = await fixtureDirectory()
    await Promise.all(
      Array.from({ length: 10 }, (_, index) => writeFile(join(path, `${index}.md`), 'x'))
    )
    const root = await makeRoot(path)
    const service = new ReadOnlyDataCatalogService(
      { resolveAuthorizedRoot: async () => root },
      {
        limits: { ...limits, maxSessions: 1 },
        fileSystem: fixtureMetadataFileSystem(
          root,
          Array.from({ length: 10 }, (_, i) => `${i}.md`)
        )
      }
    )
    const first = await service.page('window-1', { rootId: root.id })
    expect(first.cursor).toBeTruthy()
    const full = await service.page('window-1', { rootId: root.id })
    expect(full).toMatchObject({ state: 'unavailable', reason: 'scan_limit', entries: [] })
    const controller = new AbortController()
    controller.abort()
    const cancelled = await service.page('window-1', {
      rootId: root.id,
      cursor: first.cursor,
      signal: controller.signal
    })
    expect(cancelled).toMatchObject({ state: 'unavailable', reason: 'cancelled', entries: [] })
    await service.close()
  })

  it('reports unsupported filesystem entries as partial and never infers backup or digest status', async () => {
    const path = await fixtureDirectory()
    await writeFile(join(path, 'note.md'), 'authoritative source')
    const root = await makeRoot(path)
    const service = new ReadOnlyDataCatalogService(
      { resolveAuthorizedRoot: async () => root },
      {
        now: () => 10,
        wallClockNow: () => Date.UTC(2026, 9, 13),
        fileSystem: fixtureMetadataFileSystem(root, ['note.md'])
      }
    )
    const result = await service.page('window-1', { rootId: root.id })
    expect(result.entries[0]).toMatchObject({
      relativePath: 'note.md',
      contentDigestSha256: null,
      backupCoverage: 'unknown',
      availability: 'available'
    })
    expect(result.entries[0].observedAtMs).toBe(Date.UTC(2026, 9, 13))
    await service.close()
  })

  it('caps the complete serialized response and rejects unrepresentable response limits', async () => {
    const path = await fixtureDirectory()
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        writeFile(join(path, `${String(index).padStart(2, '0')}-${'n'.repeat(80)}.md`), 'source')
      )
    )
    const root = await makeRoot(path)
    const service = new ReadOnlyDataCatalogService(
      { resolveAuthorizedRoot: async () => root },
      {
        limits: { maxResponseBytes: 1024 },
        fileSystem: fixtureMetadataFileSystem(
          root,
          Array.from(
            { length: 20 },
            (_, index) => `${String(index).padStart(2, '0')}-${'n'.repeat(80)}.md`
          )
        )
      }
    )
    const result = await service.page('window-1', { rootId: root.id })
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(1024)
    expect(result).toMatchObject({ state: 'unavailable', reason: 'response_limit', cursor: null })
    await service.close()

    expect(
      () =>
        new ReadOnlyDataCatalogService(
          { resolveAuthorizedRoot: async () => root },
          {
            limits: { maxResponseBytes: 128 }
          }
        )
    ).toThrow()
  })

  it('consumes a cursor before awaiting authorization so concurrent replay cannot advance it twice', async () => {
    const path = await fixtureDirectory()
    await Promise.all([
      writeFile(join(path, 'a.md'), 'a'),
      writeFile(join(path, 'b.md'), 'b'),
      writeFile(join(path, 'c.md'), 'c')
    ])
    const root = await makeRoot(path)
    const gate = deferred<void>()
    const authorizationStarted = deferred<void>()
    let calls = 0
    const provider: RegisteredCatalogRootProvider = {
      resolveAuthorizedRoot: async () => {
        calls += 1
        if (calls === 4) {
          authorizationStarted.resolve()
          await gate.promise
        }
        return root
      }
    }
    const service = new ReadOnlyDataCatalogService(provider, {
      limits,
      fileSystem: fixtureMetadataFileSystem(root, ['a.md', 'b.md', 'c.md'])
    })
    const first = await service.page('window-1', { rootId: root.id })
    expect(first.cursor).toBeTruthy()
    const continuation = service.page('window-1', { rootId: root.id, cursor: first.cursor })
    await authorizationStarted.promise
    const replay = await service.page('window-1', { rootId: root.id, cursor: first.cursor })
    expect(replay).toMatchObject({ state: 'unavailable', reason: 'invalid_cursor', entries: [] })
    gate.resolve()
    await expect(continuation).resolves.toMatchObject({ state: 'partial' })
    await service.close()
  })

  it('rechecks cursor expiry after awaited continuation authorization', async () => {
    const path = await fixtureDirectory()
    await Promise.all([writeFile(join(path, 'a.md'), 'a'), writeFile(join(path, 'b.md'), 'b')])
    const root = await makeRoot(path)
    const gate = deferred<void>()
    const authorizationStarted = deferred<void>()
    let calls = 0
    let now = 1
    const service = new ReadOnlyDataCatalogService(
      {
        resolveAuthorizedRoot: async () => {
          calls += 1
          if (calls === 4) {
            authorizationStarted.resolve()
            await gate.promise
          }
          return root
        }
      },
      {
        limits,
        now: () => now,
        fileSystem: fixtureMetadataFileSystem(root, ['a.md', 'b.md'])
      }
    )
    const first = await service.page('window-1', { rootId: root.id })
    expect(first.cursor).toBeTruthy()
    const continuation = service.page('window-1', { rootId: root.id, cursor: first.cursor })
    await authorizationStarted.promise
    now = 102
    gate.resolve()
    await expect(continuation).resolves.toMatchObject({
      state: 'unavailable',
      reason: 'expired',
      entries: []
    })
    await expect(
      service.page('window-1', { rootId: root.id, cursor: first.cursor })
    ).resolves.toMatchObject({ reason: 'expired', entries: [] })
    await service.close()
  })

  it('reserves pending scan capacity before registry authorization', async () => {
    const path = await fixtureDirectory()
    await writeFile(join(path, 'a.md'), 'a')
    await writeFile(join(path, 'b.md'), 'b')
    const root = await makeRoot(path)
    const gate = deferred<void>()
    const authorizationStarted = deferred<void>()
    const provider: RegisteredCatalogRootProvider = {
      resolveAuthorizedRoot: async () => {
        authorizationStarted.resolve()
        await gate.promise
        return root
      }
    }
    const service = new ReadOnlyDataCatalogService(provider, {
      limits: { ...limits, maxSessions: 1 },
      fileSystem: fixtureMetadataFileSystem(root, ['a.md', 'b.md'])
    })
    const first = service.page('window-1', { rootId: root.id })
    await authorizationStarted.promise
    const second = await service.page('window-2', { rootId: root.id })
    expect(second).toMatchObject({ state: 'unavailable', reason: 'scan_limit', cursor: null })
    gate.resolve()
    await expect(first).resolves.toMatchObject({ state: 'partial' })
    await service.close()
  })

  it('close aborts pending registry work, drains active pages, and rejects later calls', async () => {
    const path = await fixtureDirectory()
    const root = await makeRoot(path)
    const gate = deferred<void>()
    const authorizationStarted = deferred<void>()
    let calls = 0
    const provider: RegisteredCatalogRootProvider = {
      resolveAuthorizedRoot: async () => {
        calls += 1
        authorizationStarted.resolve()
        await gate.promise
        return root
      }
    }
    const service = new ReadOnlyDataCatalogService(provider, { limits })
    const pending = service.page('window-1', { rootId: root.id })
    await authorizationStarted.promise
    await service.close()
    await expect(pending).resolves.toMatchObject({ state: 'unavailable' })
    gate.resolve()
    await expect(service.page('window-1', { rootId: root.id })).resolves.toMatchObject({
      state: 'unavailable',
      reason: 'cancelled'
    })
    expect(calls).toBe(1)
  })

  it('times out registry waits and releases pending capacity for a later request', async () => {
    const path = await fixtureDirectory()
    await writeFile(join(path, 'later.md'), 'later')
    const root = await makeRoot(path)
    const gate = deferred<void>()
    let calls = 0
    const service = new ReadOnlyDataCatalogService(
      {
        resolveAuthorizedRoot: async () => {
          calls += 1
          if (calls === 1) {
            await gate.promise
          }
          return root
        }
      },
      {
        limits: { ...limits, maxElapsedMs: 1000, maxSessions: 1 },
        fileSystem: fixtureMetadataFileSystem(root, ['later.md'])
      }
    )
    const startedAt = Date.now()
    const timedOut = await service.page('window-1', { rootId: root.id })
    expect(Date.now() - startedAt).toBeLessThan(1500)
    expect(timedOut).toMatchObject({ state: 'unavailable', reason: 'scan_limit' })
    gate.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const retried = await service.page('window-1', { rootId: root.id })
    expect(retried.state).toBe('partial')
    const retriedLastPage = await service.page('window-1', {
      rootId: root.id,
      cursor: retried.cursor
    })
    expect(retriedLastPage.state).toBe('complete')
    await service.close()
  })

  it('refuses the default path-only filesystem adapter instead of claiming race-safe scans', async () => {
    const path = await fixtureDirectory()
    const root = await makeRoot(path)
    const service = new ReadOnlyDataCatalogService({ resolveAuthorizedRoot: async () => root })
    await expect(service.page('window-1', { rootId: root.id })).resolves.toMatchObject({
      state: 'unavailable',
      reason: 'root_unavailable',
      entries: []
    })
    await service.close()
  })
})
