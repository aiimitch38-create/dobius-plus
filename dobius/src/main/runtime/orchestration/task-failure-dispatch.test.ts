import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './db'

describe('coordinator task failure dispatch release', () => {
  let db: OrchestrationDb | undefined

  afterEach(() => db?.close())

  function fixture(): OrchestrationDb {
    db = new OrchestrationDb(':memory:')
    return db
  }

  it('frees the worker, preserves failure evidence and keeps dependents pending', () => {
    const d = fixture()
    const task = d.createTask({ spec: 'failing source check' })
    const dependent = d.createTask({ spec: 'review accepted source', deps: [task.id] })
    const dispatch = d.createDispatchContext(task.id, 'term_worker')
    const result = JSON.stringify({ verdict: 'lint-failed', dispatchId: dispatch.id })

    d.updateTaskStatus(task.id, 'failed', result)

    expect(d.getTask(task.id)).toMatchObject({ status: 'failed', result })
    expect(d.getTask(task.id)?.completed_at).toBeTruthy()
    expect(d.getTask(dependent.id)?.status).toBe('pending')
    expect(d.getDispatchContext(task.id)).toMatchObject({
      id: dispatch.id,
      status: 'failed',
      failure_count: 1,
      last_failure: 'Task marked failed by coordinator.'
    })
    expect(d.getActiveDispatchForTerminal('term_worker')).toBeUndefined()

    const correction = d.createTask({ spec: 'correct source check failure' })
    expect(d.createDispatchContext(correction.id, 'term_worker').task_id).toBe(correction.id)
  })

  it('does not count repeated failure updates or disturb the worker next dispatch', () => {
    const d = fixture()
    const oldTask = d.createTask({ spec: 'old attempt' })
    const oldDispatch = d.createDispatchContext(oldTask.id, 'term_worker')
    d.updateTaskStatus(oldTask.id, 'failed', 'first failure')
    const nextTask = d.createTask({ spec: 'next work' })
    const nextDispatch = d.createDispatchContext(nextTask.id, 'term_worker')

    d.updateTaskStatus(oldTask.id, 'failed', 'additional failure evidence')

    expect(d.getDispatchContextById(oldDispatch.id)).toMatchObject({
      status: 'failed',
      failure_count: 1
    })
    expect(d.getTask(oldTask.id)?.result).toBe('additional failure evidence')
    expect(d.getActiveDispatchForTerminal('term_worker')?.id).toBe(nextDispatch.id)
    expect(d.getTask(nextTask.id)?.status).toBe('dispatched')
  })

  it('preserves the circuit breaker across explicit retries without releasing dependents', () => {
    const d = fixture()
    const task = d.createTask({ spec: 'retryable source check' })
    const dependent = d.createTask({ spec: 'downstream acceptance', deps: [task.id] })

    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) {
        d.updateTaskStatus(task.id, 'ready')
      }
      const dispatch = d.createDispatchContext(task.id, 'term_worker')
      d.updateTaskStatus(task.id, 'failed')
      expect(d.getDispatchContextById(dispatch.id)).toMatchObject({
        failure_count: attempt,
        status: attempt === 3 ? 'circuit_broken' : 'failed'
      })
      expect(d.getActiveDispatchForTerminal('term_worker')).toBeUndefined()
      expect(d.getTask(task.id)?.status).toBe('failed')
      expect(d.getTask(dependent.id)?.status).toBe('pending')
    }
  })
})
