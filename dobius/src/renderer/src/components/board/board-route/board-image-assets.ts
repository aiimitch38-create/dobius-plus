import { useEffect, useState } from 'react'

// Why: image bytes live in IndexedDB (inside the app's userData, shared by every
// window), never in the persisted boardsByWorktree blob, which is rewritten and
// rebroadcast on every pan/zoom. Cards store only a short `board-asset:<id>`.
const ASSET_PREFIX = 'board-asset:'
const DB_NAME = 'dobius-board-assets'
const STORE = 'images'
// Another window may have just added a card this window hasn't seen yet.
const PRUNE_GRACE_MS = 24 * 60 * 60 * 1000

type StoredImage = { blob: Blob; savedAt: number }

export function isBoardAssetSrc(src: string): boolean {
  return src.startsWith(ASSET_PREFIX)
}

export function boardAssetSrc(id: string): string {
  return `${ASSET_PREFIX}${id}`
}

export function boardAssetId(src: string): string | null {
  return isBoardAssetSrc(src) ? src.slice(ASSET_PREFIX.length) || null : null
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

export async function saveBoardImage(blob: Blob): Promise<string> {
  const id = crypto.randomUUID()
  const record: StoredImage = { blob, savedAt: Date.now() }
  await withStore('readwrite', (store) => store.put(record, id))
  return boardAssetSrc(id)
}

/** Deletes stored images no card references any more; run once boards are hydrated. */
export async function pruneBoardImages(referencedSrcs: ReadonlySet<string>): Promise<void> {
  const cutoff = Date.now() - PRUNE_GRACE_MS
  const db = await openDb()
  try {
    // One readwrite cursor pass: delete unreferenced records past the grace period.
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const request = tx.objectStore(STORE).openCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) {
          return
        }
        const record = cursor.value as StoredImage | undefined
        if (
          !referencedSrcs.has(boardAssetSrc(String(cursor.key))) &&
          record &&
          record.savedAt < cutoff
        ) {
          cursor.delete()
        }
        cursor.continue()
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

/**
 * Resolves a card `src` for an <img>: data:/http(s) pass through; `board-asset:`
 * becomes an object URL for the stored blob (revoked on change/unmount).
 */
export function useBoardImageSrc(src: string): string | null {
  const id = boardAssetId(src)
  const [url, setUrl] = useState<string | null>(id ? null : src)

  useEffect(() => {
    if (!id) {
      setUrl(src)
      return
    }
    let objectUrl: string | null = null
    let cancelled = false
    withStore<StoredImage | undefined>('readonly', (store) => store.get(id))
      .then((record) => {
        if (cancelled || !record) {
          return
        }
        objectUrl = URL.createObjectURL(record.blob)
        setUrl(objectUrl)
      })
      .catch((error: unknown) => console.warn('Board image could not be loaded:', error))
    return () => {
      cancelled = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [id, src])

  return url
}
