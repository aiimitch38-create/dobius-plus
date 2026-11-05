export type IMessageIntent =
  | 'monitor_stop'
  | 'monitor_start'
  | 'session_read'
  | 'session_send'
  | 'terminal_create'
  | 'agent_launch'
  | 'approval'
  | 'job_cancel'
  | 'job_status'
  | 'general'

export type ClassifiedIntent = {
  intent: IMessageIntent
  requestedActions: string[]
  deterministic: boolean
  routeContext?: string
}

const normalized = (text: string): string => text.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ').trim()

export function classifyIMessageIntent(text: string): ClassifiedIntent {
  const value = normalized(text)
  const secondaryActions = [
    ...(/\b(look into|inspect|research|check)\b.*\bcli\b/.test(value) ? ['inspect_cli'] : []),
    ...(/\b(asana|a sauna)\b.*\b(task|comment|update|report)\b|\b(task|comment|update|report)\b.*\b(asana|a sauna)\b/.test(value) ? ['prepare_asana_draft'] : [])
  ]
  if (/\b(stop|cancel|disable|turn off|quit)\b.*\b(monitor|monitoring|session (updates?|texts?)|session working)\b/.test(value)
      || /\bstop sending me\b.*\bsession\b/.test(value)) {
    return { intent: 'monitor_stop', requestedActions: ['stop_all_session_monitors', 'cancel_pending_session_alerts', 'verify_silence'], deterministic: true }
  }
  if (/\b(stop|cancel)\b.*\b(job|task|work|agent)\b/.test(value)) {
    return { intent: 'job_cancel', requestedActions: ['resolve_exact_job', 'cancel_job', 'stop_launched_terminal', 'verify_cancelled'], deterministic: false,
      routeContext: 'Resolve exactly one active ADAM orchestration job, then run scripts/adam-orchestration.sh cancel with Carson\'s reason. Report whether its terminal was actually stopped.' }
  }
  if (/\b(status|what.*doing|how.*going|progress)\b.*\b(job|task|work|agent)\b/.test(value)) {
    return { intent: 'job_status', requestedActions: ['resolve_exact_job', 'read_job_status', 'report_remaining_and_evidence'], deterministic: false,
      routeContext: 'Resolve exactly one ADAM orchestration job and use scripts/adam-orchestration.sh status. Report state, current action, remaining actions, retries, and evidence.' }
  }
  if (/\b(monitor|watch|keep an eye on)\b.*\b(session|terminal|agent)\b/.test(value)) {
    return { intent: 'monitor_start', requestedActions: ['resolve_exact_terminal', 'create_monitor'], deterministic: false,
      routeContext: 'Resolve exactly one existing terminal. Start one quiet monitor. Notify only on done, blocked, failed, or approval-needed.' }
  }
  if (/\b(spin up|start|launch|create|open)\b.*\b(agent|terminal|session)\b/.test(value)) {
    const agent = /\bagent\b/.test(value)
    return { intent: agent ? 'agent_launch' : 'terminal_create',
      requestedActions: ['resolve_project', 'worker_preflight', 'create_terminal', ...(agent ? ['launch_agent'] : []), ...secondaryActions], deterministic: false,
      routeContext: 'This is a CREATE action, never text to type into an existing terminal. Resolve the project, compile one authoritative job with scripts/adam-orchestration.sh create, and return its job ID. The supervisor owns preflight, terminal creation, agent launch, monitoring, recovery, verification, and reporting.' }
  }
  if (/\b(type|paste|send|inject|put|tell|prompt)\b.*\b(terminal|session|agent)\b/.test(value)) {
    return { intent: 'session_send', requestedActions: ['resolve_exact_terminal', 'prepare_prompt', 'dispatch_once', 'verify_delivery'], deterministic: false,
      routeContext: 'This is a SEND_TO_SESSION action. Do not create a new terminal unless Carson explicitly asked to spin one up.' }
  }
  if (/\b(look|read|check|what|response|says?|status)\b.*\b(terminal|session|agent)\b/.test(value)) {
    return { intent: 'session_read', requestedActions: ['resolve_exact_terminal', 'read_session', 'report_evidence'], deterministic: false }
  }
  if (/^(go|yes|approve|send|do it|fire)[.! ]*$/.test(value)) {
    return { intent: 'approval', requestedActions: ['resolve_exact_pending_action'], deterministic: true }
  }
  return { intent: 'general', requestedActions: [], deterministic: false }
}
