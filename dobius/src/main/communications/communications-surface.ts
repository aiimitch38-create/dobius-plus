import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

function normalizedUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

/**
 * Trust rule for the native Communications surface: it runs in the MAIN
 * window, so its sender URL is the app's own renderer (dev origin with any
 * SPA path, or the packaged renderer directory on file:).
 */
export function isTrustedCommunicationsSurfaceUrl(
  sourceUrl: string,
  options: { rendererUrl?: string; mainBundleDirectory?: string } = {}
): boolean {
  const candidate = normalizedUrl(sourceUrl)
  if (!candidate) {
    return false
  }

  const rendererUrl = options.rendererUrl ?? process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    const renderer = normalizedUrl(rendererUrl)
    return renderer !== null && candidate.origin === renderer.origin
  }

  const mainBundleDirectory = options.mainBundleDirectory ?? __dirname
  const rendererDirectory = pathToFileURL(join(mainBundleDirectory, '../renderer')).pathname
  return candidate.protocol === 'file:' && candidate.pathname.startsWith(rendererDirectory)
}

