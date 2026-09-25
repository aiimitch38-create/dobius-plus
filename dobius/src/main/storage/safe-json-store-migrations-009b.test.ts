import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// BUILD-009B: the stores BUILD-009 did not migrate. Same contract as
// safe-json-store-migrations.test.ts: an unreadable file is never overwritten.

const electronMock = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => electronMock.userDataDir) },
  BrowserWindow: { getAllWindows: vi.fn(() => []) }
}))
vi.mock('../asana/asana-token-store', () => ({ hasAsanaToken: () => true }))
vi.mock('../asana/asana-config', () => ({
  getAsanaConfig: () => ({ myGid: '', reviewGid: '' })
}))
vi.mock('../asana/asana-client', () => ({ fetchLane: vi.fn(), markTaskComplete: vi.fn() }))

const BAD_BYTES = '[{"id": "truncated", "na'

type StoreCase = {
  store: string
  fileName: string
  run: () => Promise<void>
}

// Each case loads the store, then attempts every kind of save it offers.
const storeCases: StoreCase[] = [
  {
    store: 'agent-local-overrides-store',
    fileName: 'communications-agent-overrides.json',
    run: async () => {
      const store = await import('../communications/agents/agent-local-overrides-store')
      expect(store.getAgentLocalOverrides('a')).toEqual({})
      expect(() => store.setAgentLocalOverride('a', 'active', true)).toThrow(/could not be saved/)
    }
  },
  {
    store: 'custom-harness-store',
    fileName: 'communications-custom-harnesses.json',
    run: async () => {
      const store = await import('../communications/agents/custom-harness-store')
      expect(store.listCustomHarnesses()).toEqual([])
      const definition = {
        id: 'h',
        label: 'H',
        command: 'h',
        args: [],
        env: {},
        installInstructionsUrl: '',
        installHint: ''
      }
      expect(() => store.saveCustomHarness(definition)).toThrow(/could not be saved/)
      expect(() => store.deleteCustomHarness('h')).toThrow(/could not be saved/)
    }
  },
  {
    store: 'global-agent-config-store',
    fileName: 'communications-global-agent-config.json',
    run: async () => {
      const store = await import('../communications/agents/global-agent-config-store')
      expect(store.getGlobalAgentConfig().env_vars).toEqual({})
      expect(() =>
        store.setGlobalAgentConfig({
          env_vars: { A: 'b' },
          provider: null,
          model: null,
          preferred_runtime: null
        })
      ).toThrow(/could not be saved/)
      expect(() => store.setAgentManagedProfiles(true)).toThrow(/could not be saved/)
    }
  },
  {
    store: 'observer-channel-index-store',
    fileName: 'communications-observer-channel-index.json',
    run: async () => {
      const store = await import('../communications/agents/observer-channel-index-store')
      expect(store.readIndexedEventsForChannel('c')).toEqual([])
      expect(() =>
        store.indexObserverChannelIds([{ eventId: 'e', channelId: 'c', createdAt: 1 }])
      ).toThrow(/could not be saved/)
    }
  },
  {
    store: 'channel-template-store',
    fileName: 'channel-templates.json',
    run: async () => {
      const store = await import('../communications/canvas/channel-template-store')
      expect(store.listChannelTemplates()).toEqual([])
      const [created] = store.createChannelTemplate({ name: 'T' })
      store.updateChannelTemplate(created.id, { name: 'U' })
      store.duplicateChannelTemplate(created.id)
      store.removeChannelTemplate(created.id)
    }
  },
  {
    store: 'save-subscription-store',
    fileName: 'save-subscriptions.json',
    run: async () => {
      const store = await import('../communications/canvas/save-subscription-store')
      expect(store.listSaveSubscriptions('pk', 'ws://relay')).toEqual([])
      store.createSaveSubscription('pk', 'ws://relay', 'owner_p', 'pk', [1])
      store.mergeSaveSubscriptionKinds('pk', 'ws://relay', 2)
      store.removeSaveSubscriptionKind('pk', 'ws://relay', 2)
      store.deleteSaveSubscription('pk', 'ws://relay', 'owner_p', 'pk')
    }
  },
  {
    store: 'workflow-run-store',
    fileName: 'workflow-runs.json',
    run: async () => {
      const store = await import('../communications/workflows/workflow-run-store')
      expect(store.listRuns('w')).toEqual([])
      store.appendRun({
        id: 'r',
        workflowId: 'w',
        status: 'completed',
        currentStep: null,
        executionTrace: [],
        startedAt: null,
        completedAt: null,
        errorMessage: null,
        createdAt: 1
      })
      store.removeRunsForWorkflow('w')
    }
  },
  {
    store: 'workflow-store',
    fileName: 'workflows.json',
    run: async () => {
      const store = await import('../communications/workflows/workflow-store')
      expect(store.listAllWorkflows()).toEqual([])
      const created = store.createWorkflow({
        ownerPubkey: 'owner',
        channelId: null,
        yamlDefinition: 'name: W'
      })
      store.updateWorkflow(created.id, { yamlDefinition: 'name: W2' })
      store.removeWorkflow(created.id)
    }
  },
  {
    store: 'destinations-store',
    fileName: 'destinations.json',
    run: async () => {
      const store = await import('../destinations/destinations-store')
      expect(store.listDestinations()).toEqual([])
      const saved = store.saveDestination({ name: 'n', type: 'system', config: {} })
      store.deleteDestination(saved.id)
    }
  },
  {
    store: 'prompts-store',
    fileName: 'prompts.json',
    run: async () => {
      const store = await import('../prompts/prompts-store')
      expect(store.listPrompts()).toEqual([])
      const [saved] = store.savePrompt({ title: 't', text: 'x' })
      store.deletePrompt(saved.id)
    }
  },
  {
    store: 'asana-queue-service (local done)',
    fileName: 'asana-local-done.json',
    run: async () => {
      const store = await import('../asana/asana-queue-service')
      expect(store.getAsanaSnapshot().localDone).toEqual([])
      expect(store.markLocalDone('1234567').localDone).toEqual(['1234567'])
      store.clearLocalDone('1234567')
    }
  }
]

