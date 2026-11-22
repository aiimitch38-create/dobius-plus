import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../../store'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { CLOUD_JOB_LABELS, cloudJobBoardNotice } from '../../../../shared/cloud-job-projection'
import type { CloudJob } from '../../../../shared/cloud-jobs'
import {
  ConfirmationDialogProvider,
  useConfirmationDialog,
  useOptionalConfirmationDialog
} from '@/components/confirmation-dialog'
import { translate } from '@/i18n/i18n'
import {
  parseCloudJobWriteResult,
  sendCloudJobSubmission,
  type CloudJobActionSource
} from './cloud-job-actions'
import { createCloudJobSource } from './cloud-job-source'
import {
  loadCloudJobAuthority,
  saveCloudJobAuthority,
  resolveCloudJobAuthority
} from './cloud-job-authority-selection'
import { useCloudJobBoard } from './use-cloud-job-board'
import { KanbanJobCard } from './KanbanJobCard'
import { KanbanJobDetailPanel } from './KanbanJobDetailPanel'
import {
  KanbanJobSubmitPanel,
  submitFieldsFrom,
  type KanbanJobSubmitFields,
  type KanbanJobSubmitWork
} from './KanbanJobSubmitPanel'

type JobAction = { kind: 'submit' } | { kind: 'cancel' | 'retry'; jobId: string }

type KanbanJobLanesProps = { source?: CloudJobActionSource }

export function KanbanJobLanes(props: KanbanJobLanesProps = {}) {
  // Why: the standalone kanban preview window has no app-level provider; the
  // real app does, and its single dialog stack should be reused there.
  const appConfirm = useOptionalConfirmationDialog()
  if (appConfirm) {
    return <JobLanes {...props} />
  }
  return (
    <ConfirmationDialogProvider>
      <JobLanes {...props} />
    </ConfirmationDialogProvider>
  )
}

