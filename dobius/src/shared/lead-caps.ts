// Why: the lead loop spawns Board consoles from an autonomous agent, so the
// caps and the role grammar live in one shared module that main (server-side
// enforcement) and the renderer (client-side re-check) both read.
export const MAX_WORKERS_PER_LEAD = 4
export const MAX_WORKERS_TOTAL = 6

export type LeadConsoleKind = 'worker' | 'lead'

export type LeadConsoleRole = { kind: LeadConsoleKind; leadId: string }

/** Lead profile names: `lead-<slug>`-style ids only; never shell-quoted elsewhere. */
export const LEAD_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/

export function isLeadId(value: unknown): value is string {
  return typeof value === 'string' && LEAD_ID_PATTERN.test(value)
}

/** Console card role string for a lead-loop console: `worker:<lead>` or `lead:<lead>`. */
export function leadConsoleRole(kind: LeadConsoleKind, leadId: string): string {
  return `${kind}:${leadId}`
}

/** Parses `worker:<lead>` / `lead:<lead>`; null for any other role (review, tests, …). */
export function parseLeadConsoleRole(role: unknown): LeadConsoleRole | null {
  if (typeof role !== 'string') {
    return null
  }
  const separator = role.indexOf(':')
  if (separator <= 0) {
    return null
  }
  const kind = role.slice(0, separator)
  const leadId = role.slice(separator + 1)
  if ((kind !== 'worker' && kind !== 'lead') || !isLeadId(leadId)) {
    return null
  }
  return { kind, leadId }
}

export type WorkerCapCheck =
  | { ok: true; forLead: number; total: number }
  | { ok: false; reason: 'per-lead' | 'total'; forLead: number; total: number }

/**
 * Whether one more worker for `leadId` fits under the caps, given the roles of
 * the console cards already on that worktree's board. Lead consoles never count.
 */
export function checkWorkerCaps(existingRoles: readonly unknown[], leadId: string): WorkerCapCheck {
  let forLead = 0
  let total = 0
  for (const raw of existingRoles) {
    const role = parseLeadConsoleRole(raw)
    if (role?.kind !== 'worker') {
      continue
    }
    total += 1
    if (role.leadId === leadId) {
      forLead += 1
    }
  }
  if (forLead >= MAX_WORKERS_PER_LEAD) {
    return { ok: false, reason: 'per-lead', forLead, total }
  }
  if (total >= MAX_WORKERS_TOTAL) {
    return { ok: false, reason: 'total', forLead, total }
  }
  return { ok: true, forLead, total }
}

export function workerCapMessage(check: Extract<WorkerCapCheck, { ok: false }>, leadId: string): string {
  return check.reason === 'per-lead'
    ? `worker_cap_reached: lead ${leadId} already has ${check.forLead} of ${MAX_WORKERS_PER_LEAD} workers`
    : `worker_cap_reached: ${check.total} of ${MAX_WORKERS_TOTAL} workers are already running on this board`
}
