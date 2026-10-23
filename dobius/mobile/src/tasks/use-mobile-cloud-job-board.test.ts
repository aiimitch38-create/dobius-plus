import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMobileCloudJobBoard } from './use-mobile-cloud-job-board'
import type { CloudJobReadSource } from '../../../src/shared/cloud-job-projection'
let renderer: ReactTestRenderer | null = null
let current: ReturnType<typeof useMobileCloudJobBoard>
function Harness({ source }: { source: CloudJobReadSource | null }) {
  current = useMobileCloudJobBoard(source)
  return null
}
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})
describe('phone job host lifecycle', () => {
  it('rejects a delayed old-host response after host route reuse', async () => {
    let release!: (value: unknown) => void
    const old = {
      key: 'host:old',
      read: vi.fn(
        () =>
          new Promise((resolve) => {
            release = resolve
          })
      )
    }
    const next = {
      key: 'host:new',
      read: vi.fn(async () => ({
        configured: false,
        dispatchEnabled: false,
        liveDispatchReady: false
      }))
    }
    await act(async () => {
      renderer = create(createElement(Harness, { source: old }))
    })
    await act(async () => {
      renderer?.update(createElement(Harness, { source: next }))
    })
    expect(current.state.phase).toBe('unconfigured')
    await act(async () => {
      release({
        configured: true,
        generation: 'old',
        dispatchEnabled: true,
        liveDispatchReady: true
      })
      await Promise.resolve()
    })
    expect(current.state.phase).toBe('unconfigured')
    expect(current.state.jobs).toEqual([])
    expect(old.read).toHaveBeenCalledTimes(1)
  })
})
