/**
 * Parses the YAML workflow definitions that back create_workflow /
 * update_workflow (vendor/buzz-desktop/src/shared/api/tauriWorkflows.ts).
 * Buzz's real Rust engine has its own step DSL we have no source for, so
 * this parser is deliberately generic: it accepts any YAML mapping, and
 * additionally recognizes a top-level `steps: [...]` list so
 * workflow-executor.ts has something concrete to run. An unrecognized
 * top-level shape is not an error — `definition: Record<string, unknown>`
 * on the wire type is genuinely open-ended — only `steps` gets structural
 * validation because it is the one field this engine actually executes.
 *
 * Mirrors src/main/warp-themes/parser.ts's safe-parse shape (byte cap +
 * wall-clock cap) since this, too, parses user-authored YAML text.
 */
import { parse as parseYaml } from 'yaml'

export const MAX_WORKFLOW_YAML_BYTES = 256 * 1024
const MAX_PARSE_MS = 1_000
const MAX_ALIAS_COUNT = 100

export type WorkflowStatus = 'active' | 'disabled' | 'archived'

export const WORKFLOW_STATUSES: readonly WorkflowStatus[] = ['active', 'disabled', 'archived']

export function isWorkflowStatus(value: unknown): value is WorkflowStatus {
  return typeof value === 'string' && (WORKFLOW_STATUSES as readonly string[]).includes(value)
}

export type WorkflowStep = {
  id: string
  type: string
  with: Record<string, unknown>
}

export type ParsedWorkflowDefinition = {
  /** The full parsed YAML mapping, returned to the UI as-is (`definition`). */
  raw: Record<string, unknown>
  /** Structurally-validated `steps` list, empty when the YAML has none. */
  steps: WorkflowStep[]
  /** `name` field pulled from the YAML, if present and non-empty. */
  name: string | null
  /** `status` field pulled from the YAML, only when it's a recognized value. */
  status: WorkflowStatus | null
}

export type ParseWorkflowYamlResult =
  | { ok: true; definition: ParsedWorkflowDefinition }
  | { ok: false; reason: string }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function extractSteps(raw: Record<string, unknown>): WorkflowStep[] {
  const candidate = raw.steps
  if (!Array.isArray(candidate)) {
    return []
  }
  const steps: WorkflowStep[] = []
  const seenIds = new Set<string>()
  candidate.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      return
    }
    let id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : `step-${index + 1}`
    // Why: a duplicate/blank id would make execution traces ambiguous (two
    // TraceEntry rows with the same stepId). De-dupe deterministically
    // rather than silently dropping the later step.
    while (seenIds.has(id)) {
      id = `${id}-${index + 1}`
    }
    seenIds.add(id)
    const type = typeof entry.type === 'string' && entry.type.trim() ? entry.type.trim() : 'unknown'
    const withValue = isPlainObject(entry.with) ? entry.with : {}
    steps.push({ id, type, with: withValue })
  })
  return steps
}

export function parseWorkflowYaml(yamlText: string): ParseWorkflowYamlResult {
  if (typeof yamlText !== 'string' || !yamlText.trim()) {
    return { ok: false, reason: 'Workflow definition is empty' }
  }
  if (Buffer.byteLength(yamlText, 'utf-8') > MAX_WORKFLOW_YAML_BYTES) {
    return { ok: false, reason: `Workflow definition exceeds ${MAX_WORKFLOW_YAML_BYTES} bytes` }
  }
  const startedAt = Date.now()
  let parsed: unknown
  try {
    parsed = parseYaml(yamlText, { maxAliasCount: MAX_ALIAS_COUNT })
  } catch (error) {
    return { ok: false, reason: `Invalid YAML: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (Date.now() - startedAt > MAX_PARSE_MS) {
    return { ok: false, reason: 'Workflow definition took too long to parse' }
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, reason: 'Workflow definition must be a YAML mapping (key: value), not a scalar or list' }
  }
  const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : null
  const status = isWorkflowStatus(parsed.status) ? parsed.status : null
  return {
    ok: true,
    definition: {
      raw: parsed,
      steps: extractSteps(parsed),
      name,
      status
    }
  }
}
