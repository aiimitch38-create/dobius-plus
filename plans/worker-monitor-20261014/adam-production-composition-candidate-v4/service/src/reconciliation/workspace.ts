import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ProjectManifest, ProjectRegistry } from '../projects/registry.js'
import {
  reconciliationFinding,
  reconciliationSection,
  type ReconciliationFinding,
  type ReconciliationSection
} from './inventory.js'

export type WorkspaceReconciliationInventory = {
  authority: ReconciliationSection
  projects: ReconciliationSection
  worktrees: ReconciliationSection
}

type GitObservation = {
  path: string
  branch: string | null
  revision: string
  dirty: boolean
}

type ParsedWorktree = {
  path: string
  branch: string | null
  revision: string
}

const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx'])

export function inventoryRegistryWorkspace(registry: ProjectRegistry): WorkspaceReconciliationInventory {
  const projectFindings: ReconciliationFinding[] = []
  const worktreeFindings: ReconciliationFinding[] = []

  for (const project of registry.projects) {
    const observations = new Map<string, GitObservation>()
    for (const location of project.locations) {
      const observation = inspectProjectLocation(project, location, projectFindings)
      if (observation) observations.set(normalizePath(observation.path), observation)
    }
    inspectProjectWorktrees(project, observations, worktreeFindings)
  }

  return {
    authority: reconciliationSection(inspectAuthority(registry)),
    projects: reconciliationSection(projectFindings),
    worktrees: reconciliationSection(worktreeFindings)
  }
}

function inspectProjectLocation(
  project: ProjectManifest,
  location: ProjectManifest['locations'][number],
  findings: ReconciliationFinding[]
): GitObservation | null {
  const id = `${project.id}:${location.path}`
  if (location.role === 'missing') {
    findings.push(reconciliationFinding(id, 'declared_missing', 'registry explicitly records this project location as unresolved'))
    return null
  }
  if (!existsSync(location.path)) {
    findings.push(reconciliationFinding(id, 'missing', 'registered filesystem location does not exist'))
    return null
  }
  const observation = observeGitPath(location.path)
  if (!observation) {
    findings.push(reconciliationFinding(id, 'not_git', 'registered filesystem location is not a Git worktree'))
    return null
  }
  const issues: string[] = []
  if (normalizePath(observation.path) !== normalizePath(location.path)) issues.push(`Git root resolves to ${observation.path}`)
  if (location.branch && location.branch !== observation.branch) issues.push(`branch changed from ${location.branch} to ${observation.branch ?? 'detached'}`)
  if (location.revision && location.revision !== observation.revision) issues.push(`revision changed from ${location.revision} to ${observation.revision}`)
  if (observation.dirty) issues.push('worktree has uncommitted changes')
  const classification = issues.length ? 'drifted' : location.verified ? 'verified_clean' : 'observed_unverified'
  findings.push(reconciliationFinding(id, classification, issues.join('; ') || 'registered location matches its recorded branch and revision'))
  return observation
}

function inspectProjectWorktrees(
  project: ProjectManifest,
  observations: Map<string, GitObservation>,
  findings: ReconciliationFinding[]
): void {
  const canonical = project.locations.find((location) => location.role === 'canonical')
  if (!canonical || !existsSync(canonical.path) || !observeGitPath(canonical.path)) return
  const registeredPaths = new Set(project.locations.filter((location) => location.role !== 'missing').map((location) => normalizePath(location.path)))
  const observed = parseWorktreeList(runGit(canonical.path, ['worktree', 'list', '--porcelain']))
  const observedPaths = new Set(observed.map((worktree) => normalizePath(worktree.path)))

  for (const worktree of observed) {
    const normalizedPath = normalizePath(worktree.path)
    const cached = observations.get(normalizedPath) ?? observeGitPath(worktree.path)
    const registered = registeredPaths.has(normalizedPath)
    const classification = registered
      ? cached?.dirty ? 'registered_dirty' : 'registered_clean'
      : cached?.dirty ? 'unregistered_dirty' : 'unregistered_clean'
    findings.push(reconciliationFinding(
      `${project.id}:${worktree.path}`,
      classification,
      `${worktree.branch ?? 'detached'} at ${worktree.revision}${registered ? ' is registered' : ' is not in the canonical registry'}`
    ))
  }

  for (const location of project.locations.filter((item) => item.role === 'worktree')) {
    if (!observedPaths.has(normalizePath(location.path))) {
      findings.push(reconciliationFinding(`${project.id}:${location.path}`, 'registered_not_attached', 'registered worktree is not attached to the canonical Git repository'))
    }
  }
}

