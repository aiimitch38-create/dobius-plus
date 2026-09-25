// BUILD-044: every local package build gets the next build number, with no
// manual edit. The number goes into CFBundleVersion (see mac.bundleVersion in
// electron-builder.config.cjs) and the gated installer copies it into
// INSTALL-PROVENANCE.json. The source tree's state at BUILD time (branch,
// commit, dirty, diffDigest, tag) is written to a record that electron-builder
// seals into Contents/Resources/BUILD-PROVENANCE.json, so the installer never
// has to describe a tree that may have changed since the build.
//
// Two steps, because the compile before packaging takes minutes:
//   --snapshot-source  (first in build:unpack/build:mac) records the tree
//                      BEFORE the compile;
//   <electron-builder args>  refuses to package if HEAD, branch or the dirty
//                      digest changed since, then seals the snapshot.
//
// Why a counter and not a version bump: package.json's SemVer version is what
// the installer's downgrade guard compares, so it must only move when a person
// means it to. Rewriting it on every build would dirty the tree and would let a
// stale branch built later outrank newer code. The build number is SemVer build
// metadata: it orders builds on this machine and never affects precedence.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const BUILD_NUMBER_ENV = 'DOBIUS_BUILD_NUMBER'
export const BUILD_PROVENANCE_ENV = 'DOBIUS_BUILD_PROVENANCE_FILE'

const repoRoot = path.resolve(import.meta.dirname, '../../..')
const dobiusDir = path.resolve(import.meta.dirname, '../..')
const sourceStateScript = path.join(repoRoot, 'scripts', 'source-state.py')

// Outside the checkout, so writing it never makes the tree dirty; keyed by the
// checkout so parallel worktrees do not share one.
export function defaultSnapshotFile(dir = dobiusDir) {
  if (process.env.DOBIUS_BUILD_SOURCE_SNAPSHOT) {
    return process.env.DOBIUS_BUILD_SOURCE_SNAPSHOT
  }
  const key = createHash('sha256').update(dir).digest('hex').slice(0, 16)
  return path.join(tmpdir(), `dobius-build-source-${key}.json`)
}

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
export function allocateBuildNumber({
  counterFile = defaultCounterFile(),
  lockWaitMs = 30_000
} = {}) {
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
        throw new Error(
          `Build counter lock ${lock} is held; remove it only if no build is running.`
        )
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

// Same implementation the installer falls back to, so both digests agree.
export function collectSourceState(dir) {
  const result = spawnSync('python3', [sourceStateScript, dir], { encoding: 'utf8' })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`source-state.py failed (${result.status}): ${result.stderr.trim()}`)
  }
  return JSON.parse(result.stdout)
}

export function takeSourceSnapshot({ sourceDir = dobiusDir, file = defaultSnapshotFile() } = {}) {
  const snapshot = { ...collectSourceState(sourceDir), capturedAt: new Date().toISOString() }
  writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`)
  return snapshot
}

const COMPARED_FIELDS = ['repo', 'branch', 'commit', 'dirty', 'diffDigest']

// Throws when the tree changed between the pre-compile snapshot and packaging:
// the bundle would then contain code the record does not describe.
export function assertSourceUnchanged(snapshot, current) {
  const changed = COMPARED_FIELDS.filter((field) => snapshot[field] !== current[field])
  if (changed.length > 0) {
    const detail = changed
      .map((field) => `${field}: ${snapshot[field]} -> ${current[field]}`)
      .join('; ')
    throw new Error(
      `The source tree changed while the build compiled (${detail}). Nothing was packaged; rebuild from a tree nobody is editing.`
    )
  }
}

export function writeBuildRecord(
  file,
  { sourceDir = dobiusDir, snapshotFile = defaultSnapshotFile(), buildNumber }
) {
  let snapshot
  try {
    snapshot = JSON.parse(readFileSync(snapshotFile, 'utf8'))
  } catch (error) {
    throw new Error(
      `No pre-compile source snapshot at ${snapshotFile} (${error.message}). Build through pnpm run build:unpack or build:mac.`
    )
  } finally {
    // One snapshot per build: never let a later build reuse it.
    rmSync(snapshotFile, { force: true })
  }
  assertSourceUnchanged(snapshot, collectSourceState(sourceDir))
  const record = { ...snapshot, buildNumber, builtAt: new Date().toISOString() }
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`)
  return record
}

function main(args) {
  if (args.length === 1 && args[0] === '--snapshot-source') {
    const snapshot = takeSourceSnapshot()
    console.log(
      `Dobius+ source snapshot: ${snapshot.branch}@${snapshot.commit}${snapshot.dirty ? ' (dirty)' : ''}`
    )
    return
  }
  const buildNumber = allocateBuildNumber()
  console.log(`Dobius+ build number: ${buildNumber}`)
  const recordDir = mkdtempSync(path.join(tmpdir(), 'dobius-build-provenance-'))
  const recordFile = path.join(recordDir, 'BUILD-PROVENANCE.json')
  let result
  try {
    writeBuildRecord(recordFile, { buildNumber })
    result = spawnSync('electron-builder', args, {
      stdio: 'inherit',
      // Why: on Windows the local bin is electron-builder.cmd, which needs a shell.
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        [BUILD_NUMBER_ENV]: String(buildNumber),
        [BUILD_PROVENANCE_ENV]: recordFile
      }
    })
  } finally {
    rmSync(recordDir, { recursive: true, force: true })
  }
  if (result.error) {
    throw result.error
  }
  process.exit(result.status ?? 1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
}
