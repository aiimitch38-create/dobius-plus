import { Worker } from 'node:worker_threads'
import { describe, expect, it } from 'vitest'

// #86 (verify-only): SttService drops its worker reference on the Worker
// 'error' event. That is only safe if Node has already ended the thread, so
// check the real worker_threads contract: an uncaught error is followed by
// 'exit' without anyone calling terminate().
describe('worker_threads fatal error contract', () => {
  it('ends the thread by itself after an uncaught error', async () => {
    const worker = new Worker('throw new Error("native crash")', { eval: true })
    const events: string[] = []

    const exitCode = await new Promise<number>((resolve) => {
      worker.on('error', (error: Error) => {
        events.push(`error:${error.message}`)
      })
      worker.on('exit', (code) => {
        events.push('exit')
        resolve(code)
      })
    })

    expect(events).toEqual(['error:native crash', 'exit'])
    expect(exitCode).toBe(1)
    expect(worker.threadId).toBe(-1)
  })
})
