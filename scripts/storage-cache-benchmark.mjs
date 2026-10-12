#!/usr/bin/env node
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { performance } from 'node:perf_hooks'

const exec = promisify(execFile)
const bytes = Number(process.env.DOBIUS_CACHE_BENCH_BYTES || 8 * 1024 * 1024)
const storageVolume = process.env.DOBIUS_STORAGE_VOLUME || '/Volumes/Storage'
const storageRoot = process.env.DOBIUS_STORAGE_PATH || '/Volumes/Storage/dev'

async function factCheck() {
  const commands = [
    ['/usr/sbin/diskutil', ['info', storageVolume]],
    ['/usr/sbin/diskutil', ['list']],
    ['/usr/sbin/system_profiler', ['SPUSBDataType']],
    ['/usr/sbin/system_profiler', ['SPThunderboltDataType']],
  ]
  const results = {}
  for (const [file, args] of commands) {
    const key = args.join('_')
    try { results[key] = { ok: true, output: (await exec(file, args, { timeout: 15000, maxBuffer: 4 * 1024 * 1024 })).stdout } }
    catch (error) { results[key] = { ok: false, error: error.message, stdout: error.stdout || '', stderr: error.stderr || '' } }
  }
  return results
}

async function bench(root) {
  const dir = await mkdtemp(join(root, 'dobius-cache-bench-'))
  const file = join(dir, 'payload.bin')
  const payload = Buffer.alloc(bytes, 0x5a)
  const startWrite = performance.now(); await writeFile(file, payload); const writeMs = performance.now() - startWrite
  const startRead = performance.now(); const data = await readFile(file); const readMs = performance.now() - startRead
  await rm(dir, { recursive: true, force: true })
  return { root, bytes, writeMs: Number(writeMs.toFixed(2)), readMs: Number(readMs.toFixed(2)), verified: data.length === bytes }
}

export async function runBenchmark({ internalRoot = tmpdir(), storageRoot: benchmarkStorageRoot = storageRoot } = {}) {
  const facts = await factCheck()
  const [internal, external] = await Promise.all([bench(internalRoot), bench(benchmarkStorageRoot)])
  return { facts, benchmarks: { internal, storage: external }, generatedAt: new Date().toISOString() }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  console.log(JSON.stringify(await runBenchmark(), null, 2))
}
