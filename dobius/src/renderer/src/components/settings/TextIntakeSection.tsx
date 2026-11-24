import { useCallback, useEffect, useState } from 'react'
import type { TextDraft, TextIntakeResult, TextIntakeView, TrackedContact } from '../../../../shared/text-intake'
import { SearchableSetting } from './SearchableSetting'
import { TextIntakeReviewList } from './TextIntakeReviewList'
import { TrackedContactsEditor } from './TrackedContactsEditor'

const REFRESH_MS = 15_000

/**
 * iMessage as ADAM's monitor (7.17): who is tracked, the suggested cards made
 * from their texts, and the texts ADAM drafted. Every action here is a click.
 */
export function TextIntakeSection(): React.JSX.Element {
  const [view, setView] = useState<TextIntakeView | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      // Why new Promise: an older preload (or a test stub) without this call must not break Settings.
      const next = await new Promise<TextIntakeView | null>((resolve, reject) => {
        window.api.textIntake.view().then(resolve, reject)
      })
      setView(next)
    } catch {
      setMessage('Could not read the texts list.')
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), REFRESH_MS)
    // Why: while this list is on screen, agents' computer-use may not touch Dobius+.
    const visible = (on: boolean): void => {
      void new Promise<void>((resolve, reject) => {
        window.api.textIntake.reviewVisible(on).then(resolve, reject)
      }).catch(() => undefined)
    }
    visible(true)
    return () => {
      clearInterval(timer)
      visible(false)
    }
  }, [refresh])

  const run = async (action: () => Promise<TextIntakeResult>, done: string): Promise<void> => {
    setBusy(true)
    try {
      const result = await action()
      setView(result.view)
      setMessage(result.ok ? done : result.error)
    } catch {
      setMessage('That did not work. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const api = window.api.textIntake
  // Why save first: main only sends the stored text whose fingerprint it checked.
  const sendEdited = async (draft: TextDraft, text: string): Promise<TextIntakeResult> => {
    let current = draft
    if (text !== draft.text) {
      const saved = await api.editDraft(draft.id, draft.fingerprint ?? '', text)
      const next = saved.view.drafts.find((d) => d.id === draft.id)
      if (!saved.ok || !next) {
        return saved
      }
      current = next
    }
    return api.sendDraft(current.id, current.fingerprint ?? '', current.text)
  }
  return (
    <SearchableSetting
      title="From texts"
      description="Texts from people you track become suggested tasks, and ADAM's drafted texts wait for your Send."
      keywords={['imessage', 'texts', 'contacts', 'tasks', 'drafts', 'adam']}
      className="space-y-4 py-2"
      id="text-intake"
    >
      <TrackedContactsEditor
        key={JSON.stringify(view?.contacts ?? [])}
        contacts={view?.contacts ?? []}
        busy={busy || !view}
        onSave={(contacts: TrackedContact[]) => void run(() => api.setContacts(contacts), 'Contacts saved.')}
      />
      <TextIntakeReviewList
        suggestions={view?.suggestions ?? []}
        drafts={view?.drafts ?? []}
        busy={busy}
        onAccept={(id) => void run(() => api.accept(id), 'Added to the Backlog.')}
        onDismiss={(id) => void run(() => api.dismiss(id), 'Dismissed.')}
        onSend={(draft, text) => void run(() => sendEdited(draft, text), 'Sent.')}
        onDiscard={(id) => void run(() => api.discardDraft(id), 'Draft discarded.')}
      />
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
    </SearchableSetting>
  )
}
