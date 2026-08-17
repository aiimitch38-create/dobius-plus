import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const BUZZ_ENTRY_PATH = '/buzz/index.html'

function normalizedUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

export function isTrustedCommunicationsGuestUrl(
  sourceUrl: string,
  options: { rendererUrl?: string; mainBundleDirectory?: string } = {}
): boolean {
  const candidate = normalizedUrl(sourceUrl)
  if (!candidate || candidate.searchParams.get('embed') !== 'dobius') {
    return false
  }

  const rendererUrl = options.rendererUrl ?? process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    const renderer = normalizedUrl(rendererUrl)
    return (
      renderer !== null &&
      candidate.origin === renderer.origin &&
      candidate.pathname === BUZZ_ENTRY_PATH
    )
  }

  const mainBundleDirectory = options.mainBundleDirectory ?? __dirname
  const expected = pathToFileURL(join(mainBundleDirectory, '../renderer/buzz/index.html'))
  return candidate.protocol === 'file:' && candidate.pathname === expected.pathname
}

