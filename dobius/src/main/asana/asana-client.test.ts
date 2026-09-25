import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  httpsRequest: vi.fn(),
  getAsanaToken: vi.fn(() => 'asana-token')
}))

vi.mock('node:https', () => ({
  default: { request: mocks.httpsRequest },
  request: mocks.httpsRequest
}))

vi.mock('./asana-token-store', () => ({
  getAsanaToken: mocks.getAsanaToken
}))

class FakeRequest extends EventEmitter {
  destroy = vi.fn()
  end = vi.fn()
}

class FakeResponse extends EventEmitter {
  statusCode = 201
}

async function postCommentWithResponse(text: string) {
  const request = new FakeRequest()
  const response = new FakeResponse()
  mocks.httpsRequest.mockImplementationOnce((_options, callback) => {
    callback(response)
    return request
  })
  const { postTaskComment } = await import('./asana-client')
  const promise = postTaskComment('123456', text)
  response.emit('data', Buffer.from('{"data":{"gid":"story-1"}}'))
  response.emit('end')
  await promise
  return { request }
}

beforeEach(() => {
  vi.resetModules()
  mocks.httpsRequest.mockReset()
  mocks.getAsanaToken.mockReset()
  mocks.getAsanaToken.mockReturnValue('asana-token')
})

describe('asana client comments', () => {
  it('posts task comments to the Asana stories endpoint', async () => {
    const { request } = await postCommentWithResponse('Ready for review')
    expect(mocks.httpsRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: 'app.asana.com',
        path: '/api/1.0/tasks/123456/stories',
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer asana-token',
          'Content-Type': 'application/json'
        })
      }),
      expect.any(Function)
    )
    expect(request.end).toHaveBeenCalledWith(JSON.stringify({ data: { text: 'Ready for review' } }))
  })

  it('truncates comments that exceed Asana story limits', async () => {
    const { request } = await postCommentWithResponse('x'.repeat(65_010))
    const payload = JSON.parse(request.end.mock.calls[0][0]) as { data: { text: string } }
    expect(payload.data.text).toHaveLength(65_000)
    expect(payload.data.text).toContain('Comment truncated by Dobius+')
  })
})

type FakeTask = {
  gid: string
  completed?: boolean
  projects?: { gid: string }[]
}

type PageReply = {
  status?: number
  headers?: Record<string, string>
  body?: unknown
}

const NOW = new Date('2026-09-20T12:00:00.000Z')
const ASSIGNEE = '1213473231797717'

function task(gid: string, extra: Partial<FakeTask> = {}): FakeTask {
  return { gid, completed: false, ...extra }
}

// Routes each GET by path to a scripted reply; /users/me always returns one workspace.
function routeAsana(replyFor: (path: string) => PageReply, workspaces = ['111111']) {
  const paths: string[] = []
  mocks.httpsRequest.mockImplementation((options: { path: string }, callback) => {
    const request = new FakeRequest()
    request.end = vi.fn(() => {
      paths.push(options.path)
      const reply = options.path.startsWith('/api/1.0/users/me')
        ? { body: { data: { gid: '999999', workspaces: workspaces.map((gid) => ({ gid })) } } }
        : replyFor(options.path)
      const response = Object.assign(new FakeResponse(), {
        statusCode: reply.status ?? 200,
        headers: reply.headers ?? {}
      })
      callback(response)
      response.emit('data', Buffer.from(JSON.stringify(reply.body ?? {})))
      response.emit('end')
    })
    return request
  })
  return paths
}

function taskPaths(paths: string[]): string[] {
  return paths.filter((p) => p.startsWith('/api/1.0/tasks?'))
}

