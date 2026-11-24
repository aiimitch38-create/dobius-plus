// Settings' "From texts" list and tracked contacts (7.17). Only the main
// window's top frame may call these (same check as the live voice), because
// Accept makes a card and Send texts someone.
import { ipcMain } from 'electron'
import type { TextIntakeResult, TextIntakeView } from '../../shared/text-intake'
import { textIntake, type TextIntake } from './text-intake'

const UNTRUSTED = 'Only the Dobius+ window can do this.'
const STARTING = 'Dobius+ is still starting; try again in a minute.'
const EMPTY: TextIntakeView = { contacts: [], suggestions: [], drafts: [] }

type Trusted = (event: Electron.IpcMainInvokeEvent) => boolean

function guarded<A extends unknown[]>(
  channel: string,
  trusted: Trusted,
  run: (intake: TextIntake, ...args: A) => TextIntakeResult | Promise<TextIntakeResult>
): void {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    const intake = textIntake()
    if (!trusted(event)) {
      return { ok: false, error: UNTRUSTED, view: intake?.view() ?? EMPTY }
    }
    return intake ? run(intake, ...(args as A)) : { ok: false, error: STARTING, view: EMPTY }
  })
}

const asId = (value: unknown): string => (typeof value === 'string' ? value : '')

export function registerTextIntakeIpc(trusted: Trusted): void {
  ipcMain.removeHandler('textIntake:view')
  ipcMain.handle('textIntake:view', (event): TextIntakeView | null =>
    trusted(event) ? (textIntake()?.view() ?? EMPTY) : null
  )
  guarded('textIntake:setContacts', trusted, (intake, contacts: unknown) => intake.setContacts(contacts))
  guarded('textIntake:accept', trusted, (intake, id: unknown) => intake.accept(asId(id)))
  guarded('textIntake:dismiss', trusted, (intake, id: unknown) => intake.dismiss(asId(id)))
  guarded('textIntake:sendDraft', trusted, (intake, id: unknown, text: unknown) =>
    intake.sendDraft(asId(id), typeof text === 'string' ? text : undefined)
  )
  guarded('textIntake:discardDraft', trusted, (intake, id: unknown) => intake.discardDraft(asId(id)))
}
