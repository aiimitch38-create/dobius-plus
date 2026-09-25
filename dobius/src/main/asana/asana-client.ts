import https from 'node:https'
import type { AsanaLane, AsanaTask } from '../../shared/asana'
import { ASANA_GID_RE } from '../../shared/asana'
import { getAsanaToken } from './asana-token-store'

// Wire-level facts copied from the old dobius-plus asana-queue.js / tasks-service.js:
// query by assignee + workspace (Asana allows those together, unlike project+assignee),
// then read the fields the Tasks panel shows.
const ASANA_HOST = 'app.asana.com'
const TIMEOUT_MS = 15_000
// Asana's maximum page size; larger result sets are followed via next_page.offset.
const PAGE_SIZE = 100
// Loop guard only (10k tasks per lane per workspace); hitting it fails the refresh
// instead of silently truncating intake.
const MAX_PAGES = 100
const MAX_RATE_LIMIT_RETRIES = 2
const MAX_RETRY_AFTER_SEC = 60
const ASANA_STORY_TEXT_LIMIT = 65_000
const REVIEW_WINDOW_MS = 48 * 60 * 60 * 1000
const TASK_FIELDS = 'gid,name,due_on,completed,permalink_url,assignee.name,notes,projects.gid'

export class AsanaHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSec: number | null
  ) {
    super(message)
    this.name = 'AsanaHttpError'
  }
}

function parseRetryAfter(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value
  const seconds = raw === undefined ? Number.NaN : Number(raw)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
}

