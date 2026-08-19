// check_pipeline_hotstart: polled every few seconds during an active huddle
// (see vendor/buzz-desktop/src/features/huddle/HuddleContext.tsx) to notice
// when the voice model finishes downloading mid-call. The caller discards
// the resolved value and only cares that the call doesn't reject — so this
// reports real status (useful for logs/tests) without inventing a "warm-up"
// action Dobius's speech pipeline doesn't otherwise expose.
//
// This is filed under the workstation-git feature in the command manifest,
// but it has nothing to do with git — it belongs to the voice/huddle
// pipeline (communications/huddles/, owned by another agent on this branch).
// Implemented here anyway, using only the runtime handle every RPC method
// already receives, so the command isn't left unhandled.
import type { DobiusRuntimeService } from '../../runtime/dobius-runtime'

export type PipelineHotstartResult = { ready: boolean; selectedModelId: string }

export async function checkPipelineHotstart(runtime: DobiusRuntimeService): Promise<PipelineHotstartResult> {
  const setup = await runtime.listMobileSpeechModels()
  const selected = setup.models.find((model) => model.id === setup.selectedModelId)
  return {
    ready: setup.enabled && selected?.status === 'ready',
    selectedModelId: setup.selectedModelId
  }
}
