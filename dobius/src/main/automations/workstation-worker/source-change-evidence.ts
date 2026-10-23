import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const MAX_SOURCE_DIFF_BYTES = 8 * 1024 * 1024

export function collectSourceChangeEvidence(worktreePath: string) {
  const status = execFileSync(
    'git',
    ['-C', worktreePath, 'status', '--porcelain=v1', '--untracked-files=all'],
    { encoding: 'buffer', maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
  )
  if (status.length === 0) {
    return ['source_changes:none']
  }
  const diff = execFileSync('git', ['-C', worktreePath, 'diff', '--binary', 'HEAD', '--'], {
    encoding: 'buffer',
    maxBuffer: MAX_SOURCE_DIFF_BYTES,
    stdio: ['ignore', 'pipe', 'ignore']
  })
  const untrackedPaths = execFileSync(
    'git',
    ['-C', worktreePath, 'ls-files', '--others', '--exclude-standard', '-z'],
    { encoding: 'buffer', maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
  )
  const digest = createHash('sha256')
    .update(status)
    .update('\0')
    .update(diff)
    .update('\0')
    .update(untrackedPaths)
    .digest('hex')
  return [`source_changes_sha256:${digest}`, `source_changes_tracked_diff_bytes:${diff.length}`]
}
