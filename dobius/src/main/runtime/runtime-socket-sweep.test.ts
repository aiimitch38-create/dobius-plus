import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createRuntimeTransportMetadata,
  RUNTIME_SOCKET_NAME_REGEX,
  sweepOrphanedRuntimeSockets
} from './runtime-rpc'

function listenOn(socketPath: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(socketPath, () => resolve(server))
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

// Why: a SIGKILLed listener leaves its real socket inode behind with nobody
// accepting on it — exactly what a crashed runtime leaves in userData.
async function leaveCrashedSocket(socketPath: string): Promise<void> {
  const child = spawn(
    process.execPath,
    [
      '-e',
      "require('net').createServer().listen(process.argv[1], () => console.log('up'))",
      socketPath
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] }
  )
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.stdout.once('data', () => resolve())
  })
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill('SIGKILL')
  await exited
}

describe('sweepOrphanedRuntimeSockets', () => {
  // Why: a pid we know is always alive and is never the test runner's own
  // pid — init on POSIX, so process.kill(1, 0) resolves without ESRCH. Using
  // this synthetic pid for ownPid cleanly separates three retention branches
  // (own-pid-skipped / alive-non-own-retained / dead-swept) into distinct
  // observations.
  const SYNTHETIC_OWN_PID = 1
  const KNOWN_DEAD_PID = 99999999

  it.runIf(process.platform !== 'win32')(
    'sweeps dead-pid sockets while retaining own, alive, and non-matching entries',
    async () => {
      const userDataPath = mkdtempSync(join(tmpdir(), 'dobius-sweep-'))

      const ownPidSocket = join(userDataPath, `o-${SYNTHETIC_OWN_PID}-aaaa.sock`)
      const aliveSocket = join(userDataPath, `o-${process.pid}-bbbb.sock`)
      const deadSocket = join(userDataPath, `o-${KNOWN_DEAD_PID}-cccc.sock`)
      const unrelatedFile = join(userDataPath, 'foo.sock')

      writeFileSync(ownPidSocket, '')
      const liveServer = await listenOn(aliveSocket)
      writeFileSync(deadSocket, '')
      writeFileSync(unrelatedFile, '')

      try {
        await sweepOrphanedRuntimeSockets(userDataPath, SYNTHETIC_OWN_PID)

        // Why: own pid (1) is skipped by the ownPid === pid early-exit.
        expect(existsSync(ownPidSocket)).toBe(true)
        // Why: alive pid with a listener on the socket — a running runtime.
        expect(existsSync(aliveSocket)).toBe(true)
        // Why: dead pid — isPidAlive sees ESRCH, sweep removes it.
        expect(existsSync(deadSocket)).toBe(false)
        // Why: regex miss — not `o-<digits>-<suffix>.sock` shape, so the
        // sweep never touches it.
        expect(existsSync(unrelatedFile)).toBe(true)
      } finally {
        await closeServer(liveServer)
      }
    }
  )

  it.runIf(process.platform !== 'win32')(
    'sweeps a socket whose pid was reused by an unrelated live process (N11)',
    async () => {
      const userDataPath = mkdtempSync(join(tmpdir(), 'dobius-sweep-'))
      // Why: the runtime that made this socket crashed, and the OS later gave
      // its pid to another process (here: the test runner, which is alive
      // but not listening on the socket).
      const reusedPidSocket = join(userDataPath, `o-${process.pid}-dddd.sock`)
      await leaveCrashedSocket(reusedPidSocket)
      expect(existsSync(reusedPidSocket)).toBe(true)

      await sweepOrphanedRuntimeSockets(userDataPath, SYNTHETIC_OWN_PID)

      expect(existsSync(reusedPidSocket)).toBe(false)
    }
  )

  it('tolerates a non-existent userData directory', async () => {
    const userDataPath = join(tmpdir(), `dobius-sweep-missing-${Date.now()}`)

    await expect(
      sweepOrphanedRuntimeSockets(userDataPath, SYNTHETIC_OWN_PID)
    ).resolves.toBeUndefined()
  })

  it('regex invariant: matches sockets produced by createRuntimeTransportMetadata', () => {
    // Why: if the socket-name factory ever changes shape (e.g. adds a new
    // separator or allows different characters), the sweep will silently
    // stop matching real sockets. Assert the two stay in lockstep.
    const userDataPath = '/tmp'
    const transport = createRuntimeTransportMetadata(userDataPath, 12345, 'linux', 'rt_abcdef')
    expect(transport.kind).toBe('unix')
    if (transport.kind !== 'unix') {
      throw new Error('expected unix transport')
    }
    const socketName = basename(transport.endpoint)
    expect(RUNTIME_SOCKET_NAME_REGEX.test(socketName)).toBe(true)
  })

  it('regex invariant: also matches the fallback runtimeId suffix ("rt")', () => {
    // Why: createRuntimeTransportMetadata falls back to the literal 'rt'
    // suffix when the runtimeId contains no allowed characters; the sweep
    // regex must still match that shape.
    const userDataPath = '/tmp'
    const transport = createRuntimeTransportMetadata(userDataPath, 99, 'darwin', '!!!!')
    if (transport.kind !== 'unix') {
      throw new Error('expected unix transport')
    }
    const socketName = basename(transport.endpoint)
    expect(RUNTIME_SOCKET_NAME_REGEX.test(socketName)).toBe(true)
    expect(socketName).toBe('o-99-rt.sock')
  })
})
