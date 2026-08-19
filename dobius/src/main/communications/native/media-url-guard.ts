// Shared guard for the media-native commands that fetch a URL server-side
// (clipboard-write.ts, native-download.ts). The original Rust commands
// validated the scheme before letting bytes leave the client; this is the
// same guard so a `file:`/`data:` URL can't be used to read local disk
// contents through the download/clipboard path.

export function assertFetchableUrl(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Invalid URL')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only http(s) URLs are allowed')
  }
}