// JSON-valid files holding one malformed entry next to a valid one. The
// malformed entry must make the file unreadable, never be dropped and saved over.
const validHarness = {
  id: 'h1',
  label: 'H',
  command: 'h',
  args: [],
  env: {},
  installInstructionsUrl: '',
  installHint: ''
}
const validRun = {
  id: 'r1',
  workflowId: 'w',
  status: 'completed',
  currentStep: null,
  executionTrace: [],
  startedAt: null,
  completedAt: null,
  errorMessage: null,
  createdAt: 1
}
const validWorkflow = {
  id: 'w1',
  name: 'W',
  ownerPubkey: 'owner',
  channelId: null,
  definitionYaml: 'name: W',
  status: 'active',
  webhookSecret: 'secret',
  createdAt: 1,
  updatedAt: 1
}
const validSubscription = {
  identityPubkey: 'pk',
  relayUrl: 'ws://relay',
  scopeType: 'owner_p',
  scopeValue: 'pk',
  kinds: [1],
  createdAt: 1
}
const malformedEntryFiles: Record<string, unknown> = {
  'communications-agent-overrides.json': { a1: { active: true }, a2: 5 },
  'communications-custom-harnesses.json': { h1: validHarness, h2: { id: 'h2' } },
  'communications-global-agent-config.json': [{ config: {} }],
  'communications-observer-channel-index.json': {
    e1: { eventId: 'e1', channelId: 'c', createdAt: 1 },
    e2: { eventId: 'e2' }
  },
  'channel-templates.json': [{ id: 't1', name: 'T' }, { id: 't2' }],
  'save-subscriptions.json': [validSubscription, { ...validSubscription, scopeType: 'nope' }],
  'workflow-runs.json': { w: [validRun, { id: 'r2' }] },
  'workflows.json': [validWorkflow, { ...validWorkflow, id: 'w2', definitionYaml: '[not a mapping]' }],
  'destinations.json': [
    { id: 'd1', name: 'n', type: 'system', config: {} },
    { id: 'd2', type: 'fax' }
  ],
  'prompts.json': [{ id: 'p1', title: 't', text: 'x', createdAt: 1 }, { id: 'p2' }],
  'asana-local-done.json': ['111', 222]
}

