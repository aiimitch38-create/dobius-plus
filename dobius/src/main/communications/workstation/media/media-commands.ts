import { dialog } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import {
  ensureMediaServerStarted,
  isImageMimeType,
  readBlobBytesByUrl,
  storeBlob,
  type BlobDescriptor
} from './blob-store'

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024

async function readAndStore(filePath: string): Promise<BlobDescriptor> {
  const stats = await stat(filePath)
  if (stats.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File is too large to upload (${stats.size} bytes, limit is ${MAX_UPLOAD_BYTES})`)
  }
  const bytes = await readFile(filePath)
  const { basename } = await import('node:path')
  return storeBlob(bytes, basename(filePath))
}

/** Opens a native single-file picker constrained to images. Null if the user cancels. */
export async function pickAndUploadImage(): Promise<BlobDescriptor | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
  })
  if (result.canceled || result.filePaths.length === 0) {return null}
  const descriptor = await readAndStore(result.filePaths[0] as string)
  if (!isImageMimeType(descriptor.type)) {
    throw new Error(`Selected file is not an image (detected ${descriptor.type})`)
  }
  return descriptor
}

/** Opens a native multi-file picker for any media type. Empty array if the user cancels. */
export async function pickAndUploadMedia(): Promise<BlobDescriptor[]> {
  const result = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] })
  if (result.canceled || result.filePaths.length === 0) {return []}
  return Promise.all(result.filePaths.map((filePath) => readAndStore(filePath)))
}

/** Uploads a file already on disk at `filePath`. `isTemp` is accepted for API parity; this store is content-addressed either way. */
export async function uploadMedia(filePath: string, _isTemp: boolean): Promise<BlobDescriptor> {
  return readAndStore(filePath)
}

/** Uploads raw bytes handed over the RPC boundary (renderer clipboard/drag-drop paths). */
export async function uploadMediaBytes(data: number[], filename?: string): Promise<BlobDescriptor> {
  if (data.length > MAX_UPLOAD_BYTES) {
    throw new Error(`Payload is too large to upload (${data.length} bytes, limit is ${MAX_UPLOAD_BYTES})`)
  }
  return storeBlob(Buffer.from(data), filename)
}

/**
 * Reads back blob bytes for a URL previously returned by one of the upload
 * commands above. Returns a plain number array (not a Buffer/ArrayBuffer) —
 * see this feature's report (SWITCH_CASES) for why: this RPC boundary is
 * JSON, and `uploadMediaBytes` above already establishes that convention for
 * binary payloads crossing it in the other direction.
 */
export async function fetchMediaBytes(url: string): Promise<number[]> {
  const bytes = await readBlobBytesByUrl(url)
  return Array.from(bytes)
}

/** The local media server's listening port (starts it on first use). */
export async function getMediaProxyPort(): Promise<number> {
  return ensureMediaServerStarted()
}
