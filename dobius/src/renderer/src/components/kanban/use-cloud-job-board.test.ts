// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { createElement, StrictMode, type ReactNode } from 'react'
import { useCloudJobBoard } from './use-cloud-job-board'
import type { CloudJobReadSource } from '../../../../shared/cloud-job-projection'
afterEach(cleanup)
const source = (key: string): CloudJobReadSource => ({
  key,
  read: vi.fn(async (method, params) =>
    method === 'jobs.status'
      ? { configured: true, generation: key, dispatchEnabled: false, liveDispatchReady: false }
      : method === 'jobs.snapshot'
        ? { generation: key, eventCursor: 0, jobs: [], nextCursor: null }
        : {
            generation: key,
            resetRequired: false,
            events: [],
            nextCursor: (params as { after: number }).after
          }
  )
})
describe('desktop job reader lifecycle', () => {
  it('creates a live replacement reader under StrictMode effect replay', async () => {
    const api = source('strict')
    const { result } = renderHook(() => useCloudJobBoard(api), {
      wrapper: ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children)
    })
    await waitFor(() => expect(result.current.state.phase).toBe('ready'))
    expect(result.current.state.service?.generation).toBe('strict')
  })
  it('cancels old authority delivery and stops polling on unmount', async () => {
    let release!: (value: unknown) => void
    const old = {
      key: 'old',
      read: vi.fn(
        () =>
          new Promise((resolve) => {
            release = resolve
          })
      )
    }
    const next = source('new')
    const { result, rerender, unmount } = renderHook(({ value }) => useCloudJobBoard(value), {
      initialProps: { value: old as CloudJobReadSource }
    })
    rerender({ value: next })
    await waitFor(() => expect(result.current.state.phase).toBe('ready'))
    release({ configured: false, dispatchEnabled: false, liveDispatchReady: false })
    await waitFor(() => expect(result.current.state.service?.generation).toBe('new'))
    expect(old.read).toHaveBeenCalledTimes(1)
    unmount()
  })
  it('shows an explicit selection state without making any local call', () => {
    const { result } = renderHook(() => useCloudJobBoard(null))
    expect(result.current.state.phase).toBe('choose_authority')
  })
})
