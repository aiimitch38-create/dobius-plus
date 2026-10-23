import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  advanceMetadataScan,
  closeMetadataScan,
  defaultMetadataFileSystem,
  RaceSafetyUnavailableError,
  startMetadataScan,
  type MetadataDirectoryHandle,
  type MetadataEntryStat,
  type MetadataFileSystem
} from './metadata-scanner'
import { CatalogScanLimitsSchema, type RegisteredCatalogRoot } from './types'

type Node = MetadataEntryStat & { children: Map<string, Node>; content?: string }
type Handle = MetadataDirectoryHandle & { node: Node; index: number; closed: boolean }
const directories: string[] = []

async function fixtureRoot(): Promise<RegisteredCatalogRoot> {
  const path = await mkdtemp(join(tmpdir(), 'dobius-catalog-scan-'))
  directories.push(path)
  const info = await stat(path, { bigint: true })
  return {
    id: 'fixture-root',
    kind: 'obsidian-vault',
    label: 'Fixture vault',
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
    generation: 'fixture-generation',
    browseGranted: true
  }
}

function memoryFileSystem(root: RegisteredCatalogRoot) {
  const rootNode: Node = {
    kind: 'directory',
    identity: root.identity,
    size: 0,
    modifiedAtMs: 1,
    children: new Map()
  }
  let nextInode = 100
  let openOverride: ((relative: string, node: Node) => Node) | undefined
  let afterOpen: ((relative: string, node: Node) => void) | undefined
  let rootValid = true
  let closedHandles = 0
  const handle = (node: Node): Handle => ({
    node,
    identity: node.identity,
    index: 0,
    closed: false,
    async read() {
      const name = [...node.children.keys()][this.index++]
      return name === undefined ? null : { name }
    },
    async close() {
      if (!this.closed) {
        closedHandles += 1
      }
      this.closed = true
    }
  })
  const fileSystem: MetadataFileSystem = {
    supportsRaceSafeDirectoryHandles: true,
    async captureRootIdentity() {
      return root.identity
    },
    async openRoot() {
      return handle(rootNode)
    },
    async verifyRoot(registered, opened) {
      return rootValid && registered.identity.ino === opened.identity.ino
    },
    async lstatChild(parent, name) {
      const node = (parent as Handle).node.children.get(name)
      if (!node) {
        throw new Error('ENOENT')
      }
      return node
    },
    async openChildDirectory(parent, name) {
      const node = (parent as Handle).node.children.get(name)
      if (!node || node.kind !== 'directory') {
        throw new Error('ENOTDIR')
      }
      const relative = name
      const opened = openOverride?.(relative, node) ?? node
      const result = handle(opened)
      afterOpen?.(relative, node)
      return result
    },
    async verifyChild(parent, name, expected) {
      const node = (parent as Handle).node.children.get(name)
      return Boolean(
        node && node.identity.dev === expected.dev && node.identity.ino === expected.ino
      )
    }
  }
  const add = (parent: Node, name: string, kind: Node['kind'], size = 0, content = ''): Node => {
    const node: Node = {
      kind,
      identity: { dev: root.identity.dev, ino: String(nextInode++) },
      size,
      modifiedAtMs: 2,
      children: new Map(),
      content
    }
    parent.children.set(name, node)
    return node
  }
  return {
    fileSystem,
    rootNode,
    add,
    setOpenOverride: (callback: typeof openOverride) => (openOverride = callback),
    setAfterOpen: (callback: typeof afterOpen) => (afterOpen = callback),
    invalidateRoot: () => (rootValid = false),
    get closedHandles() {
      return closedHandles
    }
  }
}

