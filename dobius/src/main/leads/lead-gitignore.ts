// `lead init` writes committed project files under .dobius/. Many repos ignore
// that whole folder, which would silently drop them from the repo.
import { execFile } from 'node:child_process'
import { join } from 'node:path'

export const LEAD_COMMITTED_FILES = ['.dobius/ORCHESTRATOR.md', '.dobius/lead.json'] as const

/**
 * The lead files git would ignore in `repoPath`. Empty when none are ignored,
 * when the path is not a git repository, or when git is unavailable: this is
 * advisory, so it never fails the caller.
 */
export function findGitIgnoredLeadFiles(repoPath: string): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['check-ignore', '--', ...LEAD_COMMITTED_FILES],
      { cwd: repoPath, timeout: 10_000 },
      (_error, stdout) => {
        // Why: exit 1 = nothing ignored, 128 = not a repo; stdout is authoritative either way.
        const text = typeof stdout === 'string' ? stdout : String(stdout ?? '')
        resolve(
          text
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
        )
      }
    )
  })
}

export function gitIgnoreWarning(repoPath: string, ignored: readonly string[]): string {
  return (
    `git ignores ${ignored.join(' and ')} in ${repoPath}; the lead needs them committed. ` +
    `In ${join(repoPath, '.gitignore')}, replace the .dobius rule with \`.dobius/*\` followed by ` +
    '`!.dobius/ORCHESTRATOR.md` and `!.dobius/lead.json`.'
  )
}
