// Why this exists: config/tsconfig.cli.json includes
// src/main/agent-hooks/managed-agent-hook-controls.ts so the CLI's own
// typecheck can resolve src/cli/handlers/agent-hooks.ts's import of it. But
// electron.vite.config.ts ALSO declares that same file as its own Rollup
// entry (for the main process), emitting to the identical output path,
// out/main/agent-hooks/managed-agent-hook-controls.js — with everything it
// depends on correctly inlined. tsc's plain per-file compile of the same
// source, run for the CLI, emits a stripped-down stand-in at that same path
// with none of that inlined. Whichever tool runs last wins on disk.
//
// build:cli has to run AFTER build:electron-vite regardless (electron-vite's
// "main" target empties the whole out/main/ directory before writing its own
// bundle, which would erase every other out/main/<provider>/*.js file the
// CLI needs if cli ran first — see LESSONS-LEARNED.md, 2026-09-03). That
// makes tsc the last writer for this one file too, which is wrong for it
// specifically. This script snapshots Rollup's correct version right after
// build:electron-vite, then restores it right after build:cli overwrites it.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dobiusRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const targetPath = path.join(
  dobiusRoot,
  'out',
  'main',
  'agent-hooks',
  'managed-agent-hook-controls.js'
)
const backupPath = path.join(dobiusRoot, 'out', '.rollup-managed-agent-hook-controls.backup.js')

const mode = process.argv[2]

if (mode === '--save') {
  if (!existsSync(targetPath)) {
    console.error(`[preserve-rollup-hook-controls] expected Rollup output missing: ${targetPath}`)
    process.exit(1)
  }
  mkdirSync(path.dirname(backupPath), { recursive: true })
  copyFileSync(targetPath, backupPath)
} else if (mode === '--restore') {
  if (!existsSync(backupPath)) {
    console.error(`[preserve-rollup-hook-controls] no backup to restore: ${backupPath}`)
    process.exit(1)
  }
  copyFileSync(backupPath, targetPath)
} else {
  console.error('[preserve-rollup-hook-controls] usage: --save | --restore')
  process.exit(1)
}
