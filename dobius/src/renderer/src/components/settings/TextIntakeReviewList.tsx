import { useState } from 'react'
import type { IntakeSuggestion, TextDraft } from '../../../../shared/text-intake'
import { Button } from '../ui/button'
import { Label } from '../ui/label'

type Props = {
  suggestions: IntakeSuggestion[]
  drafts: TextDraft[]
  busy: boolean
  onAccept: (id: string) => void
  onDismiss: (id: string) => void
  onSend: (id: string, text?: string) => void
  onDiscard: (id: string) => void
}

const QUOTE_CLASS = 'whitespace-pre-wrap border-l-2 border-border pl-2 text-xs text-muted-foreground'

function SuggestionRow(props: {
  suggestion: IntakeSuggestion
  busy: boolean
  onAccept: (id: string) => void
  onDismiss: (id: string) => void
}): React.JSX.Element {
  const { suggestion } = props
  return (
    <li className="space-y-1 rounded-md border border-border p-2">
      <p className="text-xs font-medium text-foreground">{suggestion.title}</p>
      <p className="text-xs text-muted-foreground">
        From {suggestion.contactName} ({suggestion.contactHandle})
      </p>
      <blockquote className={QUOTE_CLASS}>{suggestion.text}</blockquote>
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={props.busy} onClick={() => props.onAccept(suggestion.id)}>
          Accept
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={props.busy}
          onClick={() => props.onDismiss(suggestion.id)}
        >
          Dismiss
        </Button>
      </div>
    </li>
  )
}

function DraftRow(props: {
  draft: TextDraft
  busy: boolean
  onSend: (id: string, text?: string) => void
  onDiscard: (id: string) => void
}): React.JSX.Element {
  const { draft } = props
  const [text, setText] = useState(draft.text)
  const sending = draft.status === 'sending'
  return (
    <li className="space-y-1 rounded-md border border-border p-2">
      <p className="text-xs font-medium text-foreground">
        To {draft.toName} ({draft.toHandle})
      </p>
      <textarea
        aria-label={`Text to ${draft.toName}`}
        className="w-full rounded-md border border-border bg-transparent p-2 text-xs text-foreground"
        rows={3}
        maxLength={1000}
        value={text}
        disabled={props.busy || sending}
        onChange={(event) => setText(event.target.value)}
      />
      {draft.status === 'failed' && draft.error ? (
        <p className="text-xs text-destructive">Not sent: {draft.error}</p>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={props.busy || sending || !text.trim()}
          onClick={() => props.onSend(draft.id, text === draft.text ? undefined : text)}
        >
          {sending ? 'Sending…' : 'Send'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={props.busy || sending}
          onClick={() => props.onDiscard(draft.id)}
        >
          Discard
        </Button>
      </div>
    </li>
  )
}

/** "From texts": suggested cards and ADAM's drafts. Nothing happens without a click here. */
export function TextIntakeReviewList(props: Props): React.JSX.Element {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Suggested tasks from texts</Label>
        <p className="text-xs text-muted-foreground">
          Accept puts the card in the Backlog with the text quoted. Nothing reaches the board without Accept.
        </p>
        {props.suggestions.length === 0 ? (
          <p className="text-xs text-muted-foreground">No suggestions waiting.</p>
        ) : (
          <ul className="space-y-2">
            {props.suggestions.map((suggestion) => (
              <SuggestionRow key={suggestion.id} suggestion={suggestion} {...props} />
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-1.5">
        <Label>Texts ADAM drafted</Label>
        <p className="text-xs text-muted-foreground">
          Check the person and the words. A text only goes out when you click Send.
        </p>
        {props.drafts.length === 0 ? (
          <p className="text-xs text-muted-foreground">No drafts waiting.</p>
        ) : (
          <ul className="space-y-2">
            {props.drafts.map((draft) => (
              <DraftRow key={`${draft.id}:${draft.status}`} draft={draft} {...props} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
