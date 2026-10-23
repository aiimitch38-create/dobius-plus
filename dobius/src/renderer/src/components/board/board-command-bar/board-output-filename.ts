// Why: "Save to outputs/" needs a deterministic, collision-resistant filename
// (timestamp + slug) a pure function can build and a test can pin exactly,
// independent of the runtime-file write path that actually lands the bytes.
const SLUG_PUNCTUATION_PATTERN = /[^a-z0-9]+/g

export function slugifyOutputTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(SLUG_PUNCTUATION_PATTERN, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'output'
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** `YYYY-MM-DD_HHMMSS`, in local time, matching the timestamp convention used elsewhere on the Board. */
export function formatOutputTimestamp(at: Date): string {
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
  const time = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
  return `${date}_${time}`
}

/** Relative path under the worktree, e.g. `outputs/2026-10-23_143012-code-review.md`. */
export function boardOutputRelativePath(consoleTitle: string, at: Date): string {
  return `outputs/${formatOutputTimestamp(at)}-${slugifyOutputTitle(consoleTitle)}.md`
}
