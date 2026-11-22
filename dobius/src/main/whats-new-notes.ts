import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app } from 'electron'
import { WHATS_NEW_MAX_BYTES, isWhatsNewVersion, parseWhatsNewNotes } from '../shared/whats-new'

const NOTES_RELATIVE_DIR = join('resources', 'whats-new')

/** Where the bundled notes live for this build. */
export function resolveWhatsNewNotesDir(): string {
  const candidates = [
    join(app.getAppPath(), NOTES_RELATIVE_DIR),
    // Why: test copies launch out/main/index.js, so app.getAppPath() can point
    // at out/main while the notes still sit at the project root.
    resolve(app.getAppPath(), '..', '..', NOTES_RELATIVE_DIR),
    join(process.cwd(), NOTES_RELATIVE_DIR)
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
}

export type WhatsNewNotesRead = {
  notes: Map<string, string[]>
  /** Files that were skipped, each with the reason. */
  bad: string[]
}

/** Every version that has a valid notes file. Bad files are skipped and named. */
export function readAllWhatsNewNotes(dir: string): WhatsNewNotesRead {
  const notes = new Map<string, string[]>()
  const bad: string[] = []
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch (error) {
    bad.push(`folder: ${describeError(error)}`)
    return { notes, bad }
  }
  for (const name of names) {
    const match = /^(.+)\.md$/.exec(name)
    if (!match || !isWhatsNewVersion(match[1])) {
      continue
    }
    let text: string
    try {
      const file = join(dir, name)
      if (statSync(file).size > WHATS_NEW_MAX_BYTES) {
        bad.push(`${name}: too large`)
        continue
      }
      text = readFileSync(file, 'utf8')
    } catch (error) {
      bad.push(`${name}: ${describeError(error)}`)
      continue
    }
    const parsed = parseWhatsNewNotes(text)
    if (parsed.ok) {
      notes.set(match[1], parsed.bullets)
    } else {
      bad.push(`${name}: ${parsed.error}`)
    }
  }
  return { notes, bad }
}

function describeError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return code ?? (error instanceof Error ? error.message : String(error))
}
