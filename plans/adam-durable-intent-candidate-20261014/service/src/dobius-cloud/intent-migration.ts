export const ADAM_CLOUD_INTENT_MIGRATION = `
  CREATE TABLE dobius_cloud_intents (
    intent_id TEXT PRIMARY KEY,
    binding_id TEXT NOT NULL UNIQUE REFERENCES dobius_cloud_bindings(binding_id),
    request_identity_json TEXT NOT NULL,
    request_identity_digest TEXT NOT NULL,
    identity_json TEXT NOT NULL,
    identity_digest TEXT NOT NULL,
    sealed_envelope TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state = 'pending'),
    created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
    expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms >= created_at_ms)
  );
  CREATE INDEX dobius_cloud_intents_state_idx ON dobius_cloud_intents(state, expires_at_ms);
`
