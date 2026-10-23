import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileCloudJobBoard } from './MobileCloudJobBoard'
import { CLOUD_JOB_LABELS, type CloudJobReadSource } from '../../../src/shared/cloud-job-projection'
vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (value: unknown) => value }
}))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }))
vi.mock('../transport/client-context', () => ({
  useHostClient: () => ({ client: null, state: 'connected' })
}))
let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})
const job = {
  id: 'job-needs_review',
  taskId: 'shared-task',
  requestKey: 'intent',
  projectId: 'project',
  workspaceId: 'workspace',
  targetDeviceId: 'laptop',
  recipeId: 'build',
  title: 'Work needs_review',
  sourceRevision: 'a'.repeat(40),
  estimatedBytes: 1,
  dependencies: [],
  createdBy: 'phone',
  state: 'needs_review',
  version: 2,
  createdAt: 1,
  updatedAt: 2,
  attemptCount: 1,
  waitingReason: null,
  evidence: [],
  outcome: null
}
describe('phone execution board', () => {
  it('maps every service state to its own lane without manual completion controls', async () => {
    const jobs = Object.keys(CLOUD_JOB_LABELS).map((state) => ({
      ...job,
      id: `job-${state}`,
      state,
      title: `Work ${state}`
    }))
    const source: CloudJobReadSource = {
      key: 'host:vps',
      read: async (method) =>
        method === 'jobs.status'
          ? {
              configured: true,
              generation: 'all',
              dispatchEnabled: false,
              liveDispatchReady: false
            }
          : method === 'jobs.snapshot'
            ? { generation: 'all', eventCursor: 0, jobs, nextCursor: null }
            : { generation: 'all', resetRequired: false, events: [], nextCursor: 0 }
    }
    await act(async () => {
      renderer = create(
        createElement(MobileCloudJobBoard, { hostId: 'vps', source, onBack: vi.fn() })
      )
    })
    for (const state of Object.keys(CLOUD_JOB_LABELS)) {
      expect(
        renderer?.root.findByProps({ accessibilityLabel: `Open job Work ${state}` })
      ).toBeTruthy()
    }
    const output = JSON.stringify(renderer?.toJSON())
    for (const label of Object.values(CLOUD_JOB_LABELS)) {
      expect(output).toContain(label)
    }
    expect(output).not.toContain('Mark done')
  })
  it('shows matched job/task identities and review status using read APIs only', async () => {
    const read = vi.fn(async (method) =>
      method === 'jobs.status'
        ? {
            configured: true,
            generation: 'shared',
            dispatchEnabled: false,
            liveDispatchReady: false
          }
        : method === 'jobs.snapshot'
          ? { generation: 'shared', eventCursor: 0, jobs: [job], nextCursor: null }
          : { generation: 'shared', resetRequired: false, events: [], nextCursor: 0 }
    )
    const source: CloudJobReadSource = { key: 'host:vps', read }
    await act(async () => {
      renderer = create(
        createElement(MobileCloudJobBoard, { hostId: 'vps', source, onBack: vi.fn() })
      )
    })
    act(() =>
      renderer?.root
        .findByProps({ accessibilityLabel: 'Open job Work needs_review' })
        .props.onPress()
    )
    const output = JSON.stringify(renderer?.toJSON())
    expect(output).toContain('job-needs_review')
    expect(output).toContain('shared-task')
    expect(output).toContain('Independent verification is required before Done.')
    expect(output).toContain('Dispatch is paused.')
    expect(
      read.mock.calls.every(([method]) =>
        ['jobs.status', 'jobs.snapshot', 'jobs.events', 'jobs.get'].includes(method)
      )
    ).toBe(true)
    expect(output).not.toContain('Queue job')
    expect(output).not.toContain('Retry job')
  })
})
