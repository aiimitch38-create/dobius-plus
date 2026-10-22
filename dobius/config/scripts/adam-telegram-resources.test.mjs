import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const config = require('../electron-builder.config.cjs')
const directory = join(process.cwd(), 'resources', 'adam-telegram')
const modules = [
  'bridge_runner',
  'bridge_protocol',
  'bridge_receipts',
  'bridge_dispatch',
  'gateway_host',
  'platform_adapter',
  'policy_manifest'
]

describe('packaged Adam Telegram gateway resources', () => {
  it('ships the private-pipe runtime and enforcement artifacts outside asar on every platform', () => {
    expect(config.files).toContain('!resources/adam-telegram/**')
    for (const platform of ['mac', 'linux', 'win']) {
      expect(config[platform].extraResources).toContainEqual({
        from: 'resources/adam-telegram',
        to: 'adam-telegram',
        filter: [
          '*.py',
          '*.json',
          '*.patch',
          '!test_*.py',
          '!gateway_fixture.py',
          '!__pycache__/**'
        ]
      })
    }
    for (const name of [
      ...modules.map((name) => `${name}.py`),
      'hermes-core-policy-manifest.json',
      'hermes-core-policy.patch'
    ]) {
      expect(readFileSync(join(directory, name)).length).toBeGreaterThan(0)
    }
  })

  it('includes the complete local Python import closure without test fixtures', () => {
    const available = new Set(
      readdirSync(directory)
        .filter((name) => name.endsWith('.py'))
        .map((name) => name.slice(0, -3))
    )
    const production = [...available].filter(
      (name) => !name.startsWith('test_') && name !== 'gateway_fixture'
    )
    expect(production.sort()).toEqual([...modules].sort())
    for (const module of modules) {
      const source = readFileSync(join(directory, `${module}.py`), 'utf8')
      for (const match of source.matchAll(/^\s*(?:from|import) ([a-z_]+)\b/gm)) {
        if (available.has(match[1])) {
          expect(modules).toContain(match[1])
        }
      }
    }
  })

  it('binds the maintained enforcement patch to the packaged manifest digest', () => {
    const manifest = JSON.parse(
      readFileSync(join(directory, 'hermes-core-policy-manifest.json'), 'utf8')
    )
    const digest = createHash('sha256')
      .update(readFileSync(join(directory, 'hermes-core-policy.patch')))
      .digest('hex')
    expect(JSON.stringify(manifest)).toContain(digest)
  })
})
