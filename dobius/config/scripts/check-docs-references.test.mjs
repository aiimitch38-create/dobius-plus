import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CANONICAL_REPO,
  DOC_TARGETS,
  checkDoc,
  checkRepoDocs,
  installerExitCodes,
  installerOptions
} from './check-docs-references.mjs'

const repoRoot = path.resolve(import.meta.dirname, '../../..')
const script = path.join(import.meta.dirname, 'check-docs-references.mjs')
const dirs = []

const FIXTURE_INSTALLER = `#!/bin/bash
# exit 42 in a comment is not a real exit code
for arg in "$@"; do
  case "$arg" in
    --take-over) TAKE_OVER=1 ;;
    --allow-downgrade) ALLOW_DOWNGRADE=1 ;;
    *) exit 1 ;;
  esac
done
[ -n "$DOBIUS_INSTALL_DEST" ] || exit 5
exit 7
`

function fixtureRepo() {
  const root = mkdtempSync(path.join(tmpdir(), 'dobius-docs-check-'))
  dirs.push(root)
  mkdirSync(path.join(root, 'scripts'))
  mkdirSync(path.join(root, 'dobius/config/scripts'), { recursive: true })
  writeFileSync(path.join(root, 'scripts/install-dobius-gated.sh'), FIXTURE_INSTALLER)
  writeFileSync(
    path.join(root, 'dobius/package.json'),
    JSON.stringify({ scripts: { 'build:unpack': 'x', typecheck: 'x' } })
  )
  writeFileSync(path.join(root, 'dobius/config/scripts/real.mjs'), '')
  writeFileSync(path.join(root, 'build-and-install.sh'), '')
  return root
}

