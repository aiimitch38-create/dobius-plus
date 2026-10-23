import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { hostname } from 'node:os'
import type { AttemptRecord } from './journal'

export function safeEnvironment(hermesHome?: string): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, HOME: hermesHome, HERMES_HOME: hermesHome, LANG: 'C.UTF-8' }
}

export function readBootId() {
  if (process.platform === 'linux') {
    try {
      return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()
    } catch {
      /* Mac fallback below */
    }
  }
  return `${hostname()}:${execFileSync('sysctl', ['-n', 'kern.boottime'], { encoding: 'utf8' }).trim()}`
}

function ps(pid: number, field: string): string | null {
  try {
    return (
      execFileSync('ps', ['-o', `${field}=`, '-p', String(pid)], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim() || null
    )
  } catch {
    return null
  }
}
export function processStart(pid: number) {
  return ps(pid, 'lstart')
}
export function processGroup(pid: number) {
  const value = ps(pid, 'pgid')
  return value ? Number(value) : null
}
export function preflightProcessInspection(inspector = { processStart, processGroup }) {
  const started = inspector.processStart(process.pid)
  const group = inspector.processGroup(process.pid)
  if (!started || group === null || !Number.isSafeInteger(group) || group <= 0) {
    throw new Error(
      'Process identity inspection is unavailable; worker refuses startup before spawn.'
    )
  }
}
export function groupExists(pgid: number) {
  try {
    return execFileSync('ps', ['-eo', 'pgid='], { encoding: 'utf8' })
      .split(/\s+/)
      .includes(String(pgid))
  } catch {
    return true
  }
}
export function descendantPids(rootPid: number) {
  try {
    const rows = execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .map((line) => line.trim().split(/\s+/).map(Number))
    const children = new Map<number, number[]>()
    for (const [pid, parent] of rows) {
      if (Number.isFinite(pid) && Number.isFinite(parent)) {
        children.set(parent!, [...(children.get(parent!) ?? []), pid!])
      }
    }
    const found: number[] = []
    const pending = [...(children.get(rootPid) ?? [])]
    while (pending.length) {
      const pid = pending.pop()!
      found.push(pid)
      pending.push(...(children.get(pid) ?? []))
    }
    return found
  } catch {
    return []
  }
}
export function captureOwnedDescendants(record: AttemptRecord) {
  if (!record.pid) {
    return
  }
  const known = new Set(
    record.ownedDescendants.map((child) => `${child.pid}:${child.processStart}`)
  )
  for (const pid of descendantPids(record.pid)) {
    const started = processStart(pid)
    const group = processGroup(pid)
    if (started && group !== null && !known.has(`${pid}:${started}`)) {
      record.ownedDescendants.push({ pid, processStart: started, processGroupId: group })
    }
  }
}
export function processIdentityExists(identity: { pid: number; processStart: string }) {
  return processStart(identity.pid) === identity.processStart
}
export function signalOwnedProcess(
  identity: { pid: number; processStart: string },
  signal: NodeJS.Signals
) {
  if (!processIdentityExists(identity)) {
    return
  }
  try {
    process.kill(identity.pid, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
      throw error
    }
  }
}
export function signalGroup(pgid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pgid, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
      throw error
    }
  }
}
type GroupIdentityInspector = {
  processStart: (pid: number) => string | null
  processGroup: (pid: number) => number | null
}
type RecordedGroupIdentity = { pid: number; processStart: string; processGroupId: number }

function signalRecordedGroup(
  identity: RecordedGroupIdentity,
  signal: NodeJS.Signals,
  inspect: GroupIdentityInspector,
  send: typeof signalGroup
) {
  if (
    inspect.processStart(identity.pid) !== identity.processStart ||
    inspect.processGroup(identity.pid) !== identity.processGroupId
  ) {
    return false
  }
  send(identity.processGroupId, signal)
  return true
}

/** Signal a recorded group only while a recorded PID/start pair still anchors it. */
export function signalOwnedGroup(
  record: AttemptRecord,
  signal: NodeJS.Signals,
  inspect: GroupIdentityInspector = { processStart, processGroup },
  send: typeof signalGroup = signalGroup
) {
  if (!record.processGroupId) {
    return false
  }
  const leaderOwnsGroup = Boolean(
    record.pid &&
    record.processStart &&
    inspect.processStart(record.pid) === record.processStart &&
    inspect.processGroup(record.pid) === record.processGroupId
  )
  const recordedMemberOwnsGroup = record.ownedDescendants.some(
    (member) =>
      inspect.processStart(member.pid) === member.processStart &&
      inspect.processGroup(member.pid) === record.processGroupId
  )
  if (!leaderOwnsGroup && !recordedMemberOwnsGroup) {
    return false
  }
  if (leaderOwnsGroup) {
    return signalRecordedGroup(
      {
        pid: record.pid!,
        processStart: record.processStart!,
        processGroupId: record.processGroupId
      },
      signal,
      inspect,
      send
    )
  }
  const member = record.ownedDescendants.find(
    (candidate) =>
      inspect.processStart(candidate.pid) === candidate.processStart &&
      inspect.processGroup(candidate.pid) === record.processGroupId
  )
  return member
    ? signalRecordedGroup(
        {
          pid: member.pid,
          processStart: member.processStart,
          processGroupId: record.processGroupId
        },
        signal,
        inspect,
        send
      )
    : false
}
export function terminateGroup(pgid: number) {
  const started = processStart(pgid)
  if (!started) {
    return
  }
  try {
    signalRecordedGroup(
      { pid: pgid, processStart: started, processGroupId: pgid },
      'SIGTERM',
      { processStart, processGroup },
      signalGroup
    )
  } catch {
    /* identity is already ambiguous; no retry authority */
  }
}
export function hasUnresolvedOwnedProcesses(record: AttemptRecord) {
  const rootPresent = Boolean(
    record.pid &&
    record.processStart &&
    processStart(record.pid) === record.processStart &&
    processGroup(record.pid) === record.processGroupId
  )
  return Boolean(
    rootPresent ||
    groupExists(record.processGroupId!) ||
    record.ownedDescendants.some(processIdentityExists)
  )
}

export async function terminateOwnedAttempt(
  record: AttemptRecord,
  termGraceMs = 300,
  killWaitMs = 1200
) {
  if (!record.pid || !record.processStart || !record.processGroupId) {
    return false
  }
  captureOwnedDescendants(record)
  signalOwnedGroup(record, 'SIGTERM')
  for (const child of record.ownedDescendants) {
    signalOwnedProcess(child, 'SIGTERM')
  }
  const termDeadline = Date.now() + termGraceMs
  while (hasUnresolvedOwnedProcesses(record) && Date.now() < termDeadline) {
    captureOwnedDescendants(record)
    await delay(25)
  }
  if (hasUnresolvedOwnedProcesses(record)) {
    signalOwnedGroup(record, 'SIGKILL')
    for (const child of record.ownedDescendants) {
      signalOwnedProcess(child, 'SIGKILL')
    }
  }
  const killDeadline = Date.now() + killWaitMs
  while (hasUnresolvedOwnedProcesses(record) && Date.now() < killDeadline) {
    captureOwnedDescendants(record)
    await delay(25)
  }
  return !hasUnresolvedOwnedProcesses(record)
}
export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
export function hashText(text: string | Buffer) {
  return createHash('sha256').update(text).digest('hex')
}
