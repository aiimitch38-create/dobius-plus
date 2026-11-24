// Starts text intake in main (7.17). Taps go through the 7.16 notifier rules
// (thread row, live call or Mac notification, same rate limits) on their own
// budget, so a busy texter never uses up ADAM's own taps. A tap is always a
// fixed template with the contact's name, never the message text.
import { join } from 'node:path'
import type { AdamThreadRow } from '../../shared/speech-types'
import { getImessageBridgeConfig } from '../imessage-bridge/bridge-config'
import { sendImessageAfterDraftTouchId } from '../imessage-bridge/imessage-send'
import { requireTouchId, TOUCH_ID_REQUIRED, type TouchId } from '../imessage-bridge/touch-id-gate'
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

export { TOUCH_ID_REQUIRED }

const PREVIEW_CHARS = 80

/** What the Touch ID sheet says: who, which number, and the exact words (first 80, then the length). */
export function touchIdReason(send: { toName: string; toHandle: string; text: string }): string {
  const flat = send.text.replace(/\s+/g, ' ').trim()
  const preview =
    flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS).trimEnd()}… (${send.text.length} characters)` : flat
  return `send a text to ${send.toName} (${send.toHandle}): "${preview}"`
}

/** Touch ID before a draft goes out, showing its exact recipient and words. */
export function touchIdAuthorizeSend(
  send: { toName: string; toHandle: string; text: string },
  touchId?: TouchId,
  platform?: NodeJS.Platform
): Promise<string | null> {
  return requireTouchId(touchIdReason(send), touchId, platform)
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
    sendText: sendImessageAfterDraftTouchId,
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
