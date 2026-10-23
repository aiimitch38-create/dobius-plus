import type { CloudJob } from '../../../../shared/cloud-jobs'
import { CLOUD_JOB_LABELS } from '../../../../shared/cloud-job-projection'
import { Card } from '@/components/ui/card'
export function KanbanJobCard({ job, onOpen }: { job: CloudJob; onOpen: () => void }) {
  return (
    <Card className="border-border bg-card p-0 text-card-foreground">
      <button
        type="button"
        aria-label={`Open job ${job.title}`}
        onClick={onOpen}
        className="w-full rounded-md p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <p className="text-[13px] font-semibold">{job.title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{CLOUD_JOB_LABELS[job.state]}</p>
        <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground">
          Task {job.taskId}
        </p>
        <p className="text-[11px] text-muted-foreground">Target {job.targetDeviceId}</p>
        {job.waitingReason ? <p className="mt-2 text-xs">{job.waitingReason}</p> : null}
      </button>
    </Card>
  )
}
