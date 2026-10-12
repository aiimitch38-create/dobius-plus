#!/usr/bin/env node
import { existsSync, openSync, closeSync } from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// This file is installed on the internal drive so launchd can wait for Storage.
export class MetroSupervisor {
  constructor({ available, healthy, start, stop, alive, starting = () => false, now = Date.now }) {
    Object.assign(this, { available, healthy, start, stop, alive, starting, now })
    this.child = null
    this.retiring = null
    this.startedAt = 0
    this.failures = 0
  }

  async tick() {
    // Storage IO can delay termination. Do not create duplicate server groups.
    if (this.retiring) {
      if (this.alive(this.retiring)) {
        return
      }
      this.retiring = null
    }
    if (!this.available()) {
      this.shutdown()
      return
    }
    if (this.child?.exitCode != null || this.child?.signalCode != null) {
      if (this.alive(this.child)) {
        return
      }
      this.child = null
    }
    if (await this.healthy()) {
      this.failures = 0
      return
    }
    if (this.child) {
      // Cold Metro startup needs time; an unhealthy owned process is then replaced.
      if (this.now() - this.startedAt > 300000 && ++this.failures >= 3) {
        this.shutdown()
      }
      return
    }
    // Also respect startup inherited from a previous supervisor or a manual run.
    if (this.starting()) {
      return
    }
    this.child = this.start()
    this.startedAt = this.now()
    this.failures = 0
  }

  shutdown() {
    // Never stop a manually started server: only our own child group is owned.
    if (this.child) {
      this.stop(this.child)
      this.retiring = this.child
    }
    this.child = null
    this.failures = 0
  }
}

async function main() {
  const mobileDir = process.env.DOBIUS_METRO_DIR || '/Volumes/Storage/dev/dobius/dobius/mobile'
  const pnpm = process.env.DOBIUS_METRO_PNPM || '/Users/bayou/homebrew/bin/pnpm'
  const endpoint = 'http://127.0.0.1:8081/status'
  const supervisor = new MetroSupervisor({
    available: () => existsSync(`${mobileDir}/node_modules/.bin/expo`),
    starting: () => execFileSync('/bin/ps', ['-axo', 'command'], { encoding: 'utf8' })
      .split('\n').some((line) => /^\S*node\s+.*expo\/bin\/cli\s+start\b/.test(line.trim()) && /--port\s+8081\b/.test(line)),
    alive: (child) => {
      if (!child.pid) {
        return false
      }
      try {
        process.kill(-child.pid, 0)
        return true
      } catch {
        return false
      }
    },
    healthy: async () => {
      try {
        const response = await fetch(endpoint, { signal: AbortSignal.timeout(3000) })
        return response.ok && (await response.text()).trim() === 'packager-status:running'
      } catch {
        return false
      }
    },
    start: () => {
      const log = openSync('/Volumes/Storage/dev/metro.log', 'a')
      try {
        const child = spawn(pnpm, ['exec', 'expo', 'start', '--dev-client', '--host', 'lan', '--port', '8081'], {
          cwd: mobileDir,
          detached: true,
          stdio: ['ignore', log, log],
          env: { ...process.env, REACT_NATIVE_PACKAGER_HOSTNAME: '100.94.52.53', CI: '1' }
        })
        child.on('error', () => { supervisor.shutdown() })
        console.log('[metro-supervisor] Starting phone HTTP server')
        return child
      } finally {
        closeSync(log)
      }
    },
    stop: (child) => {
      if (!child.pid) {
        return
      }
      try { process.kill(-child.pid, 'SIGTERM') } catch { /* Already exited. */ }
    }
  })
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => { supervisor.shutdown(); process.exit(0) })
  }
  while (true) {
    try { await supervisor.tick() } catch { console.error('[metro-supervisor] Waiting for Storage/server recovery') }
    await new Promise((resolve) => setTimeout(resolve, 10000))
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
