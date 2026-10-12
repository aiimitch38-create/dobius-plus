// OS identity, not a title or a guessed numeric PID, is required before changing priority.
export function terminalTier(title) {
  return /\b(research|verify|productivity|loophole)\b/i.test(title ?? '') ? 3 : 2
}

export function parseProcesses(text) {
  return text.split('\n').flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+[\d:]+\s+\d+)\s+(.+)$/)
    if (!match) return []
    const [, pid, parent, uid, started, command] = match
    const handles = [...command.matchAll(/(?:^|\s)DOBIUS_TERMINAL_HANDLE=(term_[\w-]+)(?=\s|$)/g)]
    return [{ pid: Number(pid), parent: Number(parent), uid: Number(uid), started,
      handle: handles.length === 1 ? handles[0][1] : null,
      sharedServer: /\bapp-server\b.*--managed-daemon\b/.test(command) }]
  })
}

export function processIdentity(row) {
  return `${row.pid}:${row.uid}:${row.started}:${row.handle}`
}

export function protectedProcesses(rows, metroPids, appPids, selfPid) {
  const byPid = new Map(rows.map((row) => [row.pid, row]))
  const protectedPids = new Map()
  const protectAncestors = (pid, reason) => {
    const seen = new Set()
    while (pid > 1 && !seen.has(pid)) {
      seen.add(pid)
      if (!protectedPids.has(pid)) protectedPids.set(pid, reason)
      pid = byPid.get(pid)?.parent
    }
  }
  for (const pid of metroPids) protectAncestors(pid, 'Metro listener on 8081 or its ancestor')
  for (const pid of appPids) protectAncestors(pid, 'Dobius+ main process or its ancestor')
  protectAncestors(selfPid, 'priority supervisor or its ancestor')
  // A shared broker can inherit one terminal handle while executing work for many terminals.
  const brokers = new Set(rows.filter((row) => row.sharedServer).map((row) => row.pid))
  for (const row of rows) {
    let current = row
    const seen = new Set()
    while (current && !seen.has(current.pid)) {
      seen.add(current.pid)
      if (brokers.has(current.pid)) {
        protectedPids.set(row.pid, 'shared agent server; terminal ownership is ambiguous')
        break
      }
      current = byPid.get(current.parent)
    }
  }
  return protectedPids
}

export function priorityDecisions({ terminals, rows, metroPids, appPids, uid, selfPid }) {
  // Missing protection evidence is not permission to throttle a best-guess process.
  if (!metroPids.length || !appPids.length) return [{ action: 'skip', reason: 'protected process discovery incomplete' }]
  const protectedPids = protectedProcesses(rows, metroPids, appPids, selfPid)
  const decisions = [...protectedPids].map(([pid, reason]) => ({ action: 'skip', pid, reason }))
  for (const terminal of terminals) {
    if (!terminal.connected || typeof terminal.handle !== 'string') continue
    const matches = rows.filter((row) => row.uid === uid && row.handle === terminal.handle)
    if (!matches.length) decisions.push({ action: 'skip', reason: 'terminal PID unresolved' })
    for (const row of matches) {
      if (protectedPids.has(row.pid)) continue
      decisions.push({ action: terminalTier(terminal.title) === 3 ? 'background' : 'default',
        pid: row.pid, identity: processIdentity(row), handle: row.handle })
    }
  }
  return decisions
}

export class TerminalPriority {
  constructor({ snapshot, apply, log = console.log, applied = new Set() }) {
    Object.assign(this, { snapshot, apply, log, applied })
  }

  async tick() {
    const initial = await this.snapshot()
    const decisions = priorityDecisions(initial)
    for (const decision of decisions) {
      if (decision.action === 'skip') {
        this.log(`[terminal-priority] skip${decision.pid ? ` PID ${decision.pid}` : ''}: ${decision.reason}`)
        continue
      }
      // Descendants can inherit background policy between ticks. Restore every positively
      // identified Tier 2 process, including children born just before a retitle.
      if (decision.action === 'background' && this.applied.has(decision.identity)) continue
      // Re-read titles, start times and protected listeners immediately before each mutation.
      const fresh = priorityDecisions(await this.snapshot()).find((item) =>
        item.pid === decision.pid && item.identity === decision.identity && item.action === decision.action)
      if (!fresh) continue
      await this.apply(decision.action === 'background' ? '-b' : '-B', decision.pid)
      if (decision.action === 'background') this.applied.add(decision.identity)
      else this.applied.delete(decision.identity)
      this.log(`[terminal-priority] PID ${decision.pid}: ${decision.action}`)
    }
    const live = new Set(initial.rows.map(processIdentity))
    for (const identity of this.applied) if (!live.has(identity)) this.applied.delete(identity)
  }
}
