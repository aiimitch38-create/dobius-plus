import { useMemo, useState } from 'react'
import { useAppStore } from '../../store'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  CLOUD_JOB_LABELS,
  cloudJobBoardNotice,
  type CloudJobReadSource
} from '../../../../shared/cloud-job-projection'
import type { CloudJob } from '../../../../shared/cloud-jobs'
import { createCloudJobSource } from './cloud-job-source'
import {
  loadCloudJobAuthority,
  saveCloudJobAuthority,
  resolveCloudJobAuthority
} from './cloud-job-authority-selection'
import { useCloudJobBoard } from './use-cloud-job-board'
import { KanbanJobCard } from './KanbanJobCard'
import { KanbanJobDetailPanel } from './KanbanJobDetailPanel'
export function KanbanJobLanes({ source: injected }: { source?: CloudJobReadSource } = {}) {
  const environments = useAppStore((s) => s.runtimeEnvironments)
  const [authorityId, setAuthorityId] = useState(() => loadCloudJobAuthority(localStorage))
  const [storageError, setStorageError] = useState<string | null>(null)
  const target = useMemo(
    () => resolveCloudJobAuthority(authorityId, environments),
    [authorityId, environments]
  )
  const source = useMemo(
    () => injected ?? (target ? createCloudJobSource(target) : null),
    [injected, target]
  )
  const { state, refresh } = useCloudJobBoard(source)
  const [selected, setSelected] = useState<{ key: string; id: string } | null>(null)
  const job =
    selected?.key === source?.key ? state.jobs.find((item) => item.id === selected?.id) : undefined
  const notice = cloudJobBoardNotice(state)
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-3 border-b border-border p-3">
        <h1 className="text-sm font-semibold">Jobs</h1>
        {!injected ? (
          <Select
            value={target?.environmentId ?? ''}
            onValueChange={(id) => {
              try {
                saveCloudJobAuthority(localStorage, id)
                setStorageError(null)
                setAuthorityId(id)
              } catch {
                setStorageError(
                  'Unable to save job authority. Choose it again when device storage is available.'
                )
              }
            }}
          >
            <SelectTrigger className="w-56" aria-label="VPS job authority">
              <SelectValue placeholder="Choose registered VPS" />
            </SelectTrigger>
            <SelectContent>
              {environments.map((environment) => (
                <SelectItem key={environment.id} value={environment.id}>
                  {environment.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={!source || state.phase === 'loading'}
        >
          Refresh
        </Button>
        {state.updatedAt !== null ? (
          <span className="text-xs text-muted-foreground">
            Updated {new Date(state.updatedAt).toLocaleTimeString()}
          </span>
        ) : null}
      </header>
      {notice ? (
        <p role="status" className="border-b border-border px-4 py-3 text-xs">
          {notice}
        </p>
      ) : null}
      {storageError || state.error ? (
        <p role="alert" className="px-4 py-2 text-xs text-destructive">
          {storageError ?? state.error}
        </p>
      ) : null}
      {!source && !environments.length ? (
        <p className="p-4 text-sm">Register the VPS in runtime settings, then choose it here.</p>
      ) : null}
      {state.phase === 'ready' && !state.jobs.length ? (
        <p className="p-4 text-sm">No jobs available to this client.</p>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <div className="scrollbar-sleek flex min-h-0 flex-1 gap-3 overflow-auto p-3">
          {(Object.keys(CLOUD_JOB_LABELS) as CloudJob['state'][]).map((status) => (
            <section
              key={status}
              aria-label={CLOUD_JOB_LABELS[status]}
              className="w-64 shrink-0 rounded-lg border border-border bg-muted/30 p-2"
            >
              <h2 className="mb-3 px-1 text-xs font-semibold">
                {CLOUD_JOB_LABELS[status]} ·{' '}
                {state.jobs.filter((item) => item.state === status).length}
              </h2>
              <div className="space-y-2">
                {state.jobs
                  .filter((item) => item.state === status)
                  .map((item) => (
                    <KanbanJobCard
                      key={item.id}
                      job={item}
                      onOpen={() => source && setSelected({ key: source.key, id: item.id })}
                    />
                  ))}
              </div>
            </section>
          ))}
        </div>
        {job ? <KanbanJobDetailPanel job={job} onClose={() => setSelected(null)} /> : null}
      </div>
    </div>
  )
}
