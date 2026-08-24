import type { RpcAnyMethod } from '../core'
import { STATUS_METHODS } from './status'
import { AUTOMATION_METHODS } from './automations'
import { CUSTOM_AGENT_METHODS } from './custom-agents'
import { TEAM_METHODS } from './teams'
import { REPO_METHODS } from './repo'
import { WORKTREE_METHODS } from './worktree'
import { TERMINAL_METHODS } from './terminal'
import { BROWSER_CORE_METHODS } from './browser-core'
import { BROWSER_EXTRA_METHODS } from './browser-extras'
import { BROWSER_SCREENCAST_METHODS } from './browser-screencast'
import { ORCHESTRATION_METHODS } from './orchestration'
import { NOTIFICATION_METHODS } from './notifications'
import { STATS_METHODS } from './stats'
import { DIAGNOSTICS_METHODS } from './diagnostics'
import { ACCOUNT_METHODS } from './accounts'
import { PREFLIGHT_METHODS } from './preflight'
import { COMPUTER_METHODS } from './computer'
import { SESSION_TAB_METHODS } from './session-tabs'
import { NATIVE_CHAT_METHODS } from './native-chat'
import { FILE_METHODS } from './files'
import { GIT_METHODS } from './git'
import { GITHUB_METHODS } from './github'
import { GITLAB_METHODS } from './gitlab'
import { HOSTED_REVIEW_METHODS } from './hosted-review'
import { LINEAR_METHODS } from './linear'
import { LINEAR_AGENT_ACCESS_METHODS } from './linear-agent-access'
import { JIRA_METHODS } from './jira'
import { SSH_METHODS } from './ssh'
import { SPEECH_METHODS } from './speech'
import { CLIENT_UI_METHODS } from './client-ui'
import { CLIENT_EVENT_METHODS } from './client-events'
import { WORKSPACE_PORT_METHODS } from './workspace-ports'
import { SKILL_METHODS } from './skills'
import { CLIPBOARD_METHODS } from './clipboard'
import { HOST_CAPABILITY_METHODS } from './host-capabilities'
import { EMULATOR_METHODS } from './emulator'
import { VOICE_CONDUCTOR_METHODS } from './voice-conductor'
import { CHANNEL_TEMPLATE_METHODS } from './channel-templates'
import { SAVE_SUBSCRIPTION_METHODS } from './save-subscriptions'
// Communications-specific method groups. Not part of ALL_RPC_METHODS by
// default until this pass — each backs a family of vendor/buzz-desktop
// dispatch cases in dobiusCommunications.ts (see COMMUNICATIONS_RUNTIME_METHODS
// in src/shared/communications-bridge.ts for the matching allowlist).
import { COMMUNICATIONS_AGENT_METHODS } from '../../../communications/agents/communications-agent-methods'
import { IDENTITY_RPC_METHODS } from '../../../communications/identity/identity-rpc-methods'
import { HUDDLE_METHODS } from '../../../communications/huddles'
import { NATIVE_UX_RPC_METHODS } from '../../../communications/native/rpc-methods'
// Registered for reachability (RpcDispatcher registration is inert data
// until a caller dispatches a method — see runtime-bridge-harness.ts's own
// doc comment on this). No vendor/buzz-desktop switch case calls these
// method names yet — that is a separate, larger integration pass this
// task does not cover (no build report to transcribe cases from). See this
// task's THREE_WAY_AUDIT for the full accounting.
import { SNAPSHOT_METHODS } from '../../../communications/snapshots/snapshot-rpc-methods'
import { WORKFLOW_METHODS } from '../../../communications/workflows/workflow-rpc-methods'
import { WORKSTATION_METHODS } from '../../../communications/workstation/rpc-methods'
import { CANVAS_NOTES_METHODS } from '../../../communications/canvas/canvas-rpc-methods'

// Why: a flat manifest keeps registration order explicit and provides one
// grep-point for "what methods does the RPC server expose?" — useful when
// auditing the security boundary or wiring new CLI commands.
export const ALL_RPC_METHODS: readonly RpcAnyMethod[] = [
  ...STATUS_METHODS,
  ...AUTOMATION_METHODS,
  ...CUSTOM_AGENT_METHODS,
  ...TEAM_METHODS,
  ...REPO_METHODS,
  ...WORKTREE_METHODS,
  ...TERMINAL_METHODS,
  ...BROWSER_CORE_METHODS,
  ...BROWSER_SCREENCAST_METHODS,
  ...BROWSER_EXTRA_METHODS,
  ...ORCHESTRATION_METHODS,
  ...NOTIFICATION_METHODS,
  ...STATS_METHODS,
  ...DIAGNOSTICS_METHODS,
  ...ACCOUNT_METHODS,
  ...PREFLIGHT_METHODS,
  ...COMPUTER_METHODS,
  ...SESSION_TAB_METHODS,
  ...NATIVE_CHAT_METHODS,
  ...FILE_METHODS,
  ...GIT_METHODS,
  ...GITHUB_METHODS,
  ...GITLAB_METHODS,
  ...HOSTED_REVIEW_METHODS,
  ...LINEAR_METHODS,
  ...LINEAR_AGENT_ACCESS_METHODS,
  ...JIRA_METHODS,
  ...SSH_METHODS,
  ...SPEECH_METHODS,
  ...WORKSPACE_PORT_METHODS,
  ...SKILL_METHODS,
  ...CLIPBOARD_METHODS,
  ...HOST_CAPABILITY_METHODS,
  ...CLIENT_EVENT_METHODS,
  ...CLIENT_UI_METHODS,
  ...EMULATOR_METHODS,
  ...VOICE_CONDUCTOR_METHODS,
  ...CHANNEL_TEMPLATE_METHODS,
  ...SAVE_SUBSCRIPTION_METHODS,
  ...COMMUNICATIONS_AGENT_METHODS,
  ...IDENTITY_RPC_METHODS,
  ...HUDDLE_METHODS,
  ...NATIVE_UX_RPC_METHODS,
  ...SNAPSHOT_METHODS,
  ...WORKFLOW_METHODS,
  ...WORKSTATION_METHODS,
  ...CANVAS_NOTES_METHODS,
]
