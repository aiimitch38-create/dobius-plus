import type { JarvisAskResult, JarvisSpeakOutcome } from '../../shared/speech-types'
import type { CommandHandler } from '../dispatch'
import { getBooleanFlag, getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'

// Why: ADAM's turn may take up to 3 minutes (adam-hermes-voice.ts), plus the
// 25 second confirmation dialog and some slack.
const ADAM_ASK_WAIT_TIMEOUT_MS = 240_000

function noteWaitingForConfirmation(json: boolean): void {
  if (!json) {
    process.stderr.write('Waiting up to 25 seconds for you to confirm in the Dobius+ app...\n')
  }
}

type AskResult = { sent: true; waited: boolean; reply?: JarvisAskResult }
type StatusResult = {
  busy: boolean
  voiceReady: boolean
  shortcutActive?: boolean
  phase?: string
}

/**
 * True when this command runs inside ADAM's own Hermes process (its HERMES_HOME
 * is the `adam` profile, set by adamHermesEnvironment). Why: ADAM asking
 * himself would open a confirmation for his own words or loop turn after turn.
 */
export function isInsideAdamHermes(env: NodeJS.ProcessEnv = process.env): boolean {
  const home = env.HERMES_HOME?.trim()
  if (!home) {
    return false
  }
  const parts = home.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts.at(-1) === 'adam' && parts.at(-2) === 'profiles'
}

export function formatAskResult(result: AskResult): string {
  if (!result.waited || !result.reply) {
    return 'Sent to ADAM. His answer will appear in his thread.'
  }
  const text = result.reply.text.trim()
  if (result.reply.kind === 'cancelled') {
    return 'ADAM’s answer was stopped before it finished.'
  }
  if (result.reply.kind === 'error' || !text) {
    return `ADAM could not answer. ${text || 'He sent back an empty reply.'}`
  }
  return text
}

export function formatAdamStatus(status: StatusResult): string {
  const lines = [status.busy ? 'ADAM is answering a message.' : 'ADAM is free.']
  if (!status.voiceReady) {
    lines.push('Voice is not ready yet (the Dobius+ window has not set it up).')
  } else {
    lines.push(status.shortcutActive ? 'Voice mode is on (Cmd+T).' : 'Voice mode is off.')
    if (status.phase) {
      lines.push(`Voice is: ${status.phase}.`)
    }
  }
  return lines.join('\n')
}

function getModeState(flags: Map<string, string | boolean>): boolean {
  const value = getRequiredStringFlag(flags, 'state').toLowerCase()
  if (value === 'on') {
    return true
  }
  if (value === 'off') {
    return false
  }
  throw new RuntimeClientError('invalid_argument', 'Mode must be on or off')
}

type NotifyResult = { delivered: 'spoken' | 'notification'; savedInThread: boolean }

export function formatNotifyResult(result: NotifyResult): string {
  const how =
    result.delivered === 'spoken'
      ? 'Carson will hear it on the live call once it is quiet.'
      : 'Shown to Carson as a Mac notification.'
  return result.savedInThread ? `${how} Saved in your thread.` : `${how} It could not be saved in your thread.`
}

export const ADAM_HANDLERS: Record<string, CommandHandler> = {
  'adam notify': async ({ flags, client, json }) => {
    // Why: only ADAM's own Hermes process carries the caller id (adam-caller-id.ts in main).
    const callerId = process.env.DOBIUS_ADAM_CALLER_ID?.trim() ?? ''
    if (process.env.DOBIUS_CALLER !== 'adam' || !callerId || !isInsideAdamHermes()) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Only ADAM can use dobius adam notify (from his own Hermes session).'
      )
    }
    const text = getRequiredStringFlag(flags, 'text')
    const urgent = getBooleanFlag(flags, 'urgent')
    const result = await client.call<NotifyResult>('adam.notify', {
      text,
      ...(urgent ? { urgent: true } : {}),
      caller: 'adam',
      callerId
    })
    printResult(result, json, formatNotifyResult)
  },
  'adam ask': async ({ flags, client, json }) => {
    if (isInsideAdamHermes()) {
      throw new RuntimeClientError(
        'invalid_argument',
        'This is ADAM’s own Hermes session, so it cannot send ADAM a message. Answer in your reply instead.'
      )
    }
    const text = getRequiredStringFlag(flags, 'text')
    const source = getOptionalStringFlag(flags, 'source')
    const wait = getBooleanFlag(flags, 'wait')
    noteWaitingForConfirmation(json)
    const result = await client.call<AskResult>(
      'adam.ask',
      { text, ...(source ? { source } : {}), ...(wait ? { wait: true } : {}) },
      wait ? { timeoutMs: ADAM_ASK_WAIT_TIMEOUT_MS } : undefined
    )
    printResult(result, json, formatAskResult)
  },
  'adam say': async ({ flags, client, json }) => {
    noteWaitingForConfirmation(json)
    // Why the long timeout: the reply comes back only after ADAM finished speaking.
    const result = await client.call<JarvisSpeakOutcome>(
      'adam.say',
      { text: getRequiredStringFlag(flags, 'text') },
      { timeoutMs: ADAM_ASK_WAIT_TIMEOUT_MS }
    )
    printResult(result, json, (value) =>
      value.played ? 'Said it.' : `ADAM could not say it${value.reason ? `: ${value.reason}` : ''}.`
    )
  },
  'adam status': async ({ client, json }) => {
    const result = await client.call<StatusResult>('adam.status')
    printResult(result, json, formatAdamStatus)
  },
  'adam mode': async ({ flags, client, json }) => {
    const active = getModeState(flags)
    noteWaitingForConfirmation(json)
    const result = await client.call<{ active: boolean; ok: boolean }>('adam.setMode', { active })
    printResult(result, json, (value) => {
      if (!value.ok) {
        return 'Voice mode could not be turned on: another app holds Cmd+T.'
      }
      return value.active ? 'Voice mode is on.' : 'Voice mode is off.'
    })
  }
}
