import { randomUUID } from 'node:crypto'
import type { AdamDatabase } from '../db/database.js'

export const READINESS_LABELS = [
  'absent', 'discovered', 'configured', 'authenticated', 'read_only_verified',
  'shadow_action_verified', 'approval_gated_live', 'progressive_autonomy_eligible'
] as const

export type ReadinessLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

export type CapabilityCheck = {
  adapter: string
  accountId?: string
  capability: string
  level: ReadinessLevel
  checkedAt: string
  expiresAt: string
  evidence: string[]
  error?: { code: string; message: string }
}

export class CapabilityRegistry {
  constructor(private readonly db: AdamDatabase) {}

  record(check: CapabilityCheck): string {
    const id = randomUUID()
    this.db.prepare(`
      INSERT INTO capability_checks
        (id, adapter, account_id, capability, level, evidence, error, checked_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, check.adapter, check.accountId ?? null, check.capability, check.level,
      JSON.stringify(check.evidence), check.error ? JSON.stringify(check.error) : null,
      check.checkedAt, check.expiresAt
    )
    return id
  }

  select(
    capability: string,
    minLevel: ReadinessLevel,
    now = new Date()
  ): Array<{
    adapter: string
    accountId?: string | undefined
    level: ReadinessLevel
    status: (typeof READINESS_LABELS)[number]
  }> {
    return this.latest(now)
      .filter((row) =>
        row.capability === capability &&
        row.status !== 'unknown_stale' &&
        Number(row.level) >= minLevel
      )
      .sort((a, b) => Number(b.level) - Number(a.level))
      .map((row) => ({
        adapter: String(row.adapter),
        accountId: row.accountId == null ? undefined : String(row.accountId),
        level: Number(row.level) as ReadinessLevel,
        status: row.status as (typeof READINESS_LABELS)[number]
      }))
  }

  latest(now = new Date()): Array<Record<string, unknown>> {
    const rows = this.db.prepare(`
      SELECT c.* FROM capability_checks c
      JOIN (
        SELECT adapter, COALESCE(account_id, '') account_key, capability, MAX(checked_at) checked_at
        FROM capability_checks GROUP BY adapter, COALESCE(account_id, ''), capability
      ) latest
      ON latest.adapter = c.adapter
        AND latest.account_key = COALESCE(c.account_id, '')
        AND latest.capability = c.capability
        AND latest.checked_at = c.checked_at
      ORDER BY c.adapter, c.account_id, c.capability
    `).all() as Array<Record<string, unknown>>
    return rows.map((row) => {
      const fresh = String(row.expires_at) > now.toISOString()
      const reportedLevel = fresh ? Number(row.level) : 0
      return {
        adapter: row.adapter,
        accountId: row.account_id,
        capability: row.capability,
        level: reportedLevel,
        status: fresh ? READINESS_LABELS[reportedLevel] : 'unknown_stale',
        checkedAt: row.checked_at,
        expiresAt: row.expires_at,
        evidence: JSON.parse(String(row.evidence)),
        error: row.error ? JSON.parse(String(row.error)) : null
      }
    })
  }
}
