export const CLOUD_RECEIPT_MIGRATION = `
  CREATE TABLE dobius_cloud_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE dobius_parent_revisions (
    job_id TEXT PRIMARY KEY REFERENCES jobs(id), revision INTEGER NOT NULL DEFAULT 1
  );
  INSERT INTO dobius_parent_revisions SELECT id, 1 FROM jobs;
  CREATE TRIGGER dobius_parent_insert AFTER INSERT ON jobs BEGIN
    INSERT INTO dobius_parent_revisions VALUES (NEW.id, 1);
  END;
  CREATE TRIGGER dobius_parent_update AFTER UPDATE ON jobs BEGIN
    UPDATE dobius_parent_revisions SET revision=revision+1 WHERE job_id=NEW.id;
  END;
  CREATE TABLE dobius_cloud_bindings (
    binding_id TEXT PRIMARY KEY, parent_job_id TEXT NOT NULL REFERENCES jobs(id),
    identity_json TEXT NOT NULL, identity_digest TEXT NOT NULL,
    capability_hash TEXT NOT NULL, expires_at_ms INTEGER NOT NULL,
    consumed_at_ms INTEGER, response_json TEXT
  );
  CREATE TABLE dobius_cloud_receipts (
    receipt_id TEXT PRIMARY KEY, binding_id TEXT NOT NULL REFERENCES dobius_cloud_bindings(binding_id),
    cloud_job_id TEXT NOT NULL, cloud_event_sequence INTEGER NOT NULL,
    payload_json TEXT NOT NULL, payload_sha256 TEXT NOT NULL, ack_json TEXT NOT NULL,
    received_at_ms INTEGER NOT NULL,
    UNIQUE(binding_id, cloud_event_sequence)
  );
`
