import type { CloudJob } from '../../../../shared/cloud-jobs'
import { CLOUD_JOB_LABELS } from '../../../../shared/cloud-job-projection'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { canCancelCloudJob, canRetryCloudJob } from './cloud-job-actions'

export type KanbanJobDetailActions = {
  /** Which action on this job is in flight, if any; every action button disables while one runs. */
  busy: 'cancel' | 'retry' | 'other' | null
  onCancel: () => void
  onRetry: () => void
}

export function KanbanJobDetailPanel({
  job,
  onClose,
  actions
}: {
  job: CloudJob
  onClose: () => void
  /** Omitted for read-only sources: no lifecycle buttons are shown. */
  actions?: KanbanJobDetailActions
}) {
  const showCancel = !!actions && canCancelCloudJob(job)
  const showRetry = !!actions && canRetryCloudJob(job)
  return (
    <aside
      aria-label="Job details"
      className="scrollbar-sleek min-w-0 w-80 shrink-0 overflow-auto border-l border-border bg-card p-4 text-card-foreground"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 flex-1 break-words text-sm font-semibold">{job.title}</h2>
        <Button variant="ghost" size="sm" className="shrink-0" onClick={onClose}>
          Close
        </Button>
      </div>
      <p className="mt-3 text-sm">{CLOUD_JOB_LABELS[job.state]}</p>
      {actions && (showCancel || showRetry) ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {showRetry ? (
            <Button size="sm" onClick={actions.onRetry} disabled={actions.busy !== null}>
              {actions.busy === 'retry'
                ? translate('auto.components.kanban.KanbanJobDetailPanel.76b0536916', 'Retrying…')
                : translate('auto.components.kanban.KanbanJobDetailPanel.9c61963fa2', 'Retry job')}
            </Button>
          ) : null}
          {showCancel ? (
            <Button
              size="sm"
              variant="outline"
              onClick={actions.onCancel}
              disabled={actions.busy !== null}
            >
              {actions.busy === 'cancel'
                ? translate('auto.components.kanban.KanbanJobDetailPanel.e8d63495b4', 'Cancelling…')
                : translate('auto.components.kanban.KanbanJobDetailPanel.1dc9ab3828', 'Cancel job')}
            </Button>
          ) : null}
        </div>
      ) : null}
      <dl className="mt-3 min-w-0 space-y-2 text-xs">
        {[
          ['Job', job.id],
          ['Task', job.taskId],
          ['Workspace', job.workspaceId],
          ['Project', job.projectId],
          ['Target', job.targetDeviceId],
          ['Recipe', job.recipeId],
          ['Source', job.sourceRevision],
          ['Version', job.version],
          ['Attempts', job.attemptCount]
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="max-w-full break-all whitespace-pre-wrap font-mono">{value}</dd>
          </div>
        ))}
      </dl>
      {job.waitingReason ? <p className="mt-3 break-words text-xs">{job.waitingReason}</p> : null}
      {job.state === 'needs_review' ? (
        <p className="mt-3 text-xs">Independent verification is required before Done.</p>
      ) : null}
      {job.state === 'cancelled' ? (
        <p className="mt-3 text-xs">
          Cancellation was requested. This record does not confirm process cleanup.
        </p>
      ) : null}
      {job.state === 'interrupted' ? (
        <p className="mt-3 text-xs">Worker reconciliation is required.</p>
      ) : null}
      {job.outcome ? (
        <p className="mt-3 break-words whitespace-pre-wrap text-xs">{job.outcome}</p>
      ) : null}
      <h3 className="mt-4 text-xs font-semibold">Evidence references</h3>
      {job.evidence.length ? (
        job.evidence.map((entry, index) => (
          <p key={index} className="mt-2 break-all whitespace-pre-wrap font-mono text-xs">
            {entry}
          </p>
        ))
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">No evidence references recorded.</p>
      )}
    </aside>
  )
}