function limits(input: Record<string, number> = {}) {
  return CatalogScanLimitsSchema.parse({
    pageSize: 200,
    maxEntries: 500,
    maxOperationsPerPage: 1000,
    maxDepth: 16,
    maxFrontier: 32,
    maxResponseBytes: 256 * 1024,
    maxElapsedMs: 1000,
    sessionTtlMs: 10_000,
    maxSessions: 8,
    ...input
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('read-only metadata scanner', () => {
  it('refuses path-only scans without a descriptor-relative adapter', async () => {
    const root = await fixtureRoot()
    await expect(startMetadataScan(root, defaultMetadataFileSystem)).rejects.toBeInstanceOf(
      RaceSafetyUnavailableError
    )
  })

  it('uses stable NFC identities and preserves literal POSIX backslash components', async () => {
    const root = await fixtureRoot()
    const fixture = memoryFileSystem(root)
    const one = fixture.add(fixture.rootNode, 'one', 'directory')
    const two = fixture.add(fixture.rootNode, 'two', 'directory')
    fixture.add(one, 'same.md', 'file', 10, 'private original')
    fixture.add(two, 'same.md', 'file', 20, 'private original')
    fixture.add(fixture.rootNode, 'cafe\u0301.md', 'file', 30, 'private original')
    const dir = fixture.add(fixture.rootNode, 'dir', 'directory')
    fixture.add(fixture.rootNode, 'dir\\file.md', 'file', 40, 'private original')
    fixture.add(dir, 'file.md', 'file', 50, 'private original')
    const scan = await startMetadataScan(root, fixture.fileSystem)
    const page = await advanceMetadataScan(
      root,
      scan,
      limits(),
      () => 100,
      undefined,
      fixture.fileSystem
    )
    expect(page).toMatchObject({ done: true, reason: null })
    expect(page.entries.map(({ relativePath }) => relativePath).sort()).toEqual(
      [
        'one',
        'one/same.md',
        'two',
        'two/same.md',
        'cafe\u0301.md',
        'dir',
        'dir\\file.md',
        'dir/file.md'
      ].sort()
    )
    expect(page.entries.find(({ name }) => name === 'cafe\u0301.md')?.relativePath).toBe(
      'cafe\u0301.md'
    )
    expect(page.entries.find(({ name }) => name === 'cafe\u0301.md')?.name).toBe('cafe\u0301.md')
    expect(new Set(page.entries.map(({ entryId }) => entryId)).size).toBe(8)
    expect(page.entries.every((entry) => entry.contentDigestSha256 === null)).toBe(true)
    expect(page.entries.every((entry) => entry.backupCoverage === 'unknown')).toBe(true)
    expect(JSON.stringify(page)).not.toContain('private original')
  })

  it('returns explicit NFC ambiguity without choosing a physical entry', async () => {
    for (const names of [
      ['café.md', 'cafe\u0301.md'],
      ['cafe\u0301.md', 'café.md'],
      ['Case.md', 'case.md'],
      ['case.md', 'Case.md'],
      ['Å.md', 'å.md'],
      ['å.md', 'Å.md']
    ]) {
      const root = await fixtureRoot()
      const fixture = memoryFileSystem(root)
      names.forEach((name, index) => fixture.add(fixture.rootNode, name, 'file', index))
      const scan = await startMetadataScan(root, fixture.fileSystem)
      const page = await advanceMetadataScan(
        root,
        scan,
        limits(),
        () => 100,
        undefined,
        fixture.fileSystem
      )
      expect(page).toMatchObject({ reason: 'ambiguous_path', entries: [], done: true })
    }

    const root = await fixtureRoot()
    const fixture = memoryFileSystem(root)
    fixture.add(fixture.rootNode, 'café.md', 'file', 1)
    fixture.add(fixture.rootNode, 'cafe\u0301.md', 'file', 2)
    const scan = await startMetadataScan(root, fixture.fileSystem)
    const firstPage = await advanceMetadataScan(
      root,
      scan,
      limits({ pageSize: 1 }),
      () => 100,
      undefined,
      fixture.fileSystem
    )
    expect(firstPage).toMatchObject({ reason: 'ambiguous_path', entries: [], done: true })
  })

  it('rejects an outside opened handle and a child replaced after open', async () => {
    const root = await fixtureRoot()
    const outsideFixture = memoryFileSystem(root)
    const outside: Node = {
      kind: 'directory',
      identity: { dev: root.identity.dev, ino: '9001' },
      size: 0,
      modifiedAtMs: 1,
      children: new Map()
    }
    outside.children.set('secret.md', {
      kind: 'file',
      identity: { dev: root.identity.dev, ino: '9002' },
      size: 1,
      modifiedAtMs: 1,
      children: new Map(),
      content: 'outside bytes'
    })
    const nested = outsideFixture.add(outsideFixture.rootNode, 'nested', 'directory')
    outsideFixture.setOpenOverride((name, node) => (name === 'nested' ? outside : node))
    const outsideScan = await startMetadataScan(root, outsideFixture.fileSystem)
    const outsidePage = await advanceMetadataScan(
      root,
      outsideScan,
      limits(),
      () => 100,
      undefined,
      outsideFixture.fileSystem
    )
    expect(outsidePage.reason).toBe('root_changed')
    expect(outsidePage.entries.some(({ relativePath }) => relativePath.includes('secret'))).toBe(
      false
    )
    expect(nested.identity.ino).not.toBe(outside.identity.ino)

    const replacementFixture = memoryFileSystem(root)
    const child = replacementFixture.add(replacementFixture.rootNode, 'child', 'directory')
    replacementFixture.add(child, 'old.md', 'file', 1)
    replacementFixture.setAfterOpen((name, node) => {
      if (name === 'child') {
        const replacement = replacementFixture.add(
          replacementFixture.rootNode,
          'temporary',
          'directory'
        )
        replacementFixture.rootNode.children.delete('temporary')
        replacementFixture.rootNode.children.set('child', replacement)
        node.children.clear()
      }
    })
    const replacementScan = await startMetadataScan(root, replacementFixture.fileSystem)
    const replacementPage = await advanceMetadataScan(
      root,
      replacementScan,
      limits(),
      () => 100,
      undefined,
      replacementFixture.fileSystem
    )
    expect(replacementPage.reason).toBe('root_changed')
    expect(
      replacementPage.entries.some(({ relativePath }) => relativePath === 'child/old.md')
    ).toBe(false)
  })

  it('skips special entries and enforces entry, depth, frontier, operation, byte and cancel bounds', async () => {
    const root = await fixtureRoot()
    const fixture = memoryFileSystem(root)
    fixture.add(fixture.rootNode, 'link', 'symlink')
    fixture.add(fixture.rootNode, 'pipe', 'fifo')
    fixture.add(fixture.rootNode, 'socket', 'special')
    const deep = fixture.add(fixture.rootNode, 'deep', 'directory')
    fixture.add(deep, 'deeper', 'directory')
    const wide = fixture.add(fixture.rootNode, 'wide', 'directory')
    fixture.add(wide, 'a.md', 'file', 200)
    fixture.add(wide, 'b.md', 'file', 200)
    const scan = await startMetadataScan(root, fixture.fileSystem)
    const depth = await advanceMetadataScan(
      root,
      scan,
      limits({ maxDepth: 1 }),
      () => 100,
      undefined,
      fixture.fileSystem
    )
    expect(depth.reason).toBe('scan_limit')

    const frontierScan = await startMetadataScan(root, fixture.fileSystem)
    const frontier = await advanceMetadataScan(
      root,
      frontierScan,
      limits({ maxFrontier: 1 }),
      () => 100,
      undefined,
      fixture.fileSystem
    )
    expect(frontier.reason).toBe('scan_limit')

    const entryScan = await startMetadataScan(root, fixture.fileSystem)
    const entry = await advanceMetadataScan(
      root,
      entryScan,
      limits({ maxEntries: 2 }),
      () => 100,
      undefined,
      fixture.fileSystem
    )
    expect(entry.reason).toBe('scan_limit')

    const byteScan = await startMetadataScan(root, fixture.fileSystem)
    const bytes = await advanceMetadataScan(
      root,
      byteScan,
      limits({ maxResponseBytes: 1024 }),
      () => 100,
      undefined,
      fixture.fileSystem
    )
    expect(bytes.entries.length).toBeLessThanOrEqual(4)

    const operationScan = await startMetadataScan(root, fixture.fileSystem)
    const operations = await advanceMetadataScan(
      root,
      operationScan,
      limits({ maxOperationsPerPage: 1 }),
      () => 100,
      undefined,
      fixture.fileSystem
    )
    expect(operations).toMatchObject({ done: true, reason: 'scan_limit' })

    const cancelScan = await startMetadataScan(root, fixture.fileSystem)
    const controller = new AbortController()
    controller.abort()
    await expect(
      advanceMetadataScan(
        root,
        cancelScan,
        limits(),
        () => 100,
        controller.signal,
        fixture.fileSystem
      )
    ).resolves.toMatchObject({
      reason: 'cancelled',
      done: true
    })
    expect(cancelScan.frames).toHaveLength(0)
  })

  it('bounds stalled child I/O and closes late handles', async () => {
    const root = await fixtureRoot()
    const fixture = memoryFileSystem(root)
    const gate = deferred<void>()
    const originalOpen = fixture.fileSystem.openRoot
    const delayed: MetadataFileSystem = {
      ...fixture.fileSystem,
      async openRoot(value) {
        await gate.promise
        return originalOpen(value)
      }
    }
    const startedAt = Date.now()
    await expect(
      startMetadataScan(root, delayed, { operationTimeoutMs: 20 })
    ).rejects.toMatchObject({
      reason: 'timeout'
    })
    expect(Date.now() - startedAt).toBeLessThan(500)
    gate.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fixture.closedHandles).toBe(1)

    const blocked = memoryFileSystem(root)
    blocked.add(blocked.rootNode, 'a.md', 'file')
    const scan = await startMetadataScan(root, blocked.fileSystem)
    const neverStat: MetadataFileSystem = {
      ...blocked.fileSystem,
      async lstatChild() {
        return new Promise<MetadataEntryStat>(() => undefined)
      }
    }
    const pageStarted = Date.now()
    const page = await advanceMetadataScan(
      root,
      scan,
      limits({ maxElapsedMs: 20 }),
      () => 100,
      undefined,
      neverStat
    )
    expect(Date.now() - pageStarted).toBeLessThan(500)
    expect(page.reason).toBe('scan_limit')
    expect(scan.closed).toBe(true)
    expect(blocked.closedHandles).toBe(1)

    const childFixture = memoryFileSystem(root)
    childFixture.add(childFixture.rootNode, 'nested', 'directory')
    const childGate = deferred<void>()
    const openChild = childFixture.fileSystem.openChildDirectory
    const delayedChild: MetadataFileSystem = {
      ...childFixture.fileSystem,
      async openChildDirectory(parent, name) {
        await childGate.promise
        return openChild(parent, name)
      }
    }
    const childScan = await startMetadataScan(root, delayedChild)
    const childPage = await advanceMetadataScan(
      root,
      childScan,
      limits({ maxElapsedMs: 20 }),
      () => 100,
      undefined,
      delayedChild
    )
    expect(childPage.reason).toBe('scan_limit')
    expect(childFixture.closedHandles).toBe(1)
    childGate.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(childFixture.closedHandles).toBe(2)

    const stuckClose = memoryFileSystem(root)
    const unclosed: MetadataFileSystem = {
      ...stuckClose.fileSystem,
      async openRoot() {
        return {
          identity: root.identity,
          async read() {
            return null
          },
          async close() {
            return new Promise<void>(() => undefined)
          }
        }
      }
    }
    const closeScan = await startMetadataScan(root, unclosed)
    const closeStartedAt = Date.now()
    await closeMetadataScan(closeScan)
    expect(Date.now() - closeStartedAt).toBeLessThan(500)
  })
})
