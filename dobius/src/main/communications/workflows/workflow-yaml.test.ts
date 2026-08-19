import { describe, expect, it } from 'vitest'
import { MAX_WORKFLOW_YAML_BYTES, parseWorkflowYaml } from './workflow-yaml'

describe('parseWorkflowYaml', () => {
  it('parses a mapping with a steps list', () => {
    const result = parseWorkflowYaml(`
name: Ticket Triage
status: active
steps:
  - id: greet
    type: log
    with:
      message: hello
  - type: noop
`)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.definition.name).toBe('Ticket Triage')
    expect(result.definition.status).toBe('active')
    expect(result.definition.steps).toEqual([
      { id: 'greet', type: 'log', with: { message: 'hello' } },
      { id: 'step-2', type: 'noop', with: {} }
    ])
    expect(result.definition.raw).toMatchObject({ name: 'Ticket Triage' })
  })

  it('defaults name/status to null when absent', () => {
    const result = parseWorkflowYaml('steps: []')
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.definition.name).toBeNull()
    expect(result.definition.status).toBeNull()
    expect(result.definition.steps).toEqual([])
  })

  it('ignores an unrecognized status value rather than throwing', () => {
    const result = parseWorkflowYaml('status: banana\nsteps: []')
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.definition.status).toBeNull()
  })

  it('de-dupes blank/duplicate step ids deterministically', () => {
    const result = parseWorkflowYaml(`
steps:
  - id: same
    type: log
  - id: same
    type: log
`)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.definition.steps.map((s) => s.id)).toEqual(['same', 'same-2'])
  })

  it('rejects empty input', () => {
    expect(parseWorkflowYaml('')).toEqual({ ok: false, reason: 'Workflow definition is empty' })
    expect(parseWorkflowYaml('   ')).toEqual({ ok: false, reason: 'Workflow definition is empty' })
  })

  it('rejects non-mapping YAML (scalar)', () => {
    const result = parseWorkflowYaml('just a string')
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.reason).toMatch(/must be a YAML mapping/)
  })

  it('rejects non-mapping YAML (list)', () => {
    const result = parseWorkflowYaml('- a\n- b')
    expect(result.ok).toBe(false)
  })

  it('rejects invalid YAML syntax', () => {
    const result = parseWorkflowYaml('steps: [unterminated')
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.reason).toMatch(/Invalid YAML/)
  })

  it('rejects a definition over the byte cap', () => {
    const huge = `name: ${'a'.repeat(MAX_WORKFLOW_YAML_BYTES + 1)}`
    const result = parseWorkflowYaml(huge)
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.reason).toMatch(/exceeds/)
  })

  it('ignores non-object entries inside steps', () => {
    const result = parseWorkflowYaml('steps: [1, "two", null, {id: ok, type: log}]')
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.definition.steps).toEqual([{ id: 'ok', type: 'log', with: {} }])
  })
})
