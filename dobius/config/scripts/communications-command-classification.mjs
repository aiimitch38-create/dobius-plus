// Ground-truth classifier for every native command the vendored Buzz renderer
// invokes. Rules trace directly to plans/BUZZ-COMMUNICATIONS-TAKEOVER.md's
// "Source ownership map" and "Command-surface migration" tables. A command
// that matches no rule returns `null` on purpose — that is the unclassified
// signal the coverage gate fails on, rather than a silent guess.

export const DISPOSITIONS = Object.freeze([
  'relay',
  'dobius-rpc',
  'communications-service',
  'native-electron',
  'removed'
])

// Ordered top-to-bottom; first match wins. More specific patterns (e.g.
// workflow-flavored channel commands) are listed before the generic
// patterns they would otherwise also match.
const RULES = [
  // --- Block/Builderlab-only surfaces: deliberately removed, not implemented.
  {
    match: /builderlab|community_deep_link/i,
    disposition: 'removed',
    package: 7,
    feature: 'block-builderlab'
  },
  { match: /^mesh_/i, disposition: 'removed', package: 7, feature: 'block-relay-mesh' },
  {
    match: /pairing|_sas$/i,
    disposition: 'removed',
    package: 7,
    feature: 'block-mobile-pairing'
  },

  // --- Voice huddles.
  {
    match: /huddle|voice_input_mode|tts_enabled|speak_agent_message|audio_output_device/i,
    disposition: 'communications-service',
    package: 6,
    feature: 'voice-huddles'
  },

  // --- Workflows (checked before the generic channel rule below, since
  // get_channel_workflows / get_channels_workflows also match /channel/i).
  {
    match: /workflow/i,
    disposition: 'communications-service',
    package: 5,
    feature: 'workflows'
  },

  // --- Agent lifecycle / factory.
  {
    match: /managed_agent|acp_(runtime|providers)|persona|agent_config|agent_memory|agent_models|agent_session_config|observer_(channel|event|control_event)/i,
    disposition: 'dobius-rpc',
    package: 3,
    feature: 'agent-lifecycle'
  },
  {
    match: /backend_provider|global_agent_config|agent_managed_profiles|acp_auth_methods|managed_agent_prereqs|baked_build_env|archive_default_enabled|model_status|runtime_file_config/i,
    disposition: 'dobius-rpc',
    package: 3,
    feature: 'agent-provider-config'
  },
  { match: /approval/i, disposition: 'dobius-rpc', package: 3, feature: 'agent-approvals' },
  {
    match: /^(create|delete|update)_team$|team_snapshot|agent_snapshot|snapshot_bytes|^list_teams$/i,
    disposition: 'dobius-rpc',
    package: 3,
    feature: 'teams-snapshots'
  },
  { match: /custom_harness/i, disposition: 'dobius-rpc', package: 3, feature: 'agent-lifecycle' },

  // --- Workstation: projects, git, repos.
  {
    match: /project_repo|clone_project_repository|project_remote_branch|pull_request|git_identity|workspace_icon|pipeline_hotstart|project_local_repo|project_terminal|merge_recovery|repos_dir|apply_workspace|git_bash_prerequisite/i,
    disposition: 'dobius-rpc',
    package: 4,
    feature: 'workstation-git'
  },

  // --- Media and attachments.
  {
    match: /clipboard|download_(file|image)/i,
    disposition: 'native-electron',
    package: 4,
    feature: 'media-native'
  },
  {
    match: /media|upload/i,
    disposition: 'dobius-rpc',
    package: 4,
    feature: 'media-service'
  },

  // --- Notifications, tray, window, native UX.
  {
    match: /tray|haptic|window_vibrancy|native_notification|title_bar_double_click|os_idle_seconds|prevent_sleep/i,
    disposition: 'native-electron',
    package: 4,
    feature: 'native-ux'
  },
  { match: /auto_update_supported/i, disposition: 'dobius-rpc', package: 1, feature: 'updater-delegate' },

  // --- Canvas, notes, saved searches, channel templates.
  {
    match: /canvas|global_notes|liked_notes|^get_note$|user_notes|publish_note|save_subscription|note_reactions|notes_timeline/i,
    disposition: 'communications-service',
    package: 2,
    feature: 'canvas-notes'
  },
  {
    match: /channel_template/i,
    disposition: 'communications-service',
    package: 2,
    feature: 'channel-templates'
  },

  // --- Identity, encryption, backup, recovery.
  {
    match: /ncryptsec|^get_nsec$|nip44|identity|backup_passphrase|archive_events|read_archived_events|sign_out|sign_event|auth_event|archived_identit|oa_owner|legacy_workspace_storage/i,
    disposition: 'dobius-rpc',
    package: 1,
    feature: 'identity-keychain'
  },

  // --- Runtime and relay service lifecycle.
  {
    match: /default_relay_url|relay_reconnect_hook|auto_connect_default_relay|relay_ws_url|relay_http_url/i,
    disposition: 'communications-service',
    package: 1,
    feature: 'relay-lifecycle'
  },

  // --- Channels and membership (generic; must stay below workflow rule).
  {
    match: /channel|relay_member|relay_membership|join_policy|relay_requires_membership/i,
    disposition: 'relay',
    package: 2,
    feature: 'channels-membership'
  },

  // --- Messages, DMs, presence, search, contacts (generic chat surface).
  {
    match: /presence|hide_dm|contact_list|forum_(post|thread)|link_preview|relay_self|relay_agents|^get_event$|thread_repli|search_messages|edit_message|delete_message|add_reaction|remove_reaction|send_channel_message|^get_feed$|open_dm|profile|users_batch|search_users/i,
    disposition: 'relay',
    package: 2,
    feature: 'messages-dm'
  }
]

/**
 * Classify a single native command name into a disposition/package/feature
 * triple. Returns `null` when no rule matches — an unclassified command,
 * which is the coverage gate's failure signal.
 */
export function classifyCommand(command) {
  const rule = RULES.find((candidate) => candidate.match.test(command))
  if (!rule) return null
  return { disposition: rule.disposition, package: rule.package, feature: rule.feature }
}

export const CLASSIFICATION_RULE_COUNT = RULES.length
