// Starts text intake in main (7.17). Taps go through the 7.16 notifier rules
// (thread row, live call or Mac notification, same rate limits) on their own
// budget, so a busy texter never uses up ADAM's own taps. A tap is always a
// fixed template with the contact's name, never the message text.
import { systemPreferences } from 'electron'
import { join } from 'node:path'
import type { AdamThreadRow } from '../../shared/speech-types'
import { getImessageBridgeConfig } from '../imessage-bridge/bridge-config'
import { sendImessage } from '../imessage-bridge/imessage-send'
import { AdamNotifier, AdamNotifyRefused } from '../jarvis/adam-notify'
import { sendLiveReport } from '../jarvis/live-voice-ipc'
import { getUserDataRoot } from '../storage/user-data-root'
import { vertexTaskStore } from '../vertex/vertex-task-store'
import { createIntakeStore } from './intake-store'
import { setTextIntake, TextIntake } from './text-intake'

export type TextIntakeWiring = {
  appendThread: (row: AdamThreadRow) => Promise<void>
  /** "ADAM can tap me on the shoulder" in Settings, Voice. */
  tapsOn: () => boolean
  showNotification: (title: string, body: string) => void
}

export function textSendUnavailable(platform: NodeJS.Platform = process.platform): string | null {
  if (platform !== 'darwin') {
    return 'Texts can only be sent from a Mac.'
  }
  return getImessageBridgeConfig().enabled ? null : 'Turn on the iMessage bridge in Settings first.'
}

export const TOUCH_ID_REQUIRED = 'Sending needs Touch ID on this Mac'

type TouchId = Pick<typeof systemPreferences, 'canPromptTouchID' | 'promptTouchID'>

/**
 * Touch ID before any text goes out (Codex round 2 on 7.17): computer-use and
 * osascript can click, but nothing but Carson's finger passes this. No click
 * fallback: without Touch ID, nothing is sent.
 */
const PREVIEW_CHARS = 80

/** What the Touch ID sheet says: who, which number, and the exact words (first 80, then the length). */
export function touchIdReason(send: { toName: string; toHandle: string; text: string }): string {
  const flat = send.text.replace(/\s+/g, ' ').trim()
  const preview =
    flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS).trimEnd()}… (${send.text.length} characters)` : flat
  return `send a text to ${send.toName} (${send.toHandle}): "${preview}"`
}

export async function touchIdAuthorizeSend(
  send: { toName: string; toHandle: string; text: string },
  touchId: TouchId = systemPreferences,
  platform: NodeJS.Platform = process.platform
): Promise<string | null> {
  if (platform !== 'darwin' || typeof touchId.canPromptTouchID !== 'function' || !touchId.canPromptTouchID()) {
    return TOUCH_ID_REQUIRED
  }
  try {
    await touchId.promptTouchID(touchIdReason(send))
    return null
  } catch {
    // Why a fixed reason: the prompt rejects for cancel, lockout or failure alike, and all mean "no".
    return 'Touch ID was not confirmed.'
  }
}

export function startTextIntake(wiring: TextIntakeWiring): TextIntake {
  const notifier = new AdamNotifier({
    enabled: wiring.tapsOn,
    appendThread: wiring.appendThread,
    sayLive: (text, urgent) => sendLiveReport({ kind: 'adam-says', text, ...(urgent ? { urgent: true } : {}) }),
    showNotification: wiring.showNotification
  })
  const intake = new TextIntake({
    store: createIntakeStore(() => join(getUserDataRoot(), 'text-intake.json')),
    createCard: (input) => vertexTaskStore.create(input),
    sendText: sendImessage,
    sendUnavailable: () => textSendUnavailable(),
    authorizeSend: (send) => touchIdAuthorizeSend(send),
    appendThread: wiring.appendThread,
    tap: (text) =>
      void notifier.notify(text, false).catch((error: unknown) => {
        if (!(error instanceof AdamNotifyRefused)) {
          console.warn('Text intake tap failed:', error)
        }
      })
  })
  setTextIntake(intake)
  return intake
}
