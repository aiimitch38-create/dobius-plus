import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { evaluateNodeToolchain, readToolchainRequirement } from './check-node-toolchain.mjs'

const projectDir = path.resolve(import.meta.dirname, '../..')
const script = path.join(import.meta.dirname, 'check-node-toolchain.mjs')
const dirs = []

function fixtureProject(engineNode, nvmrc) {
  const dir = mkdtempSync(path.join(tmpdir(), 'dobius-node-toolchain-'))
  dirs.push(dir)
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(engineNode === undefined ? {} : { engines: { node: engineNode } })
  )
  if (nvmrc !== undefined) {
    writeFileSync(path.join(dir, '.nvmrc'), nvmrc)
  }
  return dir
}

function runMain(dir, args = []) {
  // Runs main() against a fixture dir under the ACTIVE Node, whatever it is.
  const code = `import('${pathToFileURL(script).href}').then((m) => { process.exitCode = m.main(${JSON.stringify(args)}, ${JSON.stringify(dir)}) })`
  return spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' })
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('check-node-toolchain (#114)', () => {
  it('pins the repo to Node 24 in both package.json engines and .nvmrc', () => {
    const requirement = readToolchainRequirement(projectDir)
    expect(requirement.engineRange).toBe('24')
    expect(requirement.nvmrc?.trim()).toBe('24')
  })

  it('prints active vs required and passes on a matching major', () => {
    const result = evaluateNodeToolchain({
      activeVersion: 'v24.3.1',
      engineRange: '24',
      nvmrc: '24\n'
    })
    expect(result.status).toBe('ok')
    expect(result.message).toBe(
      'Node toolchain: active v24.3.1, required 24.x (package.json engines.node, .nvmrc): OK'
    )
  })

  it('reports a mismatch with both versions', () => {
    const result = evaluateNodeToolchain({
      activeVersion: 'v22.22.3',
      engineRange: '24',
      nvmrc: '24'
    })
    expect(result.status).toBe('mismatch')
    expect(result.message).toContain('active v22.22.3, required 24.x')
    expect(result.message).toContain('MISMATCH')
  })

  it('refuses to guess an unsupported range or a drifted .nvmrc', () => {
    expect(
      evaluateNodeToolchain({ activeVersion: 'v24.0.0', engineRange: '>=22', nvmrc: null }).status
    ).toBe('invalid')
    expect(
      evaluateNodeToolchain({ activeVersion: 'v24.0.0', engineRange: undefined, nvmrc: null })
        .status
    ).toBe('invalid')
    const drift = evaluateNodeToolchain({
      activeVersion: 'v24.0.0',
      engineRange: '24',
      nvmrc: '22'
    })
    expect(drift.status).toBe('invalid')
    expect(drift.message).toContain('.nvmrc says "22"')
  })

  it('CLI: fails on a mismatch, --warn-only prints the same line and exits 0', () => {
    const activeMajor = Number(process.versions.node.split('.')[0])
    const otherMajor = String(activeMajor + 1)
    const dir = fixtureProject(otherMajor, `${otherMajor}\n`)

    const strict = runMain(dir)
    expect(strict.status).toBe(1)
    expect(strict.stderr).toContain(
      `ERROR: Node toolchain: active ${process.version}, required ${otherMajor}.x`
    )

    const warn = runMain(dir, ['--warn-only'])
    expect(warn.status).toBe(0)
    expect(warn.stderr).toContain(
      `WARNING: Node toolchain: active ${process.version}, required ${otherMajor}.x`
    )
  })

  it('CLI: passes under a matching Node and --warn-only never hides a broken requirement', () => {
    const activeMajor = process.versions.node.split('.')[0]
    const ok = runMain(fixtureProject(activeMajor, activeMajor))
    expect(ok.status).toBe(0)
    expect(ok.stdout).toContain(`active ${process.version}, required ${activeMajor}.x`)

    const broken = runMain(fixtureProject(activeMajor, '99'), ['--warn-only'])
    expect(broken.status).toBe(2)
    expect(broken.stderr).toContain('keep them in sync')
  })

  it('is wired into the build scripts (warn for local builds, strict for release)', () => {
    const { scripts } = JSON.parse(readFileSync(path.join(projectDir, 'package.json'), 'utf8'))
    expect(scripts['build:unpack']).toMatch(
      /^node config\/scripts\/check-node-toolchain\.mjs --warn-only && /
    )
    expect(scripts['build:mac']).toMatch(
      /^node config\/scripts\/check-node-toolchain\.mjs --warn-only && /
    )
    expect(scripts['build:mac:release']).toMatch(
      /^node config\/scripts\/check-node-toolchain\.mjs && /
    )
  })
})
