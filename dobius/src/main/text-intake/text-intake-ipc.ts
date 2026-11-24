// Settings' "From texts" list and tracked contacts (7.17). Only the main
// window's top frame may call these (same check as the live voice), because
// Accept makes a card and Send texts someone. Send also needs:
//   - the draft's fingerprint as shown, so a swapped recipient or text fails;
//   - a native confirm naming the exact person and words (a readable preview);
//   - Touch ID in TextIntake.sendDraft: THE gate, since no agent can press a finger.
// The protected-self-ui holds are defense in depth only (see that file).
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { TextIntakeResult, TextIntakeView } from '../../shared/text-intake'
import { holdProtectedSelfUi, releaseProtectedSelfUi, withProtectedSelfUi } from '../computer/protected-self-ui'
import { textIntake, type TextIntake } from './text-intake'

const UNTRUSTED = 'Only the Dobius+ window can do this.'
const STARTING = 'Dobius+ is still starting; try again in a minute.'
const EMPTY: TextIntakeView = { contacts: [], suggestions: [], drafts: [] }
const REVIEW_HOLD = 'text-intake-review'
const CONFIRM_HOLD = 'text-intake-send-confirm'
const watched = new Set<string>()
// Why a counter: two confirms open at once each hold their own key, so the first to close never lifts the other's.
let confirmCounter = 0

type Trusted = (event: Electron.IpcMainInvokeEvent) => boolean
/** True only when Carson clicked Send in the native confirm. */
export type ConfirmSend = (
  event: Electron.IpcMainInvokeEvent,
  send: { toName: string; toHandle: string; text: string }
) => Promise<boolean>

export const nativeConfirmSend: ConfirmSend = async (event, send) => {
  const options = {
    type: 'question' as const,
    buttons: ['Cancel', 'Send'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    message: `Send to ${send.toName} (${send.toHandle})?`,
    detail: send.text
  }
  const parent = BrowserWindow.fromWebContents(event.sender)
  const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
  return response === 1
}

function guarded<A extends unknown[]>(
  channel: string,
  trusted: Trusted,
  run: (intake: TextIntake, event: Electron.IpcMainInvokeEvent, ...args: A) => TextIntakeResult | Promise<TextIntakeResult>
): void {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    // Why EMPTY: an untrusted sender must learn nothing, not even who is tracked.
    if (!trusted(event)) {
      return { ok: false, error: UNTRUSTED, view: EMPTY }
    }
    const intake = textIntake()
    return intake ? run(intake, event, ...(args as A)) : { ok: false, error: STARTING, view: EMPTY }
  })
}

const asId = (value: unknown): string => (typeof value === 'string' ? value : '')

async function confirmedSend(
  intake: TextIntake,
  event: Electron.IpcMainInvokeEvent,
  confirm: ConfirmSend,
  args: { id: string; fingerprint: unknown; text: unknown }
): Promise<TextIntakeResult> {
  const edited = typeof args.text === 'string' ? args.text : undefined
  const prepared = intake.prepareSend(args.id, args.fingerprint, edited)
  if (!prepared.ok) {
    return { ok: false, error: prepared.error, view: intake.view() }
  }
  const { toName, toHandle } = prepared.draft
  confirmCounter += 1
  const yes = await withProtectedSelfUi(`${CONFIRM_HOLD}:${confirmCounter}`, () =>
    confirm(event, { toName, toHandle, text: prepared.text })
  )
  if (!yes) {
    return { ok: false, error: 'Not sent.', view: intake.view() }
  }
  // Re-checked inside sendDraft: the same fingerprint and text, or nothing goes out.
  return intake.sendDraft(args.id, args.fingerprint, edited)
}

export function registerTextIntakeIpc(trusted: Trusted, confirm: ConfirmSend = nativeConfirmSend): void {
  ipcMain.removeHandler('textIntake:view')
  ipcMain.handle('textIntake:view', (event): TextIntakeView | null =>
    trusted(event) ? (textIntake()?.view() ?? EMPTY) : null
  )
  ipcMain.removeHandler('textIntake:reviewVisible')
  ipcMain.handle('textIntake:reviewVisible', (event, visible: unknown) => {
    if (!trusted(event)) {
      return
    }
    const key = `${REVIEW_HOLD}:${event.sender.id}`
    if (visible === true) {
      holdProtectedSelfUi(key)
      if (!watched.has(key)) {
        watched.add(key)
        // Why: a window that reloads or closes never sends "hidden".
        const release = (): void => releaseProtectedSelfUi(key)
        event.sender.on('did-start-loading', release)
        event.sender.once('destroyed', () => {
          release()
          watched.delete(key)
        })
      }
    } else {
      releaseProtectedSelfUi(key)
    }
  })
  guarded('textIntake:setContacts', trusted, (intake, _event, contacts: unknown) => intake.setContacts(contacts))
  guarded('textIntake:accept', trusted, (intake, _event, id: unknown) => intake.accept(asId(id)))
  guarded('textIntake:dismiss', trusted, (intake, _event, id: unknown) => intake.dismiss(asId(id)))
  guarded('textIntake:sendDraft', trusted, (intake, event, id: unknown, fingerprint: unknown, text: unknown) =>
    confirmedSend(intake, event, confirm, { id: asId(id), fingerprint, text })
  )
  guarded('textIntake:discardDraft', trusted, (intake, _event, id: unknown) => intake.discardDraft(asId(id)))
}
