// BUILD-044: every local package build gets the next build number, with no
// manual edit. The number goes into CFBundleVersion (see mac.bundleVersion in
// electron-builder.config.cjs) and the gated installer copies it into
// INSTALL-PROVENANCE.json.
//
// Why a counter and not a version bump: package.json's SemVer version is what
// the installer's downgrade guard compares, so it must only move when a person
// means it to. Rewriting it on every build would dirty the tree and would let a
// stale branch built later outrank newer code. The build number is SemVer build
// metadata: it orders builds on this machine and never affects precedence.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const BUILD_NUMBER_ENV = 'DOBIUS_BUILD_NUMBER'

export function defaultCounterFile() {
  return process.env.DOBIUS_BUILD_NUMBER_FILE || path.join(homedir(), '.dobius-build-number')
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function readCounter(counterFile) {
  let raw
  try {
    raw = readFileSync(counterFile, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') {
      return 0
    }
    throw error
  }
  // Why fail instead of restarting at 1: a reset would hand out numbers that
  // were already used, so two different builds could claim the same number.
  if (!/^[1-9][0-9]*\n?$/.test(raw)) {
    throw new Error(
      `Build counter ${counterFile} is not a positive integer; fix or remove it by hand.`
    )
  }
  return Number.parseInt(raw, 10)
}

// Returns the next build number and records it. Concurrent builds are
// serialized by an mkdir lock; a lock left by a dead build is reported, never
// broken automatically.
export function allocateBuildNumber({ counterFile = defaultCounterFile(), lockWaitMs = 30_000 } = {}) {
  const lock = `${counterFile}.lock`
  const deadline = Date.now() + lockWaitMs
  for (;;) {
    try {
      mkdirSync(lock)
      break
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error
      }
      if (Date.now() >= deadline) {
        throw new Error(`Build counter lock ${lock} is held; remove it only if no build is running.`)
      }
      sleepMs(100)
    }
  }
  try {
    const next = readCounter(counterFile) + 1
    if (!Number.isSafeInteger(next)) {
      throw new Error(`Build counter ${counterFile} overflowed.`)
    }
    const tmp = `${counterFile}.${process.pid}.tmp`
    writeFileSync(tmp, `${next}\n`)
    renameSync(tmp, counterFile)
    return next
  } finally {
    rmSync(lock, { recursive: true, force: true })
  }
}

function main(args) {
  const buildNumber = allocateBuildNumber()
  console.log(`Dobius+ build number: ${buildNumber}`)
  const result = spawnSync('electron-builder', args, {
    stdio: 'inherit',
    // Why: on Windows the local bin is electron-builder.cmd, which needs a shell.
    shell: process.platform === 'win32',
    env: { ...process.env, [BUILD_NUMBER_ENV]: String(buildNumber) }
  })
  if (result.error) {
    throw result.error
  }
  process.exit(result.status ?? 1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
}