describe('asana client fetchLane', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    return () => vi.useRealTimers()
  })

  it('review lane asks for tasks completed in the last 48h, not "now", and keeps older completions', async () => {
    const paths = routeAsana(() => ({
      body: {
        data: [task('200001', { completed: true }), task('200002', { completed: false })]
      }
    }))
    const { fetchLane } = await import('./asana-client')
    const tasks = await fetchLane('review', ASSIGNEE)
    const [path] = taskPaths(paths)
    const since = new Date(NOW.getTime() - 48 * 60 * 60 * 1000).toISOString()
    expect(new URLSearchParams(path.split('?')[1]).get('completed_since')).toBe(since)
    expect(tasks.map((t) => t.gid)).toEqual(['200001'])
    expect(tasks[0]).toMatchObject({ completed: true, lane: 'review' })
  })

  it('build lane still asks for incomplete tasks only', async () => {
    const paths = routeAsana(() => ({ body: { data: [task('300001')] } }))
    const { fetchLane } = await import('./asana-client')
    const tasks = await fetchLane('build', ASSIGNEE)
    expect(new URLSearchParams(taskPaths(paths)[0].split('?')[1]).get('completed_since')).toBe(
      'now'
    )
    expect(tasks.map((t) => t.gid)).toEqual(['300001'])
  })

  it('follows next_page offsets past 50 tasks and dedupes tasks repeated across pages', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => task(String(400000 + i)))
    // Page 2 repeats the last five tasks of page 1 (Asana can shift items between pages).
    const page2 = [
      ...page1.slice(95),
      ...Array.from({ length: 30 }, (_, i) => task(String(500000 + i)))
    ]
    const paths = routeAsana((path) =>
      path.includes('offset=tok%2F2')
        ? { body: { data: page2, next_page: null } }
        : { body: { data: page1, next_page: { offset: 'tok/2' } } }
    )
    const { fetchLane } = await import('./asana-client')
    const tasks = await fetchLane('build', ASSIGNEE)
    expect(taskPaths(paths)).toHaveLength(2)
    expect(tasks).toHaveLength(130)
    expect(new Set(tasks.map((t) => t.gid)).size).toBe(130)
  })

  it('aborts instead of looping when Asana repeats a page offset', async () => {
    routeAsana(() => ({ body: { data: [task('600001')], next_page: { offset: 'same' } } }))
    const { fetchLane } = await import('./asana-client')
    await expect(fetchLane('build', ASSIGNEE)).rejects.toThrow(/repeated an offset/)
  })

  it('retries a rate-limited page (bounded) and keeps the full result', async () => {
    let limited = 0
    const paths = routeAsana((path) => {
      if (path.includes('offset=p2') && limited < 2) {
        limited += 1
        return { status: 429, headers: { 'retry-after': '0' }, body: { errors: [] } }
      }
      return path.includes('offset=p2')
        ? { body: { data: [task('700002')] } }
        : { body: { data: [task('700001')], next_page: { offset: 'p2' } } }
    })
    const { fetchLane } = await import('./asana-client')
    const tasks = await fetchLane('build', ASSIGNEE)
    expect(tasks.map((t) => t.gid)).toEqual(['700001', '700002'])
    expect(taskPaths(paths)).toHaveLength(4)
  })

  it('gives up after the retry budget on persistent 429', async () => {
    const paths = routeAsana(() => ({
      status: 429,
      headers: { 'retry-after': '0' },
      body: {}
    }))
    const { fetchLane } = await import('./asana-client')
    await expect(fetchLane('build', ASSIGNEE)).rejects.toThrow(/Asana HTTP 429/)
    expect(taskPaths(paths)).toHaveLength(3)
  })

  it('carries each task\'s project gids across pages and never filters by project', async () => {
    routeAsana((path) =>
      path.includes('offset=next')
        ? {
            body: {
              data: [task('800003', { projects: [{ gid: '555555' }, { gid: '123123' }] })]
            }
          }
        : {
            body: {
              data: [task('800001', { projects: [{ gid: '123123' }] }), task('800002')],
              next_page: { offset: 'next' }
            }
          }
    )
    const { fetchLane } = await import('./asana-client')
    const tasks = await fetchLane('build', ASSIGNEE)
    expect(tasks.map((t) => [t.gid, t.projectGids])).toEqual([
      ['800001', ['123123']],
      ['800002', []],
      ['800003', ['555555', '123123']]
    ])
  })

  it('retries a rate-limited workspace lookup', async () => {
    let limited = false
    mocks.httpsRequest.mockImplementation((options: { path: string }, callback) => {
      const request = new FakeRequest()
      request.end = vi.fn(() => {
        const isMe = options.path.startsWith('/api/1.0/users/me')
        const rateLimit = isMe && !limited
        limited ||= rateLimit
        const response = Object.assign(new FakeResponse(), {
          statusCode: rateLimit ? 429 : 200,
          headers: rateLimit ? { 'retry-after': '0' } : {}
        })
        callback(response)
        const body = rateLimit
          ? {}
          : isMe
            ? { data: { workspaces: [{ gid: '111111' }] } }
            : { data: [task('810001')] }
        response.emit('data', Buffer.from(JSON.stringify(body)))
        response.emit('end')
      })
      return request
    })
    const { fetchLane } = await import('./asana-client')
    const tasks = await fetchLane('build', ASSIGNEE)
    expect(tasks.map((t) => t.gid)).toEqual(['810001'])
  })

  it('requests project memberships so Auto Mode can apply its allowlist', async () => {
    const paths = routeAsana(() => ({ body: { data: [] } }))
    const { fetchLane } = await import('./asana-client')
    await fetchLane('build', ASSIGNEE)
    const fields = new URLSearchParams(taskPaths(paths)[0].split('?')[1]).get('opt_fields')
    expect(fields?.split(',')).toContain('projects.gid')
  })
})
