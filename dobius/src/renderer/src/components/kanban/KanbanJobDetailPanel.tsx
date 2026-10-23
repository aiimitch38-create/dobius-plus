import type { CloudJob } from '../../../../shared/cloud-jobs'
import { CLOUD_JOB_LABELS } from '../../../../shared/cloud-job-projection'
import { Button } from '@/components/ui/button'
export function KanbanJobDetailPanel({ job, onClose }: { job: CloudJob; onClose: () => void }) {
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
