import { checkExecutionAdmission } from '../agents/execution-gate'

/** The slice of DobiusRuntimeService the bridge needs; kept structural so the
 *  service stays testable without the full runtime. */
export type ImessageBridgeTerminalDispatcher = {
  resolveActiveTerminal: () => Promise<string>
  getTerminalAgentStatus: (
    handle: string
  ) => Promise<{ isRunningAgent: boolean; status: string | null }>
  sendTerminal: (
    handle: string,
    action: { text?: string; enter?: boolean },
    options?: {
      beforeWrite?: (ptyId: string) => void | Promise<void>
      suffixFailureError?: string
    }
  ) => Promise<unknown>
}

const TERMINAL_GUARD_NO_AGENT = 'imessage_guard_no_agent'
const TERMINAL_GUARD_PERMISSION = 'imessage_guard_permission'
const TERMINAL_GUARD_PAUSED = 'imessage_guard_paused'
export const PAUSED_REPLY = '(Dobius+ crew is paused; command not sent to the terminal)'

// Why: iMessage text must never reach a bare shell. Mirrors the runtime's
// terminal.send `requireAgentStatus: 'sendable'` rule: an agent must be the
// foreground process and not sitting on a permission prompt. Pause crew is
// rechecked last, after the await, so a pause flipped mid-send stops the
// very next write.
export async function assertSendAllowed(
  target: ImessageBridgeTerminalDispatcher,
  handle: string
): Promise<void> {
  const agent = await target.getTerminalAgentStatus(handle)
  if (!agent.isRunningAgent) {
    throw new Error(TERMINAL_GUARD_NO_AGENT)
  }
  if (agent.status === 'permission') {
    throw new Error(TERMINAL_GUARD_PERMISSION)
  }
  if (!checkExecutionAdmission('imessage-command').allowed) {
    throw new Error(TERMINAL_GUARD_PAUSED)
  }
}

export function dispatchFailureReply(message: string, typingStarted: boolean): string {
  if (message === 'no_active_terminal') {
    return '(no active terminal in Dobius+ right now; open a terminal and resend)'
  }
  if (message === TERMINAL_GUARD_PAUSED) {
    return typingStarted
      ? '(Dobius+ crew was paused mid-send; the command was not submitted and may be partly typed there)'
      : PAUSED_REPLY
  }
  if (message === TERMINAL_GUARD_NO_AGENT || message === TERMINAL_GUARD_PERMISSION) {
    const why =
      message === TERMINAL_GUARD_NO_AGENT ? 'is not running an agent' : 'is on a permission prompt'
    return typingStarted
      ? `(the target Dobius+ terminal changed mid-send and ${why}; the command was not submitted and may be partly typed there)`
      : `(the active Dobius+ terminal ${why}; command not sent)`
  }
  return `(Dobius could not deliver that command: ${message})`
}
