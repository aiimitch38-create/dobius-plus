// Builds the RawProjectRepoSnapshot / RawProjectRepoDiff shapes the vendored
// Buzz client expects (see vendor/buzz-desktop/src/shared/api/projectGit.ts
// fromRawProjectRepoSnapshot / getProjectRepoDiff — this file's output is fed
// to those functions unmodified, so field names are snake_case on purpose).
import { assertNotFlagLike, runGit } from './git-exec'

const FIELD_SEP = '\x1f'
const RECORD_SEP = '\x1e'
const LOG_FIELDS = ['%H', '%h', '%an', '%ae', '%at', '%s']
const DEFAULT_COMMIT_LIMIT = 200
const MAX_DIFF_FILE_CHARS = 200_000
const MAX_DIFF_FILES = 500

export type RawCommit = {
  hash: string
  short_hash: string
  author_name: string
  author_email: string
  timestamp: number
  subject: string
}

export type RawFile = {
  path: string
  kind: string
  size: number | null
  preview_content: string | null
  last_changed_at: number | null
  latest_commit: RawCommit | null
}

export type RawContributor = {
  name: string
  email: string
  commit_count: number
  last_commit_at: number
}

export type RawSnapshot = {
  latest_commit: RawCommit | null
  commits: RawCommit[]
  files: RawFile[]
  contributors: RawContributor[]
}

export type RawDiffFile = {
  path: string
  additions: number
  deletions: number
  patch: string
  truncated: boolean
}

export type RawDiff = {
  files: RawDiffFile[]
  additions: number
  deletions: number
  commit_body: string | null
}

function parseLog(stdout: string): RawCommit[] {
  return stdout
    .split(RECORD_SEP)
    .map((record) => record.replace(/^\n/, '').trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const [hash, shortHash, authorName, authorEmail, timestamp, subject] = record.split(FIELD_SEP)
      return {
        hash: hash ?? '',
        short_hash: shortHash ?? '',
        author_name: authorName ?? '',
        author_email: authorEmail ?? '',
        timestamp: Number.parseInt(timestamp ?? '0', 10) || 0,
        subject: subject ?? ''
      }
    })
}

/** Fetches up to `limit` commits reachable from `ref`, newest first. Empty array for an unborn HEAD. */
export async function readCommitLog(
  cwd: string,
  ref: string,
  limit = DEFAULT_COMMIT_LIMIT
): Promise<RawCommit[]> {
  try {
    // Why: NOT `-- ref` — for `git log`, a `--` marker switches everything
    // after it into pathspec mode, so `ref` would be matched against file
    // paths instead of resolved as a revision (silently returning an empty
    // log for any ref that isn't also a literal path in the repo).
    // assertNotFlagLike is the argv-smuggling guard instead.
    const { stdout } = await runGit(
      ['log', `--format=${LOG_FIELDS.join(FIELD_SEP)}${RECORD_SEP}`, '-n', String(limit), assertNotFlagLike(ref, 'ref')],
      cwd
    )
    return parseLog(stdout)
  } catch {
    // No commits yet (unborn HEAD) or ref doesn't resolve — an empty log is a
    // real, honest answer for a freshly-initialized repository.
    return []
  }
}

function aggregateContributors(commits: readonly RawCommit[]): RawContributor[] {
  const byEmail = new Map<string, RawContributor>()
  for (const commit of commits) {
    const key = commit.author_email || commit.author_name
    const existing = byEmail.get(key)
    if (existing) {
      existing.commit_count += 1
      if (commit.timestamp > existing.last_commit_at) {existing.last_commit_at = commit.timestamp}
    } else {
      byEmail.set(key, {
        name: commit.author_name,
        email: commit.author_email,
        commit_count: 1,
        last_commit_at: commit.timestamp
      })
    }
  }
  return [...byEmail.values()].sort((a, b) => b.commit_count - a.commit_count)
}

