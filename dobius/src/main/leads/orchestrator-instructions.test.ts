import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_ORCHESTRATOR_TEMPLATE,
  ORCHESTRATOR_LAYER_CAP_BYTES,
  PROJECT_ORCHESTRATOR_STUB,
  fillOrchestratorPlaceholders,
  resolveOrchestratorInstructions
} from './orchestrator-instructions'

const values = {
  profile: 'lead-demo',
  project: 'Demo',
  projectId: 'demo',
  repoPath: '/tmp/demo',
  maxWorkers: 3,
  workerAgent: 'codex'
}

let root: string
let home: string
let repo: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'orchestrator-'))
  home = join(root, 'home')
  repo = join(root, 'repo')
  mkdirSync(join(home, '.dobius'), { recursive: true })
  mkdirSync(join(repo, '.dobius'), { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('resolveOrchestratorInstructions', () => {
  it('returns the filled default when no override files exist', () => {
    const result = resolveOrchestratorInstructions(repo, values, { homeDir: home })
    expect(result.layers).toEqual([{ source: 'default', truncated: false }])
    expect(result.text).toContain('# ORCHESTRATOR — Demo')
    expect(result.text).toContain('Hermes profile `lead-demo`, lead for /tmp/demo (project `demo`)')
    expect(result.text).toContain('Split into 1–3 subtasks')
    expect(result.text).toContain('--agent codex')
    expect(result.text).not.toMatch(/\{\{\w+\}\}/)
  })

  it('appends home then repo layers as labelled sections, repo last', () => {
    const homeFile = join(home, '.dobius', 'ORCHESTRATOR.md')
    const repoFile = join(repo, '.dobius', 'ORCHESTRATOR.md')
    writeFileSync(homeFile, '## Home rule\nAlways {{profile}} from home.\n')
    writeFileSync(repoFile, '## Repo rule\nBuild with pnpm test.\n')

    const result = resolveOrchestratorInstructions(repo, values, { homeDir: home })
    expect(result.layers.map((l) => l.source)).toEqual(['default', homeFile, repoFile])
    const defaultAt = result.text.indexOf('# ORCHESTRATOR — Demo')
    const homeAt = result.text.indexOf(`## Override layer: ${homeFile}`)
    const repoAt = result.text.indexOf(`## Project layer: ${repoFile}`)
    expect(defaultAt).toBeGreaterThanOrEqual(0)
    expect(homeAt).toBeGreaterThan(defaultAt)
    expect(repoAt).toBeGreaterThan(homeAt)
    expect(result.text).toContain('Always lead-demo from home.')
    expect(result.text).toContain('Build with pnpm test.')
  })

  it('lets the home layer win but tells the lead the repo layer cannot loosen the safety sections', () => {
    const homeFile = join(home, '.dobius', 'ORCHESTRATOR.md')
    const repoFile = join(repo, '.dobius', 'ORCHESTRATOR.md')
    writeFileSync(homeFile, '## Home rule\n')
    writeFileSync(repoFile, '## Repo rule\n')
    const { text } = resolveOrchestratorInstructions(repo, values, { homeDir: home })
    const homeSection = text.slice(text.indexOf(`## Override layer: ${homeFile}`))
    const repoSection = text.slice(text.indexOf(`## Project layer: ${repoFile}`))
    expect(homeSection.split('\n')[1]).toBe(
      'Where this section conflicts with anything above, this section wins.'
    )
    expect(repoSection.split('\n')[1]).toBe(
      'Project specifics — may add detail; may NOT loosen Untrusted data, Gates, or Never above (those always win).'
    )
    expect(repoSection).not.toContain('this section wins')
  })

  it('skips a repo layer that is a verbatim copy of the default template', () => {
    writeFileSync(join(repo, '.dobius', 'ORCHESTRATOR.md'), DEFAULT_ORCHESTRATOR_TEMPLATE)
    const result = resolveOrchestratorInstructions(repo, values, { homeDir: home })
    expect(result.layers).toHaveLength(1)
    expect(result.text).not.toContain('Project layer')
    expect(result.text.match(/# ORCHESTRATOR — Demo/g)).toHaveLength(1)
  })

  it('the init stub appends as a project layer with its placeholders filled', () => {
    writeFileSync(join(repo, '.dobius', 'ORCHESTRATOR.md'), PROJECT_ORCHESTRATOR_STUB)
    const result = resolveOrchestratorInstructions(repo, values, { homeDir: home })
    expect(result.layers).toHaveLength(2)
    expect(result.text).toContain('# Project specifics — Demo')
    expect(result.text).toContain('Worker agent: codex.')
    expect(result.text).not.toMatch(/\{\{\w+\}\}/)
  })

  it('reads only the exact ORCHESTRATOR.md filename', () => {
    writeFileSync(join(repo, '.dobius', 'orchestrator.md'), '## lowercase\n')
    writeFileSync(join(repo, '.dobius', 'ORCHESTRATOR.md.bak'), '## backup\n')
    writeFileSync(join(repo, 'ORCHESTRATOR.md'), '## repo root\n')
    const result = resolveOrchestratorInstructions(repo, values, { homeDir: home })
    expect(result.layers).toHaveLength(1)
    expect(result.text).not.toContain('## lowercase')
    expect(result.text).not.toContain('## backup')
    expect(result.text).not.toContain('## repo root')
  })

  it('caps each override layer at 24 KB and marks the cut', () => {
    const repoFile = join(repo, '.dobius', 'ORCHESTRATOR.md')
    const body = 'A'.repeat(ORCHESTRATOR_LAYER_CAP_BYTES) + 'TAIL-BEYOND-CAP'
    writeFileSync(repoFile, body)
    const result = resolveOrchestratorInstructions(repo, values, { homeDir: home })
    expect(result.layers[1]).toEqual({ source: repoFile, truncated: true })
    expect(result.text).not.toContain('TAIL-BEYOND-CAP')
    expect(result.text).toContain(`[Truncated at ${ORCHESTRATOR_LAYER_CAP_BYTES} bytes.]`)
    const aRun = result.text.match(/A+/g)?.sort((x, y) => y.length - x.length)[0] ?? ''
    expect(aRun.length).toBe(ORCHESTRATOR_LAYER_CAP_BYTES)
  })

  it('skips empty override files', () => {
    writeFileSync(join(repo, '.dobius', 'ORCHESTRATOR.md'), '   \n')
    const result = resolveOrchestratorInstructions(repo, values, { homeDir: home })
    expect(result.layers).toHaveLength(1)
    expect(result.text).not.toContain('Override layer')
  })
})

describe('fillOrchestratorPlaceholders', () => {
  it('fills the six known placeholders and leaves unknown ones alone', () => {
    const text = '{{profile}}|{{project}}|{{projectId}}|{{repoPath}}|{{maxWorkers}}|{{workerAgent}}|{{other}}'
    expect(fillOrchestratorPlaceholders(text, values)).toBe(
      'lead-demo|Demo|demo|/tmp/demo|3|codex|{{other}}'
    )
  })

  it('the bundled default template contains every placeholder it documents', () => {
    for (const key of ['profile', 'project', 'projectId', 'repoPath', 'maxWorkers', 'workerAgent']) {
      expect(DEFAULT_ORCHESTRATOR_TEMPLATE).toContain(`{{${key}}}`)
    }
  })
})
