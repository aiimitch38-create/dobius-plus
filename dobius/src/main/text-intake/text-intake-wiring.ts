// Starts text intake in main (7.17). Taps go through the 7.16 notifier rules
// (thread row, live call or Mac notification, same rate limits) on their own
// budget, so a busy texter never uses up ADAM's own taps. A tap is always a
// fixed template with the contact's name, never the message text.
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