async function readFileTree(cwd: string, ref: string): Promise<RawFile[]> {
  try {
    // Why: same pathspec-mode pitfall as readCommitLog above — no `--`.
    const { stdout } = await runGit(['ls-tree', '-r', '-l', '--full-tree', assertNotFlagLike(ref, 'ref')], cwd)
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        // "<mode> <type> <hash> <size>\t<path>"
        const [meta, path] = line.split('\t')
        const parts = (meta ?? '').split(/\s+/)
        const type = parts[1] ?? 'blob'
        const size = Number.parseInt(parts[3] ?? '', 10)
        return {
          path: path ?? '',
          kind: type === 'commit' ? 'submodule' : 'file',
          // Why: ls-tree reports "-" for gitlinks (submodules); only a real
          // numeric size is trustworthy, everything else is honestly unknown.
          size: Number.isFinite(size) ? size : null,
          preview_content: null,
          last_changed_at: null,
          latest_commit: null
        }
      })
      .filter((file) => file.path.length > 0)
  } catch {
    return []
  }
}

/**
 * Builds a repo snapshot (commit log + file tree + contributor rollup) for
 * `ref` inside a checkout at `cwd`. Contributor stats are computed from the
 * same commit window as `commits` (bounded by `commitLimit`) rather than the
 * full history — real data, just scoped to what was actually fetched.
 */
export async function buildRepoSnapshot(
  cwd: string,
  ref: string,
  commitLimit = DEFAULT_COMMIT_LIMIT
): Promise<RawSnapshot> {
  const [commits, files] = await Promise.all([readCommitLog(cwd, ref, commitLimit), readFileTree(cwd, ref)])
  return {
    latest_commit: commits[0] ?? null,
    commits,
    files,
    contributors: aggregateContributors(commits)
  }
}

type NumstatEntry = { path: string; additions: number; deletions: number }

function parseNumstat(stdout: string): NumstatEntry[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [additions, deletions, path] = line.split('\t')
      return {
        path: path ?? '',
        // Why: numstat prints "-" for binary files — not a numeric count.
        additions: additions === '-' ? 0 : Number.parseInt(additions ?? '0', 10) || 0,
        deletions: deletions === '-' ? 0 : Number.parseInt(deletions ?? '0', 10) || 0
      }
    })
    .filter((entry) => entry.path.length > 0)
}

function splitPatchByFile(fullPatch: string): Map<string, string> {
  const byFile = new Map<string, string>()
  const chunks = fullPatch.split(/\n(?=diff --git )/)
  for (const chunk of chunks) {
    const match = /^diff --git a\/(.+?) b\/(.+?)\n/.exec(chunk)
    if (!match) {continue}
    const path = match[2] ?? match[1]
    if (path) {byFile.set(path, chunk)}
  }
  return byFile
}

/** Builds a two-ref diff (`base..target`) with per-file patches, bounded so one huge file can't blow out the response. */
export async function buildRepoDiff(
  cwd: string,
  baseRef: string,
  targetRef: string,
  commitBodyRef: string | null
): Promise<RawDiff> {
  const range = `${baseRef}...${targetRef}`
  const [numstatResult, patchResult, bodyResult] = await Promise.all([
    runGit(['diff', '--numstat', range], cwd).catch(() => ({ stdout: '', stderr: '' })),
    runGit(['diff', '--no-color', range], cwd).catch(() => ({ stdout: '', stderr: '' })),
    commitBodyRef
      ? runGit(['log', '-1', '--format=%B', assertNotFlagLike(commitBodyRef, 'commitBodyRef')], cwd).catch(() => ({
          stdout: '',
          stderr: ''
        }))
      : Promise.resolve(null)
  ])

  const entries = parseNumstat(numstatResult.stdout).slice(0, MAX_DIFF_FILES)
  const patchesByFile = splitPatchByFile(patchResult.stdout)

  const files: RawDiffFile[] = entries.map((entry) => {
    const rawPatch = patchesByFile.get(entry.path) ?? ''
    const truncated = rawPatch.length > MAX_DIFF_FILE_CHARS
    return {
      path: entry.path,
      additions: entry.additions,
      deletions: entry.deletions,
      patch: truncated ? rawPatch.slice(0, MAX_DIFF_FILE_CHARS) : rawPatch,
      truncated
    }
  })

  return {
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    commit_body: bodyResult ? bodyResult.stdout.trim() || null : null
  }
}
