#!/usr/bin/env node
// BUILD-045 (#114): print the active Node beside the one this repo requires
// (package.json engines.node, pinned for nvm/fnm in .nvmrc) and say whether
// they match. CI already reads engines.node (node-version-file: package.json);
// this makes a local mismatch visible instead of silent.
//
// Usage: node config/scripts/check-node-toolchain.mjs [--warn-only]
//   exit 0  active Node satisfies the requirement (or --warn-only)
//   exit 1  active Node does not satisfy it
//   exit 2  the requirement itself is unreadable, unsupported, or .nvmrc and
//           engines.node disagree (never downgraded by --warn-only)
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const projectDir = path.resolve(import.meta.dirname, '../..')

function majorOf(value) {
  const match = /^v?(\d+)(?:\.\d+){0,2}$/.exec(String(value ?? '').trim())
  return match ? Number(match[1]) : null
}

// Only a bare major ("24") is supported: that is what package.json declares and
// what actions/setup-node resolves. Anything else is reported, never guessed.
export function evaluateNodeToolchain({ activeVersion, engineRange, nvmrc }) {
  const requiredMajor = /^\d+$/.test(String(engineRange ?? '').trim())
    ? Number(String(engineRange).trim())
    : null
  if (requiredMajor === null) {
    return {
      status: 'invalid',
      message: `package.json engines.node is ${JSON.stringify(engineRange ?? null)}; expected a bare major version like "24".`
    }
  }
  if (nvmrc !== null && majorOf(nvmrc) !== requiredMajor) {
    return {
      status: 'invalid',
      message: `.nvmrc says ${JSON.stringify(nvmrc.trim())} but package.json engines.node says "${requiredMajor}"; keep them in sync.`
    }
  }
  const activeMajor = majorOf(activeVersion)
  const line = `Node toolchain: active ${activeVersion}, required ${requiredMajor}.x (package.json engines.node${nvmrc === null ? '' : ', .nvmrc'})`
  if (activeMajor === requiredMajor) {
    return { status: 'ok', message: `${line}: OK` }
  }
  return {
    status: 'mismatch',
    message: `${line}: MISMATCH. Install Node ${requiredMajor} and switch to it (nvm/fnm read dobius/.nvmrc).`
  }
}

export function readToolchainRequirement(dir = projectDir) {
  const packageJson = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
  const nvmrcPath = path.join(dir, '.nvmrc')
  return {
    engineRange: packageJson.engines?.node ?? null,
    nvmrc: existsSync(nvmrcPath) ? readFileSync(nvmrcPath, 'utf8') : null
  }
}

export function main(argv = process.argv.slice(2), dir = projectDir) {
  const warnOnly = argv.includes('--warn-only')
  const result = evaluateNodeToolchain({
    activeVersion: process.version,
    ...readToolchainRequirement(dir)
  })
  if (result.status === 'ok') {
    console.log(result.message)
    return 0
  }
  if (result.status === 'invalid') {
    console.error(`ERROR: ${result.message}`)
    return 2
  }
  console.error(`${warnOnly ? 'WARNING' : 'ERROR'}: ${result.message}`)
  return warnOnly ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main()
}
