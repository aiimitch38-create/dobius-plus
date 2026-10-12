import type { TuiAgent } from './types'

export type AsanaProjectRef = {
  name: string
  gid: string
}

export type AsanaConfig = {
  myGid: string
  reviewGid: string
  allowedProjects: AsanaProjectRef[]
  autoMode: {
    enabled: boolean
    intervalMinutes: number
    triageAgentId?: string
    buildAgent?: TuiAgent
  }
}

export const DEFAULT_ASANA_CONFIG: AsanaConfig = {
  myGid: '1215600517617968',
  reviewGid: '1213473231797717',
  allowedProjects: [],
  autoMode: {
    enabled: false,
    intervalMinutes: 10,
    buildAgent: 'claude'
  }
}

export type AsanaLane = 'build' | 'review'

export type AsanaTask = {
  gid: string
  name: string
  notes: string
  url: string
  dueOn: string | null
  completed: boolean
  lane: AsanaLane
  assignee: string | null
  // Gids of the Asana projects the task belongs to; used by the Auto Mode allowlist.
  projectGids?: string[]
}

export type AsanaTasksSnapshot = {
  build: AsanaTask[]
  review: AsanaTask[]
  localDone: string[]
  lastSync: number | null
  error: string | null
}

/** Result of a human re-queue; blockedGids is the refreshed list of tasks Auto Mode skips for good. */
export type AsanaRequeueResult = {
  ok: boolean
  error: string | null
  blockedGids: string[]
}

export const EMPTY_ASANA_SNAPSHOT: AsanaTasksSnapshot = {
  build: [],
  review: [],
  localDone: [],
  lastSync: null,
  error: null
}

// Renderer never gets the PAT; a valid Asana task gid is 6-30 digits.
export const ASANA_GID_RE = /^\d{6,30}$/
