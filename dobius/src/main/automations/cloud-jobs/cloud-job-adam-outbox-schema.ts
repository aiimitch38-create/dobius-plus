import { z } from 'zod'
import { CloudId } from '../../../shared/cloud-jobs'

export const CloudJobAdamOutboxLeaseOwner = CloudId
export const CloudJobAdamOutboxBindingId = z.string().uuid()
export const CloudJobAdamOutboxLeaseNonce = z.string().uuid()
export const CloudJobAdamOutboxNow = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const CloudJobAdamOutboxLeaseMs = z.number().int().min(1_000).max(60_000)

export const CloudJobAdamOutboxFailure = z.enum([
  'auth-unavailable',
  'unauthorized',
  'conflict',
  'unsupported',
  'timeout',
  'transport-error',
  'endpoint-changed',
  'remote-error',
  'malformed-response'
])
export type CloudJobAdamOutboxFailure = z.infer<typeof CloudJobAdamOutboxFailure>

export type CloudJobAdamOutboxCounts = {
  pending: number
  leased: number
  acked: number
  blocked: number
  total: number
}

/** ROOT applies this DDL in its existing cloud database migration; this module opens no DB. */
export function cloudJobAdamOutboxMigrationDDL(): string {
  return `
    CREATE TABLE IF NOT EXISTS cloud_job_adam_bindings (
      job_id TEXT NOT NULL REFERENCES cloud_jobs(id) ON DELETE RESTRICT,
      binding_id TEXT NOT NULL UNIQUE,
      adam_instance_id TEXT NOT NULL,
      parent_objective_id TEXT NOT NULL,
      parent_objective_version INTEGER NOT NULL CHECK(parent_objective_version > 0),
      project_id TEXT NOT NULL,
      context_digest TEXT NOT NULL CHECK(length(context_digest) = 64),
      request_fingerprint TEXT NOT NULL CHECK(length(request_fingerprint) = 64),
      binding_digest TEXT NOT NULL CHECK(length(binding_digest) = 64),
      bound_at_ms INTEGER NOT NULL CHECK(bound_at_ms >= 0),
      expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms > bound_at_ms),
      PRIMARY KEY(job_id, binding_id),
      UNIQUE(job_id)
    );

    CREATE TABLE IF NOT EXISTS cloud_job_adam_receipt_outbox (
      receipt_id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      binding_id TEXT NOT NULL,
      cloud_event_sequence INTEGER NOT NULL CHECK(cloud_event_sequence > 0),
      cloud_job_version INTEGER NOT NULL CHECK(cloud_job_version > 0),
      attempt_id TEXT,
      payload_json TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256) = 64),
      state TEXT NOT NULL CHECK(state IN ('pending', 'leased', 'acked', 'blocked')),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
      next_attempt_at_ms INTEGER NOT NULL CHECK(next_attempt_at_ms >= 0),
      lease_owner TEXT,
      lease_nonce TEXT,
      lease_expires_at_ms INTEGER,
      ack_json TEXT,
      last_failure_code TEXT CHECK(last_failure_code IS NULL OR last_failure_code IN (
        'auth-unavailable', 'unauthorized', 'conflict', 'unsupported', 'timeout', 'transport-error',
        'endpoint-changed', 'remote-error', 'malformed-response', 'retry-limit', 'corrupt-payload'
      )),
      created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
      FOREIGN KEY(job_id, binding_id)
        REFERENCES cloud_job_adam_bindings(job_id, binding_id) ON DELETE RESTRICT,
      UNIQUE(job_id, cloud_event_sequence),
      CHECK(
        (state = 'leased' AND lease_owner IS NOT NULL AND lease_nonce IS NOT NULL
          AND lease_expires_at_ms IS NOT NULL)
        OR
        (state <> 'leased' AND lease_owner IS NULL AND lease_nonce IS NULL
          AND lease_expires_at_ms IS NULL)
      ),
      CHECK((state = 'acked' AND ack_json IS NOT NULL) OR (state <> 'acked' AND ack_json IS NULL))
    );

    CREATE INDEX IF NOT EXISTS cloud_job_adam_outbox_order
      ON cloud_job_adam_receipt_outbox(binding_id, cloud_event_sequence, state);
    CREATE INDEX IF NOT EXISTS cloud_job_adam_outbox_due
      ON cloud_job_adam_receipt_outbox(state, next_attempt_at_ms, lease_expires_at_ms);
  `
}
