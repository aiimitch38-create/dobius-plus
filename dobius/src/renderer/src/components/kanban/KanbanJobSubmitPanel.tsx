import { useState } from 'react'
import { CloudJobInput, type CloudJob } from '../../../../shared/cloud-jobs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'

export type KanbanJobSubmitFields = {
  title: string
  taskId: string
  projectId: string
  workspaceId: string
  targetDeviceId: string
  recipeId: string
  sourceRevision: string
  estimatedBytes: string
}

type Fields = KanbanJobSubmitFields

const FIELD_ORDER: (keyof Fields)[] = [
  'title',
  'taskId',
  'projectId',
  'workspaceId',
  'targetDeviceId',
  'recipeId',
  'sourceRevision',
  'estimatedBytes'
]

function fieldLabel(field: keyof Fields): string {
  switch (field) {
    case 'title':
      return translate('auto.components.kanban.KanbanJobSubmitPanel.411635dcd4', 'Title')
    case 'taskId':
      return translate('auto.components.kanban.KanbanJobSubmitPanel.9a9ce55549', 'Task ID')
    case 'projectId':
      return translate('auto.components.kanban.KanbanJobSubmitPanel.67078cdfc1', 'Project ID')
    case 'workspaceId':
      return translate('auto.components.kanban.KanbanJobSubmitPanel.f47f51a032', 'Workspace ID')
    case 'targetDeviceId':
      return translate('auto.components.kanban.KanbanJobSubmitPanel.da2a8e8345', 'Target device ID')
    case 'recipeId':
      return translate('auto.components.kanban.KanbanJobSubmitPanel.030cba8cb8', 'Recipe ID')
    case 'sourceRevision':
      return translate('auto.components.kanban.KanbanJobSubmitPanel.a71523bf4d', 'Source commit (full SHA)')
    case 'estimatedBytes':
      return translate('auto.components.kanban.KanbanJobSubmitPanel.c37322d131', 'Estimated size (bytes)')
  }
}

export function submitFieldsFrom(template: CloudJob | null): Fields {
  return {
    title: template?.title ?? '',
    taskId: template?.taskId ?? '',
    projectId: template?.projectId ?? '',
    workspaceId: template?.workspaceId ?? '',
    targetDeviceId: template?.targetDeviceId ?? '',
    recipeId: template?.recipeId ?? '',
    sourceRevision: template?.sourceRevision ?? '',
    estimatedBytes: String(template?.estimatedBytes ?? 0)
  }
}

export type KanbanJobSubmitWork = Omit<CloudJobInput, 'requestKey'>

// Why: the draft lives in KanbanJobLanes, not here, so a stale read that hides
// this panel does not throw away the user's fields. The request key is chosen
// by the caller at send time from the work itself (see cloud-job-actions.ts).
const WorkInput = CloudJobInput.omit({ requestKey: true })

export function KanbanJobSubmitPanel({
  fromTemplate,
  fields,
  onFieldsChange,
  busy,
  onSubmit,
  onClose
}: {
  fromTemplate: boolean
  fields: Fields
  onFieldsChange: (next: Fields) => void
  busy: boolean
  /** The caller confirms, sends and closes the panel on success. */
  onSubmit: (work: KanbanJobSubmitWork) => Promise<void>
  onClose: () => void
}): React.JSX.Element {
  const [invalid, setInvalid] = useState<string | null>(null)

  const update = (field: keyof Fields, value: string): void => {
    onFieldsChange({ ...fields, [field]: value })
    setInvalid(null)
  }

  const submit = (): void => {
    const bytes = fields.estimatedBytes.trim() === '' ? Number.NaN : Number(fields.estimatedBytes)
    const parsed = WorkInput.safeParse({
      title: fields.title,
      taskId: fields.taskId.trim(),
      projectId: fields.projectId.trim(),
      workspaceId: fields.workspaceId.trim(),
      targetDeviceId: fields.targetDeviceId.trim(),
      recipeId: fields.recipeId.trim(),
      sourceRevision: fields.sourceRevision.trim(),
      estimatedBytes: bytes,
      dependencies: []
    })
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0]
      setInvalid(
        typeof field === 'string' && (FIELD_ORDER as string[]).includes(field)
          ? translate('auto.components.kanban.KanbanJobSubmitPanel.15450a2fec', 'Check this field: {{field}}', {
              field: fieldLabel(field as keyof Fields)
            })
          : translate('auto.components.kanban.KanbanJobSubmitPanel.20986e15c9', 'Check the fields and try again.')
      )
      return
    }
    void onSubmit(parsed.data)
  }

  return (
    <aside
      aria-label={translate('auto.components.kanban.KanbanJobSubmitPanel.fcf36b820b', 'New job')}
      className="scrollbar-sleek min-w-0 w-80 shrink-0 overflow-auto border-l border-border bg-card p-4 text-card-foreground"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 flex-1 text-sm font-semibold">{translate('auto.components.kanban.KanbanJobSubmitPanel.fcf36b820b', 'New job')}</h2>
        <Button variant="ghost" size="sm" className="shrink-0" onClick={onClose} disabled={busy}>
          {translate('auto.components.kanban.KanbanJobSubmitPanel.4f8bf4a8e1', 'Close')}
        </Button>
      </div>
      {fromTemplate ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {translate(
            'auto.components.kanban.KanbanJobSubmitPanel.48d0d636e6',
            'Copied from the open job. Check every field before you submit.'
          )}
        </p>
      ) : null}
      <form
        className="mt-3 space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        {FIELD_ORDER.map((field) => (
          <label key={field} className="block space-y-1 text-xs">
            <span className="text-muted-foreground">{fieldLabel(field)}</span>
            <Input
              value={fields[field]}
              onChange={(event) => update(field, event.target.value)}
              inputMode={field === 'estimatedBytes' ? 'numeric' : undefined}
              className={field === 'title' ? 'h-8 text-xs' : 'h-8 font-mono text-xs'}
              disabled={busy}
            />
          </label>
        ))}
        {invalid ? (
          <p role="alert" className="text-xs text-destructive">
            {invalid}
          </p>
        ) : null}
        <Button type="submit" size="sm" className="w-full" disabled={busy}>
          {busy ? translate('auto.components.kanban.KanbanJobSubmitPanel.862be3cd6b', 'Submitting…') : translate('auto.components.kanban.KanbanJobSubmitPanel.2bb961bcd6', 'Submit job')}
        </Button>
      </form>
    </aside>
  )
}
