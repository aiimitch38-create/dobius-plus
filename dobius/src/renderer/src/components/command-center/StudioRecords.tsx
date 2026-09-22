import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import type { StudioRecord } from './studio-state'

export function StudioRecords({
  kind,
  records,
  onChange
}: {
  kind: StudioRecord['kind']
  records: StudioRecord[]
  onChange: (records: StudioRecord[]) => void
}): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [filter, setFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const label = { mission: 'Missions', client: 'Clients', campaign: 'Campaigns' }[kind]
  const selected = records.find((record) => record.id === selectedId)
  const items = records.filter(
    (record) => record.kind === kind && record.title.toLowerCase().includes(filter.toLowerCase())
  )
  return (
    <div className="studio-records scrollbar-sleek">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{label}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Plan your work here. These are local drafts; external business sync and agent execution
          are not connected.
        </p>
      </div>
      <form
        className="mb-6 flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!title.trim()) {
            return
          }
          const id = crypto.randomUUID()
          onChange([...records, { id, kind, title: title.trim(), status: 'Planned', notes: '' }])
          setSelectedId(id)
          setTitle('')
        }}
      >
        <Input
          className="max-w-sm"
          aria-label={`New ${kind} name`}
          placeholder={`Name your ${kind}…`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Button type="submit" disabled={!title.trim()}>
          <Plus />
          Create draft
        </Button>
        <Input
          className="ml-auto max-w-xs"
          aria-label={`Search ${label.toLowerCase()}`}
          placeholder={`Search ${label.toLowerCase()}…`}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </form>
      <div className="studio-record-layout">
        <div className="studio-board">
          {(['Planned', 'In progress', 'Review', 'Done'] as const).map((status) => (
            <section key={status}>
              <div className="studio-section-title">
                {status}
                <span className="ml-auto">
                  {items.filter((record) => record.status === status).length}
                </span>
              </div>
              {items
                .filter((record) => record.status === status)
                .map((record) => (
                  <button
                    key={record.id}
                    className="studio-record"
                    data-selected={record.id === selectedId}
                    onClick={() => setSelectedId(record.id)}
                  >
                    <strong>{record.title}</strong>
                    <small>{record.notes || 'Add details…'}</small>
                  </button>
                ))}
              {!items.some((record) => record.status === status) && (
                <p className="p-3 text-xs text-muted-foreground">No {kind} drafts</p>
              )}
            </section>
          ))}
        </div>
        {selected && (
          <div className="studio-record-detail space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">Draft details</h2>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close draft details"
                onClick={() => setSelectedId(null)}
              >
                <X />
              </Button>
            </div>
            <Label htmlFor="record-name">Name</Label>
            <Input
              id="record-name"
              value={selected.title}
              onChange={(event) =>
                onChange(
                  records.map((record) =>
                    record.id === selected.id ? { ...record, title: event.target.value } : record
                  )
                )
              }
            />
            <Label>Status</Label>
            <Select
              value={selected.status}
              onValueChange={(status: StudioRecord['status']) =>
                onChange(
                  records.map((record) =>
                    record.id === selected.id ? { ...record, status } : record
                  )
                )
              }
            >
              <SelectTrigger aria-label="Draft status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['Planned', 'In progress', 'Review', 'Done'].map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Label htmlFor="record-notes">Notes</Label>
            <textarea
              id="record-notes"
              className="studio-textarea"
              value={selected.notes}
              onChange={(event) =>
                onChange(
                  records.map((record) =>
                    record.id === selected.id ? { ...record, notes: event.target.value } : record
                  )
                )
              }
            />
          </div>
        )}
      </div>
    </div>
  )
}