function check(root, text, target = {}) {
  return checkDoc({ repoRoot: root, file: 'DOC.md', text, target })
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('check-docs-references (#108 #116)', () => {
  it('every command, path, flag, exit code and variable in the real docs resolves', () => {
    expect(checkRepoDocs(repoRoot)).toEqual([])
  })

  it('covers the four docs the build rewrote', () => {
    expect(DOC_TARGETS.map((target) => target.file)).toEqual([
      'RELEASING.md',
      'CLAUDE.md',
      '.claude/CLAUDE.md',
      'dobius/AGENTS.md'
    ])
  })

  it('reads the installer options and exit codes from the real script', () => {
    const text = FIXTURE_INSTALLER
    expect([...installerOptions(text)]).toEqual(['--take-over', '--allow-downgrade'])
    expect([...installerExitCodes(text)].sort((a, b) => a - b)).toEqual([1, 5, 7])
  })

  it('flags the pre-BUILD-048 docs (verbatim excerpts)', () => {
    const oldRoot = [
      '- **Make code changes in this workspace:** `/Users/bayou/Projects (Code)/dobius-plus`.',
      '```bash',
      'npm run electron:build   # Build .app bundle (signed + notarized when APPLE_* env vars set)',
      './build-and-install.sh   # Build + install to /Applications',
      '```',
      '- `build-and-install.sh` MUST `rm -rf` old .app before `cp -R` (asar overwrite issue)'
    ].join('\n')
    const findings = check(repoRoot, oldRoot, DOC_TARGETS[1])
    expect(findings.join('\n')).toMatch(/uses npm/)
    expect(findings.join('\n')).toMatch(/advises rm -rf/)
    expect(findings.join('\n')).toMatch(/retired build-and-install\.sh/)
    expect(findings.join('\n')).toMatch(/hard-codes a user home path/)
    expect(findings.join('\n')).toMatch(/runs a retired installer/)
    expect(findings.join('\n')).toContain(`must mention ${CANONICAL_REPO}`)

    const oldReleasing = [
      '```bash',
      'npm version patch    # 1.0.1 -> 1.0.2 (bugfix)',
      'npm run electron:build -- --publish always',
      '```',
      'After a successful build, `dist-electron/` contains:'
    ].join('\n')
    const releasing = check(repoRoot, oldReleasing, DOC_TARGETS[0]).join('\n')
    expect(releasing).toMatch(/uses npm/)
    expect(releasing).toContain('path "dist-electron" does not exist')
    expect(releasing).toContain('has no "exit codes" section')

    const oldSkillAdvice = '- **`pkill -9 -f "Dobius[+][.]app"`**: the `+` must be bracket-escaped'
    expect(check(repoRoot, oldSkillAdvice).join('\n')).toMatch(/pkill -9[\s\S]*bundle path/)
  })

  it('reports a pnpm script that does not exist, and accepts one that does', () => {
    const root = fixtureRepo()
    expect(check(root, '`pnpm --dir dobius run build:unpack` and `pnpm run typecheck`')).toEqual([])
    expect(check(root, '`pnpm --dir dobius run build:nope`')).toEqual([
      'DOC.md: pnpm script "build:nope" is not in dobius/package.json'
    ])
    expect(check(root, '`pnpm --dir missing run x`')).toEqual([
      'DOC.md: pnpm --dir missing: no package.json there'
    ])
    expect(check(root, '`pnpm install` then `pnpm exec vitest`')).toEqual([])
  })

  it('reports a repo path that does not exist; exempts build outputs and home paths', () => {
    const root = fixtureRepo()
    expect(check(root, '`config/scripts/real.mjs` and `scripts/install-dobius-gated.sh`')).toEqual(
      []
    )
    expect(check(root, '`scripts/gone.sh`')).toEqual([
      'DOC.md: path "scripts/gone.sh" does not exist in the repo'
    ])
    expect(check(root, '```\nnode config/scripts/missing.mjs\n```')).toEqual([
      'DOC.md: path "config/scripts/missing.mjs" does not exist in the repo'
    ])
    const exempt = [
      '`dobius/dist/mac-arm64/Dobius+.app`',
      '`Contents/Resources/INSTALL-PROVENANCE.json`',
      '`~/Library/Application Support/dobius-plus/`',
      '```',
      'scripts/install-dobius-gated.sh "$HOME/Library/Application Support/x/Dobius+.previous"',
      '```'
    ].join('\n')
    expect(check(root, exempt)).toEqual([])
  })

  it('reports an installer flag the script does not accept', () => {
    const root = fixtureRepo()
    expect(
      check(root, '`scripts/install-dobius-gated.sh <app> [--take-over] [--allow-downgrade]`')
    ).toEqual([])
    expect(check(root, '`scripts/install-dobius-gated.sh <app> --force`')).toEqual([
      'DOC.md: installer option --force is not accepted by scripts/install-dobius-gated.sh'
    ])
    // Flags before the installer on the same line belong to another command.
    expect(
      check(root, '`pnpm --dir dobius run build:unpack`, then `scripts/install-dobius-gated.sh`')
    ).toEqual([])
  })

  it('requires the exit-code table to match the installer exactly, both ways', () => {
    const root = fixtureRepo()
    const table = (codes) =>
      ['### Installer exit codes', '', '| Exit | Meaning |', '|---|---|']
        .concat(codes.map((code) => `| ${code} | x |`))
        .concat(['', '## Next', '| 99 | not part of the table |'])
        .join('\n')
    const target = { installerExitTable: true }
    expect(check(root, table([1, 5, 7]), target)).toEqual([])
    expect(check(root, table([1, 7]), target)).toEqual([
      'DOC.md: installer exit 5 is not documented'
    ])
    expect(check(root, table([1, 5, 7, 2]), target)).toEqual([
      'DOC.md: documents installer exit 2, which scripts/install-dobius-gated.sh never uses'
    ])
    expect(check(root, 'no table', target)).toEqual([
      'DOC.md: has no "exit codes" section for the installer'
    ])
  })

  it('reports a DOBIUS_* variable nothing uses', () => {
    const root = fixtureRepo()
    expect(check(root, 'Set `DOBIUS_INSTALL_DEST`.')).toEqual([])
    expect(check(root, 'Set `DOBIUS_MADE_UP`.')).toEqual([
      'DOC.md: DOBIUS_MADE_UP is not used by the installer, dobius/config or dobius/src/main'
    ])
  })

  it('reports banned advice anywhere in the doc', () => {
    const root = fixtureRepo()
    const cases = [
      ['run `npm run build`', /uses npm/],
      ['then rm -rf the app', /advises rm -rf/],
      ['open ~/DobiusPlus first', /DobiusPlus/],
      ['`pkill -f "Dobius+.app"`', /kills by bundle path/],
      ['```\nscripts/install-dobius-v2.sh\n```', /runs a retired installer/]
    ]
    for (const [text, expected] of cases) {
      expect(check(root, text).join('\n')).toMatch(expected)
    }
    // Naming a retired script in prose (to say it is retired) is fine.
    expect(check(root, '`build-and-install.sh` is retired.')).toEqual([])
  })

  it('only checks the first section when asked (AGENTS.md style guidance uses example names)', () => {
    const root = fixtureRepo()
    const text =
      '# A\n\n## One\n`scripts/install-dobius-gated.sh`\n\n## Two\n`tab-group-state.ts`\n'
    expect(check(root, text, { firstSectionOnly: true })).toEqual([])
    expect(check(root, text)).toEqual([
      'DOC.md: path "tab-group-state.ts" does not exist in the repo'
    ])
  })

  it('CLI exits 0 on the real repo', () => {
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8' })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })
})
