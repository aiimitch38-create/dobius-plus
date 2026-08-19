// Communications commands: download_file, download_image
//
// Real Electron APIs: dialog.showSaveDialog for the native save picker,
// fetch (Node/Electron main-process global) for the bytes, fs.writeFile to
// persist them. The dialog runs before the fetch so cancelling never spends
// the network round trip.

import { assertFetchableUrl } from './media-url-guard'

// Why: matches the order of magnitude of the original Rust command's size
// cap for downloads — large enough for real attachments, small enough that
// a malicious/huge response can't fill the disk silently.
export const DOWNLOAD_MAX_BYTES = 200 * 1024 * 1024

export type SaveDialogResult = { canceled: boolean; filePath?: string }

export type NativeDownloadDeps = {
  fetchBytes: (url: string) => Promise<Buffer>
  showSaveDialog: (defaultFilename: string) => Promise<SaveDialogResult>
  writeFile: (filePath: string, data: Buffer) => Promise<void>
}

export type DownloadFileParams = { url: string; filename: string }
export type DownloadResult = { downloaded: boolean; filePath?: string }

export async function downloadFile(
  params: DownloadFileParams,
  deps: NativeDownloadDeps
): Promise<DownloadResult> {
  assertFetchableUrl(params.url)

  const dialogResult = await deps.showSaveDialog(params.filename)
  if (dialogResult.canceled || !dialogResult.filePath) {
    return { downloaded: false }
  }

  const buffer = await deps.fetchBytes(params.url)
  if (buffer.byteLength > DOWNLOAD_MAX_BYTES) {
    throw new Error('File is too large to download')
  }

  await deps.writeFile(dialogResult.filePath, buffer)
  return { downloaded: true, filePath: dialogResult.filePath }
}

export type DownloadImageParams = { url: string }

export function downloadImage(
  params: DownloadImageParams,
  deps: NativeDownloadDeps
): Promise<DownloadResult> {
  return downloadFile({ url: params.url, filename: filenameFromUrl(params.url) }, deps)
}

// Why: pure and exported so the URL -> suggested-filename mapping is directly
// testable without a save dialog fake.
export function filenameFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const last = parsed.pathname.split('/').filter(Boolean).pop()
    return last && last.length > 0 ? decodeURIComponent(last) : 'image'
  } catch {
    return 'image'
  }
}
