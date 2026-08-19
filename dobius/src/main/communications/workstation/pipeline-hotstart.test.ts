import { describe, expect, it } from 'vitest'
import { checkPipelineHotstart } from './pipeline-hotstart'
import type { DobiusRuntimeService } from '../../runtime/dobius-runtime'

function fakeRuntime(setup: {
  enabled: boolean
  selectedModelId: string
  models: { id: string; status: string }[]
}): DobiusRuntimeService {
  return {
    listMobileSpeechModels: async () => setup
  } as unknown as DobiusRuntimeService
}

describe('checkPipelineHotstart', () => {
  it('reports ready when the selected model has finished downloading', async () => {
    const runtime = fakeRuntime({
      enabled: true,
      selectedModelId: 'parakeet-tdt-0.6b-v3-int8',
      models: [{ id: 'parakeet-tdt-0.6b-v3-int8', status: 'ready' }]
    })
    expect(await checkPipelineHotstart(runtime)).toEqual({ ready: true, selectedModelId: 'parakeet-tdt-0.6b-v3-int8' })
  })

  it('reports not ready while the selected model is still downloading', async () => {
    const runtime = fakeRuntime({
      enabled: true,
      selectedModelId: 'parakeet-tdt-0.6b-v3-int8',
      models: [{ id: 'parakeet-tdt-0.6b-v3-int8', status: 'downloading' }]
    })
    expect(await checkPipelineHotstart(runtime)).toEqual({ ready: false, selectedModelId: 'parakeet-tdt-0.6b-v3-int8' })
  })

  it('reports not ready when dictation is disabled entirely', async () => {
    const runtime = fakeRuntime({
      enabled: false,
      selectedModelId: 'parakeet-tdt-0.6b-v3-int8',
      models: [{ id: 'parakeet-tdt-0.6b-v3-int8', status: 'ready' }]
    })
    expect((await checkPipelineHotstart(runtime)).ready).toBe(false)
  })
})