function inspectAuthority(registry: ProjectRegistry): ReconciliationFinding[] {
  const { dobiusPlus, adam } = registry.authority
  const findings = [
    pathFinding('dobius-checkout', dobiusPlus.canonicalCheckout),
    pathFinding('dobius-source', dobiusPlus.sourcePath),
    pathFinding('dobius-compiled-output', dobiusPlus.compiledOutputPath),
    pathFinding('dobius-packaged-output', dobiusPlus.packagedOutputPath),
    pathFinding('dobius-installed-app', dobiusPlus.installedAppPath),
    buildFinding('dobius-runtime', dobiusPlus.sourcePath, dobiusPlus.runtimeEntryPath),
    pathFinding('adam-checkout', adam.canonicalCheckout),
    pathFinding('adam-source', adam.sourcePath),
    pathFinding('adam-dist', adam.distPath),
    buildFinding('adam-runtime', adam.sourcePath, adam.runtimeEntryPath)
  ]
  return findings
}

function pathFinding(id: string, path: string): ReconciliationFinding {
  return existsSync(path)
    ? reconciliationFinding(id, 'present', path)
    : reconciliationFinding(id, 'missing', path)
}

function buildFinding(id: string, sourcePath: string, runtimePath: string): ReconciliationFinding {
  if (!existsSync(runtimePath)) return reconciliationFinding(id, 'runtime_missing', runtimePath)
  const newestSource = newestSourceMtime(sourcePath)
  const runtimeMtime = statSync(runtimePath).mtimeMs
  if (newestSource > runtimeMtime) {
    return reconciliationFinding(id, 'source_newer_than_runtime', `source is newer than ${runtimePath}`)
  }
  return reconciliationFinding(id, 'runtime_current', runtimePath)
}

function newestSourceMtime(path: string): number {
  if (!existsSync(path)) return 0
  let newest = 0
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name)
    if (entry.isDirectory()) newest = Math.max(newest, newestSourceMtime(child))
    else if (entry.isFile() && SOURCE_EXTENSIONS.has(extension(entry.name))) newest = Math.max(newest, statSync(child).mtimeMs)
  }
  return newest
}

function extension(path: string): string {
  const index = path.lastIndexOf('.')
  return index === -1 ? '' : path.slice(index)
}

function observeGitPath(path: string): GitObservation | null {
  try {
    const root = runGit(path, ['rev-parse', '--show-toplevel'])
    return {
      path: root,
      branch: runGit(path, ['branch', '--show-current']) || null,
      revision: runGit(path, ['rev-parse', 'HEAD']),
      dirty: runGit(path, ['status', '--porcelain']).length > 0
    }
  } catch {
    return null
  }
}

function parseWorktreeList(output: string): ParsedWorktree[] {
  if (!output) return []
  return output.trim().split(/\n\n+/).flatMap((block) => {
    const values = new Map(block.split('\n').map((line) => {
      const separator = line.indexOf(' ')
      return separator === -1 ? [line, ''] : [line.slice(0, separator), line.slice(separator + 1)]
    }))
    const path = values.get('worktree')
    const revision = values.get('HEAD')
    if (!path || !revision) return []
    const branchRef = values.get('branch')
    return [{ path, revision, branch: branchRef?.replace(/^refs\/heads\//, '') ?? null }]
  })
}

function runGit(path: string, args: string[]): string {
  return execFileSync('git', ['-C', path, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

function normalizePath(path: string): string {
  try {
    return realpathSync(path).toLocaleLowerCase()
  } catch {
    return resolve(path).toLocaleLowerCase()
  }
}
