import { describe, expect, it } from 'vitest'
import { createTrayActionQueue } from './tray-action-queue'

describe('createTrayActionQueue', () => {
  it('starts empty', () => {
    const queue = createTrayActionQueue()
    expect(queue.size()).toBe(0)
    expect(queue.takeAll()).toEqual([])
  })

  it('takeAll drains the queue in FIFO order', () => {
    const queue = createTrayActionQueue()
    queue.enqueue({ kind: 'newChannel' })
    queue.enqueue({ kind: 'openChannel', channelId: 'chan-1' })
    expect(queue.takeAll()).toEqual([
      { kind: 'newChannel' },
      { kind: 'openChannel', channelId: 'chan-1' }
    ])
    expect(queue.size()).toBe(0)
    expect(queue.takeAll()).toEqual([])
  })

  it('requeue puts actions back ahead of anything enqueued since', () => {
    const queue = createTrayActionQueue()
    const taken = [{ kind: 'openChannel' as const, channelId: 'stale' }]
    queue.enqueue({ kind: 'openChannel', channelId: 'fresh' })
    queue.requeue(taken)
    expect(queue.takeAll()).toEqual([
      { kind: 'openChannel', channelId: 'stale' },
      { kind: 'openChannel', channelId: 'fresh' }
    ])
  })

  it('requeue with an empty array is a no-op', () => {
    const queue = createTrayActionQueue()
    queue.enqueue({ kind: 'newChannel' })
    queue.requeue([])
    expect(queue.size()).toBe(1)
  })
})
