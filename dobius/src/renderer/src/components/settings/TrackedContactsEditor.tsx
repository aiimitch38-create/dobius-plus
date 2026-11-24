import { useState } from 'react'
import type { TrackedContact } from '../../../../shared/text-intake'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'

type Props = {
  contacts: TrackedContact[]
  busy: boolean
  onSave: (contacts: TrackedContact[]) => void
}

/**
 * The people ADAM watches in Messages (7.17). Only texts from these handles
 * are read; everyone else is ignored. Remount with a new `key` to reset.
 */
export function TrackedContactsEditor({ contacts, busy, onSave }: Props): React.JSX.Element {
  const [rows, setRows] = useState<TrackedContact[]>(contacts)

  const edit = (index: number, patch: Partial<TrackedContact>): void =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const filled = rows.filter((row) => row.name.trim() && row.handle.trim())

  return (
    <div className="space-y-2">
      <Label>Tracked contacts</Label>
      <p className="text-xs text-muted-foreground">
        Only texts from these people are read. Texts from anyone else are ignored and never saved.
      </p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nobody is tracked yet.</p>
      ) : null}
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            aria-label="Contact name"
            className="w-40"
            placeholder="Name"
            maxLength={60}
            value={row.name}
            onChange={(event) => edit(index, { name: event.target.value })}
          />
          <Input
            aria-label="Contact phone or email"
            className="w-56"
            placeholder="+1 555 123 4567 or name@example.com"
            value={row.handle}
            onChange={(event) => edit(index, { handle: event.target.value })}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
          >
            Remove
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setRows((current) => [...current, { name: '', handle: '' }])}
        >
          Add contact
        </Button>
        <Button type="button" size="sm" disabled={busy} onClick={() => onSave(filled)}>
          Save contacts
        </Button>
      </div>
    </div>
  )
}
