// Every checkout's notes, with files shared between worktrees of one repository
// counted once. Why by content: worktrees on different branches carry
// different plans (WORKSTATION-BUILD/plans is the main build plan), while most
// notes are identical copies of main's.
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat } from 'node:fs/promises'
import { basename } from 'node:path'
import { isEligibleSize } from './fs-walk'

export type Checkout = {
  root: string
  /** The repository's shared git folder, or null for a folder outside git. */
  common: string | null
  linked: boolean
}

export type CheckoutFile = { checkout: Checkout; path: string }

export type ContentHasher = (path: string) => Promise<string | null>

/** sha256 of a file, streamed so a large file is never held in memory. */
export function streamHash(path: string): Promise<string | null> {
  return new Promise((resolve) => {
    const hash = createHash('sha256')
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', () => resolve(null))
  })
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
      const hash = await contentHash(file.path)
      const owner = hash ? seen.get(hash) : undefined
      if (owner !== undefined && owner !== file.checkout.root) {
        continue
      }
      if (hash) {
        seen.set(hash, file.checkout.root)
      }
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