beforeEach(() => {
  electronMock.userDataDir = mkdtempSync(path.join(tmpdir(), 'dobius-store-migrations-009b-'))
  vi.resetModules()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  rmSync(electronMock.userDataDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function expectUntouched(fileName: string, text: string, mtimeMs: number): void {
  const target = path.join(electronMock.userDataDir, fileName)
  expect(readFileSync(target, 'utf-8')).toBe(text)
  expect(statSync(target).mtimeMs).toBe(mtimeMs)
  const names = readdirSync(electronMock.userDataDir)
  expect(names.filter((name) => name.endsWith('.tmp'))).toEqual([])
  expect(names.filter((name) => name.startsWith(`${fileName}.unreadable-`))).toHaveLength(1)
}

describe('BUILD-009B stores never overwrite an unreadable file', () => {
  it.each(storeCases)('$store ($fileName)', async ({ fileName, run }) => {
    const target = path.join(electronMock.userDataDir, fileName)
    writeFileSync(target, BAD_BYTES, 'utf-8')
    const before = statSync(target)

    await run()

    expectUntouched(fileName, BAD_BYTES, before.mtimeMs)
  })
})

describe('BUILD-009B stores never drop a malformed entry and save over it', () => {
  it.each(storeCases)('$store ($fileName)', async ({ fileName, run }) => {
    const target = path.join(electronMock.userDataDir, fileName)
    const text = JSON.stringify(malformedEntryFiles[fileName])
    writeFileSync(target, text, 'utf-8')
    const before = statSync(target)

    await run()

    expectUntouched(fileName, text, before.mtimeMs)
  })
})

describe('BUILD-009B stores still load well-formed files', () => {
  it('loads the valid entries of every store without quarantining anything', async () => {
    for (const [fileName, content] of Object.entries(malformedEntryFiles)) {
      const valid = Array.isArray(content)
        ? content.slice(0, 1)
        : fileName === 'workflow-runs.json'
          ? { w: [validRun] }
          : fileName === 'communications-global-agent-config.json'
            ? { config: {} }
            : Object.fromEntries(Object.entries(content as object).slice(0, 1))
      writeFileSync(path.join(electronMock.userDataDir, fileName), JSON.stringify(valid))
    }
    // The global config fixture above is an array; give it a valid object.
    writeFileSync(
      path.join(electronMock.userDataDir, 'communications-global-agent-config.json'),
      JSON.stringify({ config: { model: 'm' }, agentManagedProfiles: true })
    )
    const overrides = await import('../communications/agents/agent-local-overrides-store')
    const harnesses = await import('../communications/agents/custom-harness-store')
    const globalConfig = await import('../communications/agents/global-agent-config-store')
    const observer = await import('../communications/agents/observer-channel-index-store')
    const templates = await import('../communications/canvas/channel-template-store')
    const subscriptions = await import('../communications/canvas/save-subscription-store')
    const runs = await import('../communications/workflows/workflow-run-store')
    const workflows = await import('../communications/workflows/workflow-store')
    const destinations = await import('../destinations/destinations-store')
    const prompts = await import('../prompts/prompts-store')
    const asana = await import('../asana/asana-queue-service')

    expect(overrides.getAgentLocalOverrides('a1')).toEqual({ active: true })
    expect(harnesses.listCustomHarnesses().map((entry) => entry.id)).toEqual(['h1'])
    expect(globalConfig.getGlobalAgentConfig().model).toBe('m')
    expect(globalConfig.getAgentManagedProfiles()).toBe(true)
    expect(observer.readIndexedEventsForChannel('c').map((entry) => entry.eventId)).toEqual(['e1'])
    expect(templates.listChannelTemplates().map((entry) => entry.id)).toEqual(['t1'])
    expect(subscriptions.listSaveSubscriptions('pk', 'ws://relay')).toHaveLength(1)
    expect(runs.listRuns('w').map((run) => run.id)).toEqual(['r1'])
    expect(workflows.listAllWorkflows().map((workflow) => workflow.id)).toEqual(['w1'])
    expect(destinations.listDestinations().map((entry) => entry.id)).toEqual(['d1'])
    expect(prompts.listPrompts().map((entry) => entry.id)).toEqual(['p1'])
    expect(asana.getAsanaSnapshot().localDone).toEqual(['111'])
    const names = readdirSync(electronMock.userDataDir)
    expect(names.filter((name) => name.includes('.unreadable-'))).toEqual([])
  })

  it('a missing file keeps the first-run default and saves normally', async () => {
    const prompts = await import('../prompts/prompts-store')
    expect(prompts.listPrompts()).toEqual([])
    expect(readdirSync(electronMock.userDataDir)).toEqual([])
    prompts.savePrompt({ title: 't', text: 'x' })
    const saved = JSON.parse(
      readFileSync(path.join(electronMock.userDataDir, 'prompts.json'), 'utf-8')
    ) as { title: string }[]
    expect(saved.map((prompt) => prompt.title)).toEqual(['t'])
  })
})
