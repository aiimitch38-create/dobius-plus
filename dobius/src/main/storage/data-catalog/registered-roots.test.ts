import { mkdir, mkdtemp, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CatalogRootIdentitySchema,
  CatalogRootIncarnationSchema,
  type CatalogRootIdentity
} from './types'
import { fileIdentity, resolveAuthorizedCatalogRoot, sameRegisteredRoot } from './registered-roots'
import type { RegisteredCatalogRoot, RegisteredCatalogRootProvider } from './types'

const directories: string[] = []

async function fixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dobius-catalog-root-'))
  directories.push(directory)
  return realpath(directory)
}

async function registration(rootPath: string, overrides: Partial<RegisteredCatalogRoot> = {}) {
  const info = await stat(rootPath, { bigint: true })
  return {
    id: 'vault-main',
    kind: 'obsidian-vault',
    label: 'Research vault',
    canonicalPath: rootPath,
    identity: {
      ...fileIdentity(info),
      incarnation: {
        provider: 'darwin-apfs-file-id-v1',
        scope: '0123456789abcdef0123456789abcdef',
        token: '1'
      }
    },
    generation: 'registration-v1',
    browseGranted: true,
    ...overrides
  } satisfies RegisteredCatalogRoot
}

// Synthetic tokens exercise the resolver contract only; native replacement proof belongs to bridge tests.
const readRegisteredIdentity = (identity: CatalogRootIdentity) => async () => identity

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('registered catalog root authority', () => {
  it('validates native root incarnation tokens with canonical bounded values', () => {
    const dev = BigInt(Number.MAX_SAFE_INTEGER) + 123n
    const ino = BigInt(Number.MAX_SAFE_INTEGER) + 456n
    expect(fileIdentity({ dev, ino, birthtimeNs: 0n })).toEqual({
      dev: String(dev),
      ino: String(ino),
      birthtimeNs: '0'
    })
    expect(
      CatalogRootIncarnationSchema.safeParse({
        provider: 'linux-inode-generation-v1',
        scope: '0123456789abcdef',
        token: '4294967295'
      }).success
    ).toBe(true)
    expect(
      CatalogRootIncarnationSchema.safeParse({
        provider: 'linux-inode-generation-v1',
        scope: '0123456789abcdef',
        token: '4294967296'
      }).success
    ).toBe(false)
    expect(
      CatalogRootIncarnationSchema.safeParse({
        provider: 'darwin-apfs-file-id-v1',
        scope: '0123456789abcdef0123456789abcdef',
        token: '18446744073709551615'
      }).success
    ).toBe(true)
    expect(
      CatalogRootIncarnationSchema.safeParse({
        provider: 'darwin-apfs-file-id-v1',
        scope: '0123456789abcdef0123456789abcdef',
        token: '18446744073709551616'
      }).success
    ).toBe(false)
    expect(
      CatalogRootIncarnationSchema.safeParse({
        provider: 'linux-inode-generation-v1',
        scope: '0123456789abcdeF',
        token: '1'
      }).success
    ).toBe(false)
    expect(
      CatalogRootIdentitySchema.safeParse({
        dev: '1',
        ino: '2',
        incarnation: {
          provider: 'darwin-apfs-file-id-v1',
          scope: '0123456789abcdef0123456789abcdef',
          token: '01'
        }
      }).success
    ).toBe(false)
    for (const token of ['abc', '1e3', '', '-1', '01', '1'.repeat(21)]) {
      expect(() =>
        CatalogRootIncarnationSchema.safeParse({
          provider: 'darwin-apfs-file-id-v1',
          scope: '0123456789abcdef0123456789abcdef',
          token
        })
      ).not.toThrow()
      expect(
        CatalogRootIncarnationSchema.safeParse({
          provider: 'darwin-apfs-file-id-v1',
          scope: '0123456789abcdef0123456789abcdef',
          token
        }).success
      ).toBe(false)
    }
  })

  it('resolves only an explicitly browse-authorized registered canonical root', async () => {
    const root = await fixtureDirectory()
    const registered = await registration(root)
    const provider: RegisteredCatalogRootProvider = {
      resolveAuthorizedRoot: vi.fn(async (principalId, rootId) =>
        principalId === 'trusted-window' && rootId === registered.id ? registered : null
      )
    }

    await expect(
      resolveAuthorizedCatalogRoot(
        provider,
        'trusted-window',
        'vault-main',
        undefined,
        1000,
        readRegisteredIdentity(registered.identity)
      )
    ).resolves.toEqual({
      state: 'authorized',
      root: registered
    })
    await expect(
      resolveAuthorizedCatalogRoot(
        provider,
        'other-window',
        'vault-main',
        undefined,
        1000,
        async () => registered.identity
      )
    ).resolves.toEqual({
      state: 'denied'
    })
    await expect(
      resolveAuthorizedCatalogRoot(
        provider,
        'trusted-window',
        '/private/vault',
        undefined,
        1000,
        async () => registered.identity
      )
    ).resolves.toEqual({
      state: 'denied'
    })
    expect(provider.resolveAuthorizedRoot).toHaveBeenCalledTimes(2)
  })

  it('refuses same dev/ino/birth with a different native incarnation token', async () => {
    const rootPath = await fixtureDirectory()
    const registered = await registration(rootPath)
    const provider: RegisteredCatalogRootProvider = {
      resolveAuthorizedRoot: async () => registered
    }
    const replacementIdentity = {
      ...registered.identity,
      incarnation: { ...registered.identity.incarnation, token: '2' }
    }

    await expect(
      resolveAuthorizedCatalogRoot(
        provider,
        'trusted-window',
        'vault-main',
        undefined,
        1000,
        readRegisteredIdentity(replacementIdentity)
      )
    ).resolves.toEqual({
      state: 'changed'
    })
  })

  it('fails closed when trusted registration lacks a native incarnation', async () => {
    const root = await fixtureDirectory()
    const registered = await registration(root)
    const provider: RegisteredCatalogRootProvider = {
      resolveAuthorizedRoot: async () =>
        ({
          ...registered,
          identity: { dev: '', ino: '1', birthtimeNs: '1' }
        }) as RegisteredCatalogRoot
    }

    await expect(
      resolveAuthorizedCatalogRoot(
        provider,
        'trusted-window',
        'vault-main',
        undefined,
        1000,
        async () => registered.identity
      )
    ).resolves.toEqual({ state: 'unavailable' })
  })

  it('bounds a registry provider that never settles', async () => {
    let resolve!: (value: RegisteredCatalogRoot | null) => void
    const provider: RegisteredCatalogRootProvider = {
      resolveAuthorizedRoot: () =>
        new Promise((done) => {
          resolve = done
        })
    }
    const startedAt = Date.now()
    await expect(
      resolveAuthorizedCatalogRoot(
        provider,
        'trusted-window',
        'vault-main',
        undefined,
        20,
        async () => {
          throw new Error('identity reader should not run after provider timeout')
        }
      )
    ).resolves.toEqual({ state: 'unavailable' })
    expect(Date.now() - startedAt).toBeLessThan(500)
    resolve(null)
  })

  it('bounds native root identity capture and refuses an unresolved reader', async () => {
    const root = await fixtureDirectory()
    const registered = await registration(root)
    const provider: RegisteredCatalogRootProvider = {
      resolveAuthorizedRoot: async () => registered
    }
    let resolve!: (value: CatalogRootIdentity) => void
    const reader = () => new Promise<CatalogRootIdentity>((done) => (resolve = done))

    await expect(
      resolveAuthorizedCatalogRoot(provider, 'trusted-window', 'vault-main', undefined, 20, reader)
    ).resolves.toEqual({ state: 'unavailable' })
    resolve(registered.identity)
  })

  it('rejects a root whose registered path is a symlink, even when it targets a directory', async () => {
    const parent = await fixtureDirectory()
    const actual = join(parent, 'actual')
    const link = join(parent, 'linked')
    await mkdir(actual)
    await symlink(actual, link, 'dir')
    const registered = await registration(link)
    const provider: RegisteredCatalogRootProvider = {
      resolveAuthorizedRoot: async () => registered
    }

    await expect(
      resolveAuthorizedCatalogRoot(
        provider,
        'trusted-window',
        'vault-main',
        undefined,
        1000,
        async () => registered.identity
      )
    ).resolves.toEqual({
      state: 'changed'
    })
  })

  it('compares generation and native incarnation, ignoring diagnostic creation time', async () => {
    const root = await fixtureDirectory()
    const first = await registration(root)
    expect(sameRegisteredRoot(first, { ...first })).toBe(true)
    expect(sameRegisteredRoot(first, { ...first, generation: 'registration-v2' })).toBe(false)
    expect(
      sameRegisteredRoot(first, { ...first, identity: { ...first.identity, ino: '999' } })
    ).toBe(false)
    expect(
      sameRegisteredRoot(first, {
        ...first,
        identity: {
          ...first.identity,
          birthtimeNs: '0'
        }
      })
    ).toBe(true)
    expect(
      sameRegisteredRoot(first, {
        ...first,
        identity: {
          ...first.identity,
          incarnation: { ...first.identity.incarnation, token: '2' }
        }
      })
    ).toBe(false)
  })

  it('keeps a stable registered root authorized when an ordinary child is added', async () => {
    const root = await fixtureDirectory()
    const registered = await registration(root)
    const provider: RegisteredCatalogRootProvider = {
      resolveAuthorizedRoot: async () => registered
    }
    await writeFile(join(root, 'new-note.md'), 'new child')

    await expect(
      resolveAuthorizedCatalogRoot(
        provider,
        'trusted-window',
        'vault-main',
        undefined,
        1000,
        readRegisteredIdentity(registered.identity)
      )
    ).resolves.toMatchObject({ state: 'authorized', root: registered })
  })

  it('fails closed when no native root identity reader is available', async () => {
    const root = await fixtureDirectory()
    const registered = await registration(root)
    const provider: RegisteredCatalogRootProvider = {
      resolveAuthorizedRoot: async () => registered
    }

    await expect(
      resolveAuthorizedCatalogRoot(provider, 'trusted-window', 'vault-main')
    ).resolves.toEqual({ state: 'unavailable' })
  })

  it('fails closed when native identity capture returns malformed proof', async () => {
    const root = await fixtureDirectory()
    const registered = await registration(root)
    const provider: RegisteredCatalogRootProvider = {
      resolveAuthorizedRoot: async () => registered
    }
    const malformedReader = async () => ({
      ...registered.identity,
      incarnation: { ...registered.identity.incarnation, token: 'not-a-token' }
    })

    await expect(
      resolveAuthorizedCatalogRoot(
        provider,
        'trusted-window',
        'vault-main',
        undefined,
        1000,
        malformedReader
      )
    ).resolves.toEqual({ state: 'unavailable' })
  })

  it('allows a missing diagnostic birth time when native incarnation matches', async () => {
    const root = await fixtureDirectory()
    const registered = await registration(root, {
      identity: {
        dev: '1',
        ino: '2',
        incarnation: {
          provider: 'darwin-apfs-file-id-v1',
          scope: '0123456789abcdef0123456789abcdef',
          token: '1'
        }
      }
    })
    const current = await stat(root, { bigint: true })
    registered.identity.dev = String(current.dev)
    registered.identity.ino = String(current.ino)
    const provider: RegisteredCatalogRootProvider = {
      resolveAuthorizedRoot: async () => registered
    }

    await expect(
      resolveAuthorizedCatalogRoot(
        provider,
        'trusted-window',
        'vault-main',
        undefined,
        1000,
        readRegisteredIdentity(registered.identity)
      )
    ).resolves.toMatchObject({ state: 'authorized' })
  })
})
