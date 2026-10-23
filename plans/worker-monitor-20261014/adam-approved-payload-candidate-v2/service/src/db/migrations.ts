import { CLOUD_RECEIPT_MIGRATION } from '../dobius-cloud/receipt-migration.js'
import {
  ADAM_CLOUD_APPROVED_PAYLOAD_MIGRATION,
  ADAM_CLOUD_INTENT_MIGRATION
} from '../dobius-cloud/intent-migration.js'

export const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE commands (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        dedupe_key TEXT NOT NULL UNIQUE,
        body TEXT NOT NULL,
        received_at TEXT NOT NULL
      );

      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        command_id TEXT REFERENCES commands(id),
        objective TEXT NOT NULL,
        project_id TEXT,
        state TEXT NOT NULL,
        risk TEXT NOT NULL DEFAULT 'low',
        definition_of_done TEXT NOT NULL DEFAULT '{}',
        next_wake_at TEXT,
        expected_event TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX jobs_state_wake_idx ON jobs(state, next_wake_at);

      CREATE TABLE steps (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id),
        title TEXT NOT NULL,
        adapter TEXT NOT NULL,
        input TEXT NOT NULL DEFAULT '{}',
        state TEXT NOT NULL DEFAULT 'pending',
        depends_on TEXT NOT NULL DEFAULT '[]',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        lease_owner TEXT,
        lease_expires_at TEXT,
        result TEXT,
        error_class TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX steps_job_state_idx ON steps(job_id, state);
      CREATE INDEX steps_lease_idx ON steps(state, lease_expires_at);

      CREATE TABLE actions (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id),
        step_id TEXT REFERENCES steps(id),
        category TEXT NOT NULL,
        action_digest TEXT NOT NULL,
        payload TEXT NOT NULL,
        policy_decision TEXT NOT NULL,
        policy_rule_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        blast_radius TEXT,
        undo_procedure TEXT,
        pre_state_artifact TEXT,
        escalation_threshold TEXT,
        state TEXT NOT NULL DEFAULT 'proposed',
        result TEXT,
        created_at TEXT NOT NULL,
        executed_at TEXT
      );

      CREATE TABLE approvals (
        id TEXT PRIMARY KEY,
        action_digest TEXT NOT NULL,
        approved_by TEXT NOT NULL,
        approved_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT
      );
      CREATE INDEX approvals_digest_idx ON approvals(action_digest, expires_at);

      CREATE TABLE attempts (
        id TEXT PRIMARY KEY,
        step_id TEXT NOT NULL REFERENCES steps(id),
        attempt_number INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        outcome TEXT,
        error_class TEXT,
        detail TEXT
      );

      CREATE TABLE evidence (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id),
        step_id TEXT REFERENCES steps(id),
        verifier TEXT NOT NULL,
        source TEXT NOT NULL,
        digest TEXT,
        result TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE followups (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id),
        condition TEXT NOT NULL,
        due_at TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending',
        resolved_at TEXT
      );
      CREATE INDEX followups_due_idx ON followups(state, due_at);

      CREATE TABLE outbox (
        id TEXT PRIMARY KEY,
        dedupe_key TEXT NOT NULL UNIQUE,
        channel TEXT NOT NULL,
        recipient TEXT NOT NULL,
        payload TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        lease_owner TEXT,
        lease_expires_at TEXT,
        delivered_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX outbox_ready_idx ON outbox(state, next_attempt_at);

      CREATE TABLE audit_log (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        actor TEXT NOT NULL,
        event_type TEXT NOT NULL,
        subject_id TEXT,
        detail TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `
  },
  {
    version: 2,
    sql: `
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        provider_session_id TEXT,
        pane_key TEXT NOT NULL,
        terminal_handle TEXT,
        worktree_id TEXT,
        project_id TEXT,
        cwd TEXT,
        branch TEXT,
        state TEXT NOT NULL,
        prompt TEXT,
        last_assistant_message TEXT,
        source_path TEXT,
        source_updated_at TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        UNIQUE(provider, pane_key)
      );
      CREATE INDEX sessions_project_state_idx ON sessions(project_id, state);
      CREATE INDEX sessions_provider_id_idx ON sessions(provider, provider_session_id);

      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        event_key TEXT NOT NULL UNIQUE,
        session_id TEXT REFERENCES sessions(id),
        project_id TEXT,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        ingested_at TEXT NOT NULL
      );
      CREATE INDEX events_project_time_idx ON events(project_id, occurred_at);

      CREATE TABLE session_cursors (
        source_id TEXT PRIMARY KEY,
        cursor TEXT NOT NULL,
        source_digest TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE project_ledger (
        project_id TEXT PRIMARY KEY,
        current_state TEXT NOT NULL,
        source_event_id TEXT,
        valid_at TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 1.0,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE commitments (
        id TEXT PRIMARY KEY,
        owner TEXT,
        beneficiary TEXT,
        expected_outcome TEXT NOT NULL,
        deadline TEXT,
        evidence_event_id TEXT REFERENCES events(id),
        confidence REAL NOT NULL,
        state TEXT NOT NULL DEFAULT 'candidate',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX commitments_owner_state_idx ON commitments(owner, state);
      CREATE INDEX commitments_deadline_idx ON commitments(state, deadline);

      CREATE TABLE knowledge_nodes (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        data TEXT NOT NULL,
        valid_from TEXT NOT NULL,
        valid_to TEXT,
        confidence REAL NOT NULL,
        source_event_id TEXT REFERENCES events(id)
      );

      CREATE TABLE knowledge_edges (
        id TEXT PRIMARY KEY,
        from_node_id TEXT NOT NULL REFERENCES knowledge_nodes(id),
        relation TEXT NOT NULL,
        to_node_id TEXT NOT NULL REFERENCES knowledge_nodes(id),
        rationale TEXT,
        source_event_id TEXT REFERENCES events(id),
        created_at TEXT NOT NULL
      );
    `
  },
  {
    version: 3,
    sql: `
      CREATE TABLE system_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO system_state (key, value, updated_at)
      VALUES ('runtime_mode', 'shadow', datetime('now'));

      CREATE TABLE candidate_plans (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id),
        summary TEXT NOT NULL,
        metrics TEXT NOT NULL,
        score REAL NOT NULL,
        selected INTEGER NOT NULL DEFAULT 0,
        rationale TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE triggers (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        subject_id TEXT,
        payload TEXT NOT NULL,
        attention_score REAL NOT NULL,
        state TEXT NOT NULL DEFAULT 'detected',
        detected_at TEXT NOT NULL,
        handled_at TEXT
      );
      CREATE INDEX triggers_state_score_idx ON triggers(state, attention_score DESC);
    `
  },
  {
    version: 4,
    sql: `
      CREATE TABLE capability_checks (
        id TEXT PRIMARY KEY,
        adapter TEXT NOT NULL,
        account_id TEXT,
        capability TEXT NOT NULL,
        level INTEGER NOT NULL CHECK(level BETWEEN 0 AND 7),
        evidence TEXT NOT NULL DEFAULT '[]',
        error TEXT,
        checked_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX capability_checks_lookup_idx
        ON capability_checks(adapter, account_id, capability, checked_at DESC);

      CREATE TABLE terminal_bindings (
        id TEXT PRIMARY KEY,
        job_id TEXT REFERENCES jobs(id),
        terminal_handle TEXT NOT NULL,
        pane_key TEXT,
        worktree_id TEXT NOT NULL,
        project_id TEXT,
        agent_type TEXT,
        observed_prompt_digest TEXT,
        state TEXT NOT NULL DEFAULT 'active',
        bound_at TEXT NOT NULL,
        released_at TEXT
      );
      CREATE INDEX terminal_bindings_target_idx ON terminal_bindings(terminal_handle, state);

      CREATE TABLE prompt_dispatches (
        id TEXT PRIMARY KEY,
        job_id TEXT REFERENCES jobs(id),
        binding_id TEXT REFERENCES terminal_bindings(id),
        terminal_handle TEXT NOT NULL,
        worktree_id TEXT NOT NULL,
        prompt_digest TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        prompt_text TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'prepared',
        pre_snapshot TEXT,
        receipt TEXT,
        post_snapshot TEXT,
        error TEXT,
        prepared_at TEXT NOT NULL,
        sent_at TEXT,
        verified_at TEXT
      );
      CREATE INDEX prompt_dispatches_target_idx ON prompt_dispatches(terminal_handle, prepared_at DESC);
    `
  },
  {
    version: 5,
    sql: `
      ALTER TABLE prompt_dispatches ADD COLUMN authorized_by TEXT;
      ALTER TABLE prompt_dispatches ADD COLUMN authorization_source TEXT;
      ALTER TABLE prompt_dispatches ADD COLUMN authorized_at TEXT;
      ALTER TABLE prompt_dispatches ADD COLUMN prompt_mode TEXT NOT NULL DEFAULT 'engineered';
    `
  },
  {
    version: 6,
    sql: `
      CREATE TABLE worker_launches (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        repo_id TEXT NOT NULL,
        repo_path TEXT NOT NULL,
        worktree_name TEXT NOT NULL,
        workspace_mode TEXT NOT NULL,
        base_ref TEXT,
        base_ref_source TEXT,
        agent_type TEXT NOT NULL,
        prompt_digest TEXT NOT NULL,
        prompt_text TEXT NOT NULL,
        setup_policy TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'prepared',
        worktree_id TEXT,
        worktree_path TEXT,
        terminal_handle TEXT,
        launch_receipt TEXT,
        dispatch_id TEXT REFERENCES prompt_dispatches(id),
        authorized_by TEXT NOT NULL,
        authorization_source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        launched_at TEXT,
        verified_at TEXT,
        error TEXT
      );
      CREATE INDEX worker_launches_state_idx ON worker_launches(state, created_at);
    `
  },
  {
    version: 7,
    sql: `
      ALTER TABLE worker_launches ADD COLUMN request_digest TEXT;
    `
  },
  {
    version: 8,
    sql: `
      CREATE TABLE model_routes (
        id TEXT PRIMARY KEY,
        request_key TEXT NOT NULL UNIQUE,
        request_digest TEXT NOT NULL,
        backend TEXT NOT NULL,
        task_class TEXT,
        requested_model TEXT NOT NULL,
        selected_model TEXT,
        selected_provider TEXT,
        decision TEXT,
        state TEXT NOT NULL,
        latency_ms INTEGER,
        cost_usd REAL,
        tokens_in INTEGER,
        tokens_out INTEGER,
        fallback_attempts INTEGER,
        upstream_request_id TEXT,
        result TEXT,
        error TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX model_routes_state_time_idx ON model_routes(state, started_at DESC);
    `
  },
  {
    version: 9,
    sql: `
      CREATE TABLE imessage_threads (
        id TEXT PRIMARY KEY,
        chat_guid TEXT NOT NULL UNIQUE,
        chat_identifier TEXT NOT NULL,
        display_name TEXT,
        participant_hashes TEXT NOT NULL DEFAULT '[]',
        scope TEXT NOT NULL CHECK(scope IN ('adam_self', 'authorized_on_demand', 'prohibited')),
        latest_message_rowid INTEGER,
        latest_message_at TEXT,
        summary_version INTEGER NOT NULL DEFAULT 0,
        summary_text TEXT,
        summary_source_start INTEGER,
        summary_source_end INTEGER,
        summary_updated_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX imessage_threads_identifier_idx ON imessage_threads(chat_identifier);

      CREATE TABLE imessage_messages (
        id TEXT PRIMARY KEY,
        apple_guid TEXT NOT NULL UNIQUE,
        rowid INTEGER NOT NULL,
        thread_id TEXT NOT NULL REFERENCES imessage_threads(id),
        sender_identity TEXT,
        direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound', 'external')),
        text TEXT,
        text_source TEXT CHECK(text_source IN ('text', 'attributedBody', 'transcription', 'OCR')),
        message_kind TEXT NOT NULL CHECK(message_kind IN ('text', 'image', 'audio', 'file', 'reaction', 'edit', 'system')),
        reply_to_guid TEXT,
        associated_message_guid TEXT,
        sent_at TEXT NOT NULL,
        edited_at TEXT,
        deleted_at TEXT,
        raw_digest TEXT NOT NULL,
        ingested_at TEXT NOT NULL
      );
      CREATE INDEX imessage_messages_thread_time_idx ON imessage_messages(thread_id, sent_at, rowid);
      CREATE INDEX imessage_messages_reply_idx ON imessage_messages(reply_to_guid);

      CREATE TABLE imessage_attachments (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES imessage_messages(id),
        apple_attachment_guid TEXT NOT NULL UNIQUE,
        filename TEXT,
        mime_type TEXT,
        uti TEXT,
        size_bytes INTEGER,
        content_digest TEXT,
        local_path TEXT,
        derived_text TEXT,
        derivation_kind TEXT CHECK(derivation_kind IN ('OCR', 'transcription', 'metadata')),
        derivation_state TEXT,
        derivation_evidence TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX imessage_attachments_message_idx ON imessage_attachments(message_id);

      CREATE TABLE conversation_facts (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES imessage_threads(id),
        kind TEXT NOT NULL,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object TEXT NOT NULL,
        source_message_ids TEXT NOT NULL,
        valid_from TEXT NOT NULL,
        valid_to TEXT,
        confidence REAL NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('candidate', 'confirmed', 'superseded')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX conversation_facts_thread_state_idx ON conversation_facts(thread_id, state, kind);

      CREATE TABLE conversation_open_loops (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES imessage_threads(id),
        owner TEXT,
        expected_outcome TEXT NOT NULL,
        source_message_ids TEXT NOT NULL,
        deadline TEXT,
        state TEXT NOT NULL,
        resolution_message_id TEXT REFERENCES imessage_messages(id),
        confidence REAL NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX conversation_open_loops_thread_state_idx ON conversation_open_loops(thread_id, state, deadline);

      CREATE TABLE message_context_receipts (
        id TEXT PRIMARY KEY,
        inbound_message_id TEXT NOT NULL REFERENCES imessage_messages(id),
        response_message_id TEXT REFERENCES imessage_messages(id),
        model_route_id TEXT REFERENCES model_routes(id),
        recent_message_ids TEXT NOT NULL,
        summary_version INTEGER NOT NULL,
        fact_ids TEXT NOT NULL,
        open_loop_ids TEXT NOT NULL,
        project_ids TEXT NOT NULL,
        terminal_session_ids TEXT NOT NULL,
        context_digest TEXT NOT NULL,
        ambiguities TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX message_context_receipts_inbound_idx ON message_context_receipts(inbound_message_id, created_at);

      CREATE TABLE imessage_ingestion_cursors (
        source_id TEXT PRIMARY KEY,
        last_rowid INTEGER NOT NULL,
        last_guid TEXT,
        last_message_at TEXT,
        source_digest TEXT,
        state TEXT NOT NULL,
        error TEXT,
        updated_at TEXT NOT NULL
      );
    `
  },
  {
    version: 10,
    sql: `
      CREATE TABLE session_monitors (
        id TEXT PRIMARY KEY,
        terminal_handle TEXT NOT NULL,
        worktree_id TEXT NOT NULL,
        label TEXT,
        recipient TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('active', 'paused', 'stopped', 'error')),
        last_snapshot_digest TEXT,
        last_agent_state TEXT,
        last_output TEXT,
        last_checked_at TEXT,
        last_notified_at TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(terminal_handle, recipient)
      );
      CREATE INDEX session_monitors_active_idx ON session_monitors(state, last_checked_at);
    `
  },
  {
    version: 11,
    sql: `
      CREATE TABLE imessage_command_intents (
        id TEXT PRIMARY KEY,
        inbound_message_id TEXT,
        inbound_rowid INTEGER,
        command_id TEXT REFERENCES commands(id),
        job_id TEXT REFERENCES jobs(id),
        intent TEXT NOT NULL,
        requested_actions TEXT NOT NULL DEFAULT '[]',
        route_context TEXT,
        state TEXT NOT NULL,
        result TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(inbound_message_id)
      );
      CREATE INDEX imessage_command_intents_state_idx ON imessage_command_intents(state, created_at);

      CREATE TABLE pending_action_approvals (
        id TEXT PRIMARY KEY,
        action_digest TEXT NOT NULL UNIQUE,
        action_kind TEXT NOT NULL,
        preview TEXT NOT NULL,
        payload TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('pending', 'approved', 'cancelled', 'expired', 'executed')),
        source_message_id TEXT,
        approval_message_id TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        resolved_at TEXT
      );
      CREATE INDEX pending_action_approvals_state_idx ON pending_action_approvals(state, expires_at);
    `
  },
  {
    version: 12,
    sql: `
      ALTER TABLE pending_action_approvals ADD COLUMN result TEXT;
    `
  },
  {
    version: 13,
    sql: `
      ALTER TABLE steps ADD COLUMN next_attempt_at TEXT;
      ALTER TABLE jobs ADD COLUMN cancellation_reason TEXT;
      ALTER TABLE jobs ADD COLUMN cancelled_at TEXT;

      CREATE TABLE orchestration_job_contracts (
        job_id TEXT PRIMARY KEY REFERENCES jobs(id),
        contract TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX steps_job_ready_idx ON steps(job_id, state, next_attempt_at, created_at);
    `
  },
  {
    version: 14,
    sql: `
      CREATE TABLE imessage_model_decisions (
        id TEXT PRIMARY KEY,
        inbound_message_id TEXT NOT NULL UNIQUE,
        lane TEXT NOT NULL CHECK(lane IN ('fast','balanced','execution')),
        harness TEXT NOT NULL CHECK(harness IN ('claude','supervisor')),
        model TEXT NOT NULL,
        worker_preference TEXT CHECK(worker_preference IN ('codex','claude')),
        reason TEXT NOT NULL,
        features TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX imessage_model_decisions_lane_idx ON imessage_model_decisions(lane, created_at);
    `
  },
  {
    version: 15,
    sql: `
      CREATE TABLE imessage_conversation_frames (
        sender_id TEXT PRIMARY KEY,
        mode TEXT NOT NULL CHECK(mode IN ('listening','brainstorming','planning','executing','waiting')),
        objective TEXT,
        entities TEXT NOT NULL DEFAULT '[]',
        constraints TEXT NOT NULL DEFAULT '[]',
        corrections TEXT NOT NULL DEFAULT '[]',
        source_message_id TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE imessage_conversation_frame_events (
        id TEXT PRIMARY KEY,
        sender_id TEXT NOT NULL,
        source_message_id TEXT NOT NULL UNIQUE,
        prior_mode TEXT,
        next_mode TEXT NOT NULL,
        normalized_text TEXT NOT NULL,
        frame TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX imessage_conversation_frame_events_sender_idx ON imessage_conversation_frame_events(sender_id, created_at);
    `
  },
  {
    version: 16,
    sql: `
      ALTER TABLE outbox ADD COLUMN sent_at TEXT;
      CREATE INDEX outbox_tts_unsent_idx ON outbox(channel, sent_at);
    `
  },
  {
    version: 17,
    sql: `
      ALTER TABLE prompt_dispatches ADD COLUMN context_pack_digest TEXT;
      ALTER TABLE prompt_dispatches ADD COLUMN context_pack TEXT;
      ALTER TABLE worker_launches ADD COLUMN context_pack_digest TEXT;
      ALTER TABLE worker_launches ADD COLUMN context_pack TEXT;
    `
  },
  { version: 18, sql: CLOUD_RECEIPT_MIGRATION },
  { version: 19, sql: ADAM_CLOUD_INTENT_MIGRATION },
  { version: 20, sql: ADAM_CLOUD_APPROVED_PAYLOAD_MIGRATION }
] as const
