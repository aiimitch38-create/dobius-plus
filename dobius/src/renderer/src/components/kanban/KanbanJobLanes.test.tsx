// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react'
import { KanbanJobLanes } from './KanbanJobLanes'
import { CLOUD_JOB_LABELS, type CloudJobReadSource } from '../../../../shared/cloud-job-projection'
import type { CloudJob } from '../../../../shared/cloud-jobs'
import { clearUnresolvedSubmissionsForTests } from './cloud-job-actions'
vi.mock('../../store', () => ({
  useAppStore: (select: (state: unknown) => unknown) =>
    select({ runtimeEnvironments: [], setContextualToursBlockingSurfaceVisible: () => {} })
}))
afterEach(() => {
  cleanup()
  clearUnresolvedSubmissionsForTests()
})
const jobs: CloudJob[] = (Object.keys(CLOUD_JOB_LABELS) as CloudJob['state'][]).map(
  (state, index) => ({
    id: `job-${state}`,
    requestKey: `intent-${state}`,
    taskId: 'shared-task',
    projectId: 'project',
    workspaceId: 'workspace',
    targetDeviceId: 'laptop',
    recipeId: 'build',
    title: `Work ${state}`,
    sourceRevision: 'a'.repeat(64),
    estimatedBytes: 1,
    dependencies: [],
    createdBy: 'phone',
    state,
    version: 1,
    createdAt: index,
    updatedAt: index,
    attemptCount: 1,
    waitingReason: state === 'waiting_for_worker' ? 'Laptop offline' : null,
    evidence: [],
    outcome: null
  })
)
function source(): CloudJobReadSource {
  return {
    key: 'environment:vps',
    read: vi.fn(async (method) =>
      method === 'jobs.status'
        ? {
            configured: true,
            generation: 'shared',
            dispatchEnabled: false,
            liveDispatchReady: false
          }
        : method === 'jobs.snapshot'
          ? { generation: 'shared', eventCursor: 0, jobs, nextCursor: null }
          : { generation: 'shared', resetRequired: false, events: [], nextCursor: 0 }
    )
  }
}
describe('actual job lanes in the board', () => {
  it('clears private cards and open details when access is denied on refresh', async () => {
    const api = source()
    render(<KanbanJobLanes source={api} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open job Work needs_review' }))
    expect(screen.getByLabelText('Job details')).toBeTruthy()
    vi.mocked(api.read).mockRejectedValueOnce(new Error('Cloud job access denied'))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await screen.findByText('Job access was denied. Cached data has been cleared.')
    expect(screen.queryByLabelText('Job details')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open job Work needs_review' })).toBeNull()
  })
  it('keeps typing focus when remote job data arrives', async () => {
    const api = source()
    render(
      <>
        <input aria-label="Independent editor" />
        <KanbanJobLanes source={api} />
      </>
    )
    const editor = screen.getByLabelText('Independent editor')
    editor.focus()
    await screen.findByRole('button', { name: 'Open job Work running' })
    expect(document.activeElement).toBe(editor)
  })
  it('renders all states and exact job/task identity without lifecycle writes or terminal focus', async () => {
    const api = source()
    render(<KanbanJobLanes source={api} />)
    await waitFor(() => expect(screen.getByText('Dispatch is paused.')).toBeTruthy())
    for (const state of Object.keys(CLOUD_JOB_LABELS)) {
      expect(screen.getByRole('button', { name: `Open job Work ${state}` })).toBeTruthy()
    }
    expect(document.querySelector('[draggable="true"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open job Work needs_review' }))
    expect(screen.getByLabelText('Job details').textContent).toContain('job-needs_review')
    expect(screen.getByLabelText('Job details').textContent).toContain('shared-task')
    expect(screen.getByLabelText('Job details').textContent).toContain('a'.repeat(64))
    expect(screen.getByText('Independent verification is required before Done.')).toBeTruthy()
    expect(
      (api.read as ReturnType<typeof vi.fn>).mock.calls.every(([method]) =>
        ['jobs.status', 'jobs.snapshot', 'jobs.events', 'jobs.get'].includes(method)
      )
    ).toBe(true)
    expect(screen.queryByRole('button', { name: /^(queue|cancel|retry|done)( job)?$/i })).toBeNull()
  })
  it('requires an explicit registered authority and never falls back to mocked jobs', () => {
    render(<KanbanJobLanes />)
    expect(screen.getByText('Choose the registered VPS authority to load jobs.')).toBeTruthy()
    expect(screen.queryByText('Work queued')).toBeNull()
  })
})

type WriteCall = [method: string, params: unknown]
function writableSource(write: (method: string, params: unknown) => Promise<unknown>) {
  const base = source()
  return { ...base, write: vi.fn(write) }
}
function byId(id: string): CloudJob {
  const job = jobs.find((item) => item.id === id)
  if (!job) {
    throw new Error(id)
  }
  return job
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function openJob(state: CloudJob['state']) {
  fireEvent.click(await screen.findByRole('button', { name: `Open job Work ${state}` }))
  return screen.getByLabelText('Job details')
}

describe('job lifecycle buttons', () => {
  it('offers only the actions the authority allows for each state', async () => {
    const api = writableSource(async () => ({ job: byId('job-failed') }))
    render(<KanbanJobLanes source={api} />)
    const failed = await openJob('failed')
    expect(within(failed).getByRole('button', { name: 'Retry job' })).toBeTruthy()
    expect(within(failed).getByRole('button', { name: 'Cancel job' })).toBeTruthy()
    const running = await openJob('running')
    expect(within(running).queryByRole('button', { name: 'Retry job' })).toBeNull()
    expect(within(running).getByRole('button', { name: 'Cancel job' })).toBeTruthy()
    for (const final of ['completed', 'cancelled'] as const) {
      const panel = await openJob(final)
      expect(within(panel).queryByRole('button', { name: /job$/ })).toBeNull()
    }
    expect(api.write).not.toHaveBeenCalled()
  })

  it('cancels without a confirm, sends the shown version, and disables every action in flight', async () => {
    const reply = deferred<unknown>()
    const api = writableSource(() => reply.promise)
    render(<KanbanJobLanes source={api} />)
    const panel = await openJob('failed')
    const readsBefore = vi.mocked(api.read).mock.calls.length
    fireEvent.click(within(panel).getByRole('button', { name: 'Cancel job' }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Cancelling…' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.write).toHaveBeenCalledTimes(1)
    expect(api.write.mock.calls[0] as WriteCall).toEqual([
      'jobs.cancel',
      { id: 'job-failed', version: 1 }
    ])
    expect(
      (within(panel).getByRole('button', { name: 'Cancelling…' }) as HTMLButtonElement).disabled
    ).toBe(true)
    expect(
      (within(panel).getByRole('button', { name: 'Retry job' }) as HTMLButtonElement).disabled
    ).toBe(true)
    expect((screen.getByRole('button', { name: 'New job' }) as HTMLButtonElement).disabled).toBe(
      true
    )
    reply.resolve({ job: { ...byId('job-failed'), state: 'cancelled', version: 2 } })
    await waitFor(() =>
      expect(
        (within(panel).getByRole('button', { name: 'Cancel job' }) as HTMLButtonElement).disabled
      ).toBe(false)
    )
    await waitFor(() =>
      expect(vi.mocked(api.read).mock.calls.length).toBeGreaterThan(readsBefore)
    )
  })

  it('asks before retrying; declining sends nothing, confirming sends one retry', async () => {
    const api = writableSource(async () => ({
      job: { ...byId('job-interrupted'), state: 'queued', version: 2 }
    }))
    render(<KanbanJobLanes source={api} />)
    const panel = await openJob('interrupted')
    fireEvent.click(within(panel).getByRole('button', { name: 'Retry job' }))
    let dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('Retry this job?')
    expect(dialog.textContent).toContain('job-interrupted')
    // Why: the open dialog marks the page aria-hidden, so query hidden nodes too.
    expect(
      (
        within(panel).getByRole('button', {
          name: 'Retrying…',
          hidden: true
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(
        (within(panel).getByRole('button', { name: 'Retry job' }) as HTMLButtonElement).disabled
      ).toBe(false)
    )
    expect(api.write).not.toHaveBeenCalled()
    fireEvent.click(within(panel).getByRole('button', { name: 'Retry job' }))
    dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry job' }))
    await waitFor(() => expect(api.write).toHaveBeenCalledTimes(1))
    expect(api.write.mock.calls[0] as WriteCall).toEqual([
      'jobs.retry',
      { id: 'job-interrupted', version: 1 }
    ])
  })

  it('shows the authority refusal and leaves the buttons usable', async () => {
    const api = writableSource(async () => {
      throw new Error('Job changed; refresh before cancelling.')
    })
    render(<KanbanJobLanes source={api} />)
    const panel = await openJob('running')
    fireEvent.click(within(panel).getByRole('button', { name: 'Cancel job' }))
    expect(await screen.findByText('Job changed; refresh before cancelling.')).toBeTruthy()
    expect(
      (within(panel).getByRole('button', { name: 'Cancel job' }) as HTMLButtonElement).disabled
    ).toBe(false)
  })

  it('submits a new job from the open one only after confirming, reusing the request key', async () => {
    const reply = deferred<unknown>()
    const api = writableSource(() => reply.promise)
    render(<KanbanJobLanes source={api} />)
    await openJob('failed')
    fireEvent.click(screen.getByRole('button', { name: 'New job' }))
    const form = screen.getByLabelText('New job')
    expect((within(form).getByDisplayValue('Work failed') as HTMLInputElement).value).toBe(
      'Work failed'
    )
    fireEvent.click(within(form).getByRole('button', { name: 'Submit job' }))
    let dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('Submit this job?')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(api.write).not.toHaveBeenCalled()

    fireEvent.click(within(form).getByRole('button', { name: 'Submit job' }))
    dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit job' }))
    await waitFor(() => expect(api.write).toHaveBeenCalledTimes(1))
    const [method, params] = api.write.mock.calls[0] as WriteCall
    expect(method).toBe('jobs.submit')
    expect(params).toMatchObject({
      title: 'Work failed',
      taskId: 'shared-task',
      projectId: 'project',
      workspaceId: 'workspace',
      targetDeviceId: 'laptop',
      recipeId: 'build',
      sourceRevision: 'a'.repeat(64),
      estimatedBytes: 1,
      dependencies: []
    })
    expect((params as { requestKey: string }).requestKey).toMatch(/^board-/)
    const submitting = within(form).getByRole('button', { name: 'Submitting…' })
    expect((submitting as HTMLButtonElement).disabled).toBe(true)
    reply.resolve({ job: { ...byId('job-queued'), id: 'job-new', title: 'Work failed' } })
    await waitFor(() => expect(screen.queryByLabelText('New job')).toBeNull())
  })

  it('reuses the request key for unchanged work and makes a new one after an edit', async () => {
    const api = writableSource(async () => {
      throw new Error('timed out')
    })
    render(<KanbanJobLanes source={api} />)
    await openJob('failed')
    fireEvent.click(screen.getByRole('button', { name: 'New job' }))
    const form = screen.getByLabelText('New job')
    const send = async () => {
      fireEvent.click(within(form).getByRole('button', { name: 'Submit job' }))
      const dialog = await screen.findByRole('dialog')
      fireEvent.click(within(dialog).getByRole('button', { name: 'Submit job' }))
      await screen.findByText('timed out')
      await waitFor(() =>
        expect(
          (within(form).getByRole('button', { name: 'Submit job' }) as HTMLButtonElement).disabled
        ).toBe(false)
      )
    }
    await send()
    await send()
    fireEvent.change(within(form).getByDisplayValue('Work failed'), {
      target: { value: 'Work failed v2' }
    })
    await send()
    const keys = api.write.mock.calls.map(
      (call) => ((call as WriteCall)[1] as { requestKey: string }).requestKey
    )
    expect(keys[0]).toBe(keys[1])
    expect(keys[2]).not.toBe(keys[0])
  })

  it('keeps the request key after a lost reply even when the form is closed and reopened', async () => {
    const api = writableSource(async () => {
      throw new Error('timed out')
    })
    const view = render(<KanbanJobLanes source={api} />)
    const sendOnce = async () => {
      await openJob('failed')
      fireEvent.click(screen.getByRole('button', { name: 'New job' }))
      const form = screen.getByLabelText('New job')
      fireEvent.click(within(form).getByRole('button', { name: 'Submit job' }))
      const dialog = await screen.findByRole('dialog')
      fireEvent.click(within(dialog).getByRole('button', { name: 'Submit job' }))
      await screen.findByText('timed out')
      await waitFor(() =>
        expect(
          (within(form).getByRole('button', { name: 'Submit job' }) as HTMLButtonElement).disabled
        ).toBe(false)
      )
      fireEvent.click(within(form).getByRole('button', { name: 'Close' }))
    }
    await sendOnce()
    view.unmount()
    render(<KanbanJobLanes source={api} />)
    await sendOnce()
    const keys = api.write.mock.calls.map(
      (call) => ((call as WriteCall)[1] as { requestKey: string }).requestKey
    )
    expect(keys).toHaveLength(2)
    expect(keys[1]).toBe(keys[0])
  })

  it('refuses an invalid form without asking or sending', async () => {
    const api = writableSource(async () => ({ job: byId('job-queued') }))
    render(<KanbanJobLanes source={api} />)
    await openJob('failed')
    fireEvent.click(screen.getByRole('button', { name: 'New job' }))
    const form = screen.getByLabelText('New job')
    fireEvent.change(within(form).getByDisplayValue('a'.repeat(64)), {
      target: { value: 'not-a-sha' }
    })
    fireEvent.click(within(form).getByRole('button', { name: 'Submit job' }))
    expect(within(form).getByRole('alert').textContent).toContain('Source commit (full SHA)')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.write).not.toHaveBeenCalled()
  })
})
