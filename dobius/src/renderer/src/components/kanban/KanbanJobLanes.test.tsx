// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { KanbanJobLanes } from './KanbanJobLanes'
import { CLOUD_JOB_LABELS, type CloudJobReadSource } from '../../../../shared/cloud-job-projection'
import type { CloudJob } from '../../../../shared/cloud-jobs'
vi.mock('../../store', () => ({
  useAppStore: (select: (state: unknown) => unknown) => select({ runtimeEnvironments: [] })
}))
afterEach(cleanup)
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
