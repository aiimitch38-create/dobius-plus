// Every checkout's notes, with files shared between worktrees of one repository
// counted once. Why by content: worktrees on different branches carry
// different plans (WORKSTATION-BUILD/plans is the main build plan), while most
// notes are identical copies of main's.
import { createHash } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { basename } from 'node:path'
import { isEligibleSize } from './fs-walk'
import { openSafe, realRoot } from './safe-path'

export type Checkout = {
  root: string
  /** The repository's shared git folder, or null for a folder outside git. */
  common: string | null
  linked: boolean
}

export type CheckoutFile = { checkout: Checkout; path: string }

export type ContentHasher = (path: string, realRootPath: string) => Promise<string | null>

/**
 * sha256 of a file inside realRootPath, streamed from a handle opened through
 * openSafe, so a link or a swapped parent folder is never read.
 */
export async function streamHash(path: string, realRootPath: string): Promise<string | null> {
  const handle = await openSafe(path, realRootPath)
  if (!handle) {
    return null
  }
  const hash = createHash('sha256')
  try {
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      hash.update(chunk as Buffer)
    }
    return hash.digest('hex')
  } catch {
    return null
  } finally {
    await handle.close()
  }
}

async function sizeOf(path: string): Promise<number | null> {
  try {
    const info = await lstat(path)
    return info.isFile() ? info.size : null
  } catch {
    return null
  }
}

/** Main checkout first, then worktrees by path, so the kept copy is stable. */
function checkoutOrder(a: Checkout, b: Checkout): number {
  if (a.linked !== b.linked) {
    return a.linked ? 1 : -1
  }
  return a.root.localeCompare(b.root)
}

/**
 * Drops a file whose content matches one already kept from another checkout
 * of the same repository. Only files whose size collides with a file in a
 * sibling checkout are read, so a pass stays cheap.
 */
export async function dedupeAcrossCheckouts(
  files: CheckoutFile[],
  contentHash: ContentHasher = streamHash
): Promise<CheckoutFile[]> {
  const roots = new Map<string, Promise<string | null>>()
  const rootOf = (root: string): Promise<string | null> => {
    let real = roots.get(root)
    if (!real) {
      real = realRoot(root)
      roots.set(root, real)
    }
    return real
  }
  const byRepo = new Map<string, CheckoutFile[]>()
  const kept: CheckoutFile[] = []
  for (const file of files) {
    if (!file.checkout.common) {
      kept.push(file)
      continue
    }
    const group = byRepo.get(file.checkout.common) ?? []
    group.push(file)
    byRepo.set(file.checkout.common, group)
  }
  for (const group of byRepo.values()) {
    group.sort((a, b) => checkoutOrder(a.checkout, b.checkout) || a.path.localeCompare(b.path))
    // Why the size check first: a file the library will not index is never hashed.
    const sizes = (await Promise.all(group.map((file) => sizeOf(file.path)))).map((size) =>
      size !== null && isEligibleSize(size) ? size : null
    )
    const rootsBySize = new Map<number, Set<string>>()
    sizes.forEach((size, index) => {
      if (size !== null) {
        const roots = rootsBySize.get(size) ?? new Set<string>()
        roots.add(group[index].checkout.root)
        rootsBySize.set(size, roots)
      }
    })
    const seen = new Map<string, string>()
    for (const [index, file] of group.entries()) {
      const size = sizes[index]
      if (size === null) {
        continue
      }
      if ((rootsBySize.get(size)?.size ?? 0) < 2) {
        kept.push(file)
        continue
      }
      const base = await rootOf(file.checkout.root)
      const hash = base ? await contentHash(file.path, base) : null
      if (!hash) {
        continue
      }
      const owner = seen.get(hash)
      if (owner !== undefined && owner !== file.checkout.root) {
        continue
      }
      seen.set(hash, file.checkout.root)
      kept.push(file)
    }
  }
  return kept
}

/** The worktree folder name to show with a file, when its repository has several checkouts. */
export function checkoutLabels(files: CheckoutFile[]): Map<string, string> {
  const rootsByRepo = new Map<string, Set<string>>()
  for (const { checkout } of files) {
    if (checkout.common) {
      const roots = rootsByRepo.get(checkout.common) ?? new Set<string>()
      roots.add(checkout.root)
      rootsByRepo.set(checkout.common, roots)
    }
  }
  const labels = new Map<string, string>()
  for (const { checkout, path } of files) {
    if (checkout.common && (rootsByRepo.get(checkout.common)?.size ?? 0) > 1) {
      labels.set(path, basename(checkout.root))
    }
  }
  return labels
}