function JobLanes({ source: injected }: KanbanJobLanesProps) {
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
  const confirm = useConfirmationDialog()
  const [draft, setDraft] = useState<{
    key: string
    fromTemplate: boolean
    fields: KanbanJobSubmitFields
  } | null>(null)
  const [action, setAction] = useState<JobAction | null>(null)
  const [actionError, setActionError] = useState<{ key: string; message: string } | null>(null)
  // Why: state updates land after the click handler returns, so a fast double
  // click (or a click while a confirm is open) is stopped by this ref, not by
  // the disabled prop alone. One action at a time across the whole board.
  const actionRef = useRef<JobAction | null>(null)
  const sourceRef = useRef(source)
  sourceRef.current = source
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  const writer = source?.write ? source : null
  const canWrite = !!writer && state.phase === 'ready'

  async function runAction(
    next: JobAction,
    send: (write: NonNullable<CloudJobActionSource['write']>) => Promise<unknown>,
    confirmFirst: (() => Promise<boolean>) | null,
    onDone?: (job: CloudJob) => void
  ): Promise<void> {
    const owner = sourceRef.current
    if (!owner?.write || actionRef.current) {
      return
    }
    actionRef.current = next
    setAction(next)
    setActionError(null)
    try {
      if (confirmFirst && !(await confirmFirst())) {
        return
      }
      // Why: the authority may have been switched while the confirm was open;
      // never send the confirmed change to a different VPS.
      if (!mountedRef.current || sourceRef.current !== owner || !owner.write) {
        return
      }
      const changed = parseCloudJobWriteResult(await send(owner.write))
      if (mountedRef.current && sourceRef.current === owner) {
        onDone?.(changed)
        refresh()
      }
    } catch (error) {
      if (mountedRef.current && sourceRef.current === owner) {
        setActionError({
          key: owner.key,
          message:
            error instanceof Error
              ? error.message
              : translate('auto.components.kanban.KanbanJobLanes.f33e62a9fc', 'The job request failed. Refresh to check its state.')
        })
      }
    } finally {
      actionRef.current = null
      if (mountedRef.current) {
        setAction(null)
      }
    }
  }

  const cancelJob = (target: CloudJob): void => {
    void runAction({ kind: 'cancel', jobId: target.id }, (write) =>
      write('jobs.cancel', { id: target.id, version: target.version })
    , null)
  }

  const retryJob = (target: CloudJob): void => {
    void runAction(
      { kind: 'retry', jobId: target.id },
      (write) => write('jobs.retry', { id: target.id, version: target.version }),
      () =>
        confirm({
          title: translate('auto.components.kanban.KanbanJobLanes.3e9b5963fa', 'Retry this job?'),
          description: translate(
            'auto.components.kanban.KanbanJobLanes.2156aa4f9d',
            'The job goes back in the queue and runs again on the job host. That can cost money.'
          ),
          details: [target.title, target.id],
          confirmLabel: translate('auto.components.kanban.KanbanJobLanes.b080c51ede', 'Retry job')
        })
    )
  }

  const submitJob = async (work: KanbanJobSubmitWork): Promise<void> => {
    const owner = sourceRef.current
    if (!owner) {
      return
    }
    await runAction(
      { kind: 'submit' },
      async (write) => ({
        job: await sendCloudJobSubmission(
          owner.key,
          work,
          (input) => write('jobs.submit', input),
          {
            inFlight: translate(
              'auto.components.kanban.KanbanJobLanes.4a16082b1c',
              'This job is already being submitted. Wait for it, then refresh.'
            ),
            tooMany: translate(
              'auto.components.kanban.KanbanJobLanes.5c06c9c3d1',
              'Too many submissions are still unconfirmed. Refresh the board and check them first.'
            )
          }
        )
      }),
      () =>
        confirm({
          title: translate('auto.components.kanban.KanbanJobLanes.0d47e73c5f', 'Submit this job?'),
          description: translate(
            'auto.components.kanban.KanbanJobLanes.696a494a64',
            'This starts work on the job host as soon as a worker is free. That can cost money.'
          ),
          details: [work.title, work.targetDeviceId, work.recipeId, work.sourceRevision],
          confirmLabel: translate('auto.components.kanban.KanbanJobLanes.62fbd4bdce', 'Submit job')
        }),
      (created) => {
        setDraft(null)
        setSelected({ key: owner.key, id: created.id })
      }
    )
  }

  const busyFor = (target: CloudJob): 'cancel' | 'retry' | 'other' | null =>
    !action
      ? null
      : action.kind !== 'submit' && action.jobId === target.id
        ? action.kind
        : 'other'
  const submitOpen = canWrite && source && draft?.key === source.key ? draft : null
  const visibleActionError =
    actionError && source && actionError.key === source.key ? actionError.message : null
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
        {writer ? (
          <Button
            size="sm"
            onClick={() =>
              source &&
              setDraft({
                key: source.key,
                fromTemplate: !!job,
                fields: submitFieldsFrom(job ?? null)
              })
            }
            disabled={!canWrite || action !== null}
          >
            {translate('auto.components.kanban.KanbanJobLanes.6b140ef6ba', 'New job')}
          </Button>
        ) : null}
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
      {storageError || state.error || visibleActionError ? (
        <p role="alert" className="px-4 py-2 text-xs text-destructive">
          {storageError ?? state.error ?? visibleActionError}
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
        {submitOpen ? (
          <KanbanJobSubmitPanel
            fromTemplate={submitOpen.fromTemplate}
            fields={submitOpen.fields}
            onFieldsChange={(fields) =>
              setDraft((current) => (current ? { ...current, fields } : current))
            }
            busy={action?.kind === 'submit'}
            onSubmit={submitJob}
            onClose={() => setDraft(null)}
          />
        ) : job ? (
          <KanbanJobDetailPanel
            job={job}
            onClose={() => setSelected(null)}
            actions={
              canWrite
                ? {
                    busy: busyFor(job),
                    onCancel: () => cancelJob(job),
                    onRetry: () => retryJob(job)
                  }
                : undefined
            }
          />
        ) : null}
      </div>
    </div>
  )
}