function asanaGet<T>(path: string): Promise<T> {
  const token = getAsanaToken() // main-process only; throws if not configured
  return new Promise<T>((resolve, reject) => {
    const req = https.request(
      {
        hostname: ASANA_HOST,
        path,
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        timeout: TIMEOUT_MS
      },
      (res) => {
        let raw = ''
        res.on('data', (chunk) => {
          raw += chunk
        })
        res.on('end', () => {
          const code = res.statusCode ?? 0
          if (code < 200 || code >= 300) {
            reject(
              new AsanaHttpError(
                `Asana HTTP ${code}: ${raw.slice(0, 200)}`,
                code,
                parseRetryAfter(res.headers?.['retry-after'])
              )
            )
            return
          }
          try {
            resolve(raw ? (JSON.parse(raw) as T) : ({} as T))
          } catch {
            reject(new Error('Asana returned invalid JSON'))
          }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('Asana request timed out')))
    req.end()
  })
}

function asanaPost<T>(path: string, body: unknown): Promise<T> {
  const token = getAsanaToken() // main-process only; throws if not configured
  const payload = JSON.stringify(body)
  return new Promise<T>((resolve, reject) => {
    const req = https.request(
      {
        hostname: ASANA_HOST,
        path,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: TIMEOUT_MS
      },
      (res) => {
        let raw = ''
        res.on('data', (chunk) => {
          raw += chunk
        })
        res.on('end', () => {
          const code = res.statusCode ?? 0
          if (code < 200 || code >= 300) {
            reject(new Error(`Asana HTTP ${code}: ${raw.slice(0, 200)}`))
            return
          }
          try {
            resolve(raw ? (JSON.parse(raw) as T) : ({} as T))
          } catch {
            reject(new Error('Asana returned invalid JSON'))
          }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('Asana request timed out')))
    req.end(payload)
  })
}

type MeResponse = { data?: { gid?: string; workspaces?: { gid: string }[] } }
type TasksResponse = {
  data?: {
    gid: string
    name?: string
    notes?: string | null
    due_on?: string | null
    completed?: boolean
    permalink_url?: string
    assignee?: { name?: string } | null
    projects?: { gid?: string }[] | null
  }[]
  next_page?: { offset?: string } | null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Why: a 429 mid-pagination would otherwise fail the whole refresh; retry a
// bounded number of times, honoring Asana's Retry-After (capped).
async function asanaGetWithRetry<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await asanaGet<T>(path)
    } catch (error) {
      if (
        !(error instanceof AsanaHttpError) ||
        error.status !== 429 ||
        attempt >= MAX_RATE_LIMIT_RETRIES
      ) {
        throw error
      }
      await sleep(Math.min(error.retryAfterSec ?? 1, MAX_RETRY_AFTER_SEC) * 1000)
    }
  }
}

async function fetchAllTaskPages(basePath: string): Promise<NonNullable<TasksResponse['data']>> {
  const tasks: NonNullable<TasksResponse['data']> = []
  const seenOffsets = new Set<string>()
  let offset: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const path = offset ? `${basePath}&offset=${encodeURIComponent(offset)}` : basePath
    const res = await asanaGetWithRetry<TasksResponse>(path)
    tasks.push(...(res.data ?? []))
    offset = res.next_page?.offset || undefined
    if (!offset) {
      return tasks
    }
    if (seenOffsets.has(offset)) {
      throw new Error('Asana pagination repeated an offset; intake aborted')
    }
    seenOffsets.add(offset)
  }
  throw new Error(`Asana returned more than ${MAX_PAGES} pages; intake aborted`)
}

async function fetchWorkspaces(): Promise<string[]> {
  const me = await asanaGet<MeResponse>('/api/1.0/users/me?opt_fields=gid,workspaces')
  return (me.data?.workspaces ?? []).map((w) => w.gid).filter(Boolean)
}

/**
 * Fetch a lane's tasks by assignee across all the token owner's workspaces,
 * following every page and deduplicating by gid.
 * build lane = incomplete tasks; review lane = tasks completed in the last 48h
 * (Sam's recently-finished work). Asana's completed_since returns incomplete
 * tasks plus tasks completed after that instant, so the review lane asks for
 * "48h ago" and then keeps only the completed ones.
 * allowedProjectGids: empty = every project (and tasks in no project);
 * non-empty = only tasks that belong to at least one listed project.
 */
export async function fetchLane(
  lane: AsanaLane,
  assigneeGid: string,
  allowedProjectGids: readonly string[] = []
): Promise<AsanaTask[]> {
  if (!ASANA_GID_RE.test(assigneeGid)) {
    return []
  }
  const allowed = new Set(allowedProjectGids)
  const workspaces = await fetchWorkspaces()
  const seen = new Set<string>()
  const out: AsanaTask[] = []
  for (const ws of workspaces) {
    const completedSince =
      lane === 'review' ? new Date(Date.now() - REVIEW_WINDOW_MS).toISOString() : 'now'
    const path =
      `/api/1.0/tasks?assignee=${assigneeGid}&workspace=${ws}` +
      `&completed_since=${encodeURIComponent(completedSince)}&limit=${PAGE_SIZE}` +
      `&opt_fields=${TASK_FIELDS}`
    for (const t of await fetchAllTaskPages(path)) {
      if (!t.gid || seen.has(t.gid)) {
        continue
      }
      if (lane === 'review' && !t.completed) {
        continue
      }
      if (allowed.size > 0 && !(t.projects ?? []).some((p) => p.gid && allowed.has(p.gid))) {
        continue
      }
      seen.add(t.gid)
      out.push({
        gid: t.gid,
        name: t.name || '(untitled)',
        notes: t.notes ?? '',
        url: t.permalink_url || `https://app.asana.com/0/0/${t.gid}`,
        dueOn: t.due_on ?? null,
        completed: Boolean(t.completed),
        lane,
        assignee: t.assignee?.name ?? null
      })
    }
  }
  return out
}

/**
 * User-triggered Asana completion write. PUT /tasks/<gid> {completed:true}. Only ever called
 * from an explicit user action — never from the poller or the local-done tick.
 */
export async function markTaskComplete(taskGid: string): Promise<void> {
  if (!ASANA_GID_RE.test(taskGid)) {
    throw new Error('Asana task gid malformed')
  }
  const token = getAsanaToken()
  const payload = JSON.stringify({ data: { completed: true } })
  await new Promise<void>((resolve, reject) => {
    const req = https.request(
      {
        hostname: ASANA_HOST,
        path: `/api/1.0/tasks/${taskGid}`,
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: TIMEOUT_MS
      },
      (res) => {
        let raw = ''
        res.on('data', (chunk) => {
          raw += chunk
        })
        res.on('end', () => {
          const code = res.statusCode ?? 0
          if (code >= 200 && code < 300) {
            resolve()
          } else {
            reject(new Error(`Asana HTTP ${code}: ${raw.slice(0, 200)}`))
          }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('Asana request timed out')))
    req.end(payload)
  })
}

type StoryResponse = { data?: { gid?: string } }

function truncateStoryText(text: string): string {
  if (text.length <= ASANA_STORY_TEXT_LIMIT) {
    return text
  }
  const suffix = '\n\n[Comment truncated by Dobius+ to fit Asana story limits.]'
  return `${text.slice(0, ASANA_STORY_TEXT_LIMIT - suffix.length)}${suffix}`
}

export async function postTaskComment(taskGid: string, text: string): Promise<{ gid: string }> {
  if (!ASANA_GID_RE.test(taskGid)) {
    throw new Error('Asana task gid malformed')
  }
  const response = await asanaPost<StoryResponse>(`/api/1.0/tasks/${taskGid}/stories`, {
    data: { text: truncateStoryText(text) }
  })
  const gid = response.data?.gid
  if (!gid) {
    throw new Error('Asana did not return a story gid')
  }
  return { gid }
}
