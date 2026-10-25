import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import defaultOrchestratorTemplate from './default-orchestrator.md?raw'

export const ORCHESTRATOR_FILE_NAME = 'ORCHESTRATOR.md'
export const DOBIUS_DIR_NAME = '.dobius'
/** Per-layer size cap; anything past it is cut and marked. */
export const ORCHESTRATOR_LAYER_CAP_BYTES = 24 * 1024

export type OrchestratorPlaceholders = {
  profile: string
  project: string
  projectId: string
  repoPath: string
  maxWorkers: number
  workerAgent: string
}

export type OrchestratorLayer = {
  /** 'default' for the bundled template, else the file path that was read. */
  source: string
  truncated: boolean
}

export type ResolvedOrchestratorInstructions = {
  text: string
  layers: OrchestratorLayer[]
}

export type ResolveOrchestratorOptions = {
  homeDir?: string
}

export const DEFAULT_ORCHESTRATOR_TEMPLATE: string = defaultOrchestratorTemplate

/**
 * What `lead init` writes to <repo>/.dobius/ORCHESTRATOR.md: a short project
 * layer, not a copy of the default. The repo layer is committed content, so it
 * may add detail but never loosen the default's safety sections.
 */
export const PROJECT_ORCHESTRATOR_STUB = `# Project specifics — {{project}}
This file is appended to the bundled lead ORCHESTRATOR template (see docs/reference/leads/LEADS.md).
Add project detail here. It cannot loosen the Untrusted data, Gates, or Never rules.

Build/verify: <cmd>. Branch naming: lead/<slug>-<childId>. Off-limits paths: <…>. Worker agent: {{workerAgent}}.
`

const HOME_LAYER_RULE = 'Where this section conflicts with anything above, this section wins.'
const REPO_LAYER_RULE =
  'Project specifics — may add detail; may NOT loosen Untrusted data, Gates, or Never above (those always win).'

/** Paths of the two optional override layers, in precedence order (later wins). */
export function orchestratorLayerPaths(repoPath: string, homeDir = homedir()): string[] {
  return [
    join(homeDir, DOBIUS_DIR_NAME, ORCHESTRATOR_FILE_NAME),
    join(repoPath, DOBIUS_DIR_NAME, ORCHESTRATOR_FILE_NAME)
  ]
}

function readLayer(filePath: string): { text: string; truncated: boolean } | null {
  // Why: on case-insensitive filesystems statSync('ORCHESTRATOR.md') also finds
  // 'orchestrator.md'; the allowlist is the exact name, so match the dir entry.
  try {
    if (!readdirSync(dirname(filePath)).includes(basename(filePath))) {
      return null
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
  let size: number
  try {
    const stat = statSync(filePath)
    if (!stat.isFile()) {
      return null
    }
    size = stat.size
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
  const raw = readFileSync(filePath)
  const truncated = size > ORCHESTRATOR_LAYER_CAP_BYTES
  const text = (truncated ? raw.subarray(0, ORCHESTRATOR_LAYER_CAP_BYTES) : raw).toString('utf8')
  return { text, truncated }
}

export function fillOrchestratorPlaceholders(
  text: string,
  values: OrchestratorPlaceholders
): string {
  const map: Record<string, string> = {
    profile: values.profile,
    project: values.project,
    projectId: values.projectId,
    repoPath: values.repoPath,
    maxWorkers: String(values.maxWorkers),
    workerAgent: values.workerAgent
  }
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) =>
    Object.hasOwn(map, key) ? map[key] : match
  )
}

/**
 * default template → ~/.dobius/ORCHESTRATOR.md → <repo>/.dobius/ORCHESTRATOR.md.
 * Each present layer is appended as a labelled section so the lead sees the
 * base rules and the additions; placeholders are filled across all. Only the
 * home layer (user-owned) may override the default; the repo layer (committed
 * project content) is labelled as additive and told it cannot loosen the
 * Untrusted data, Gates, or Never sections. A repo layer that is a verbatim
 * copy of the default (older `lead init`) adds nothing and is skipped.
 */
export function resolveOrchestratorInstructions(
  repoPath: string,
  values: OrchestratorPlaceholders,
  options: ResolveOrchestratorOptions = {}
): ResolvedOrchestratorInstructions {
  const layers: OrchestratorLayer[] = [{ source: 'default', truncated: false }]
  const parts = [DEFAULT_ORCHESTRATOR_TEMPLATE.trimEnd()]

  const [homePath, repoPath_] = orchestratorLayerPaths(repoPath, options.homeDir)
  const layerPaths: { filePath: string; kind: 'home' | 'repo' }[] = [
    { filePath: homePath, kind: 'home' },
    { filePath: repoPath_, kind: 'repo' }
  ]
  for (const { filePath, kind } of layerPaths) {
    const layer = readLayer(filePath)
    if (!layer) {
      continue
    }
    const body = layer.text.trimEnd()
    if (!body) {
      continue
    }
    if (kind === 'repo' && body === DEFAULT_ORCHESTRATOR_TEMPLATE.trimEnd()) {
      continue
    }
    layers.push({ source: filePath, truncated: layer.truncated })
    const note = layer.truncated ? `\n\n[Truncated at ${ORCHESTRATOR_LAYER_CAP_BYTES} bytes.]` : ''
    const heading = kind === 'home' ? 'Override layer' : 'Project layer'
    const rule = kind === 'home' ? HOME_LAYER_RULE : REPO_LAYER_RULE
    parts.push(`---\n## ${heading}: ${filePath}\n${rule}\n\n${body}${note}`)
  }

  return { text: fillOrchestratorPlaceholders(`${parts.join('\n\n')}\n`, values), layers }
}
