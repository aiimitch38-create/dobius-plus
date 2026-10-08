#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname } from 'node:path'
import { envrcFor, laneManifest } from './terminal-infrastructure-policy.mjs'

const exec = promisify(execFile)

export async function createLane({ laneId, worktree, basePort, stateRoot, createWorktree = false, repo }) {
  if (createWorktree) {
    if (!repo) throw new Error('repo is required when createWorktree=true')
    await exec('/usr/bin/git', ['-C', repo, 'worktree', 'add', worktree, '-b', laneId])
  }
  const manifest = laneManifest({ laneId, worktree, basePort, stateRoot })
  await Promise.all([mkdir(manifest.logPath, { recursive: true }), mkdir(manifest.runtimeDataPath, { recursive: true }),
    mkdir(dirname(manifest.envrc), { recursive: true })])
  await writeFile(manifest.envrc, envrcFor(manifest), { mode: 0o600 })
  await writeFile(`${manifest.envrc}.json`, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
  return manifest
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const [laneId, worktree, basePort = '4300'] = process.argv.slice(2)
  if (!laneId || !worktree) throw new Error('usage: terminal-lane.mjs <lane-id> <worktree> [base-port]')
  console.log(JSON.stringify(await createLane({ laneId, worktree, basePort: Number(basePort) }), null, 2))
}
