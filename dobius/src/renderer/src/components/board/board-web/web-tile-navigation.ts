import {
  normalizeBrowserNavigationUrl,
  type SearchEngine,
  type SearchUrlOptions
} from '../../../../../shared/browser-url'

/** Address-bar text may be a search; persisted and redirected URLs stay literal. */
export function webTileAddressUrl(
  input: string,
  engine: SearchEngine | null,
  options: SearchUrlOptions = {}
): string | null {
  if (!input.trim()) {
    return null
  }
  // Why: the shared normalizer enables word/query search only when given an
  // engine. Without it, typing "google" creates the unresolvable https://google/.
  return normalizeBrowserNavigationUrl(input, engine, options)
}
