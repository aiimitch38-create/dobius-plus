// Communications commands: copy_text_to_clipboard, copy_image_to_clipboard
//
// Real Electron APIs: clipboard.writeText / clipboard.write({text, html}) for
// text, and clipboard.writeImage(nativeImage) for images. The image variant
// fetches the source URL server-side (main process) first, the same shape as
// the original Rust command, then hands the bytes to `nativeImage`.

import { assertFetchableUrl } from './media-url-guard'

// Why: matches the cap this codebase already applies to inbound clipboard
// images (CLIPBOARD_IMAGE_MAX_BASE64_CHARS in shared/clipboard-image.ts is
// ~10 MB of base64, i.e. ~7.3 MB of raw bytes); outbound copies from a
// remote URL use a slightly looser raw-byte cap since there's no base64
// inflation to budget for.
export const CLIPBOARD_IMAGE_MAX_BYTES = 10 * 1024 * 1024

export type ClipboardImageHandle = unknown

export type ClipboardWriteDeps = {
  writeText: (text: string) => void
  writeTextAndHtml: (payload: { text: string; html: string }) => void
  createImageFromBuffer: (buffer: Buffer) => ClipboardImageHandle
  writeImage: (image: ClipboardImageHandle) => void
  fetchBytes: (url: string) => Promise<Buffer>
}

export type CopyTextToClipboardParams = { text: string; html?: string }

export function copyTextToClipboard(
  params: CopyTextToClipboardParams,
  deps: Pick<ClipboardWriteDeps, 'writeText' | 'writeTextAndHtml'>
): { copied: true } {
  if (params.html) {
    deps.writeTextAndHtml({ text: params.text, html: params.html })
  } else {
    deps.writeText(params.text)
  }
  return { copied: true }
}

export type CopyImageToClipboardParams = { url: string }

export async function copyImageToClipboard(
  params: CopyImageToClipboardParams,
  deps: Pick<ClipboardWriteDeps, 'createImageFromBuffer' | 'writeImage' | 'fetchBytes'>
): Promise<{ copied: true }> {
  assertFetchableUrl(params.url)
  const buffer = await deps.fetchBytes(params.url)
  if (buffer.byteLength > CLIPBOARD_IMAGE_MAX_BYTES) {
    throw new Error('Image is too large to copy to the clipboard')
  }
  const image = deps.createImageFromBuffer(buffer)
  deps.writeImage(image)
  return { copied: true }
}
