import { useAppStore } from '@/store'
import { getBoard } from '@/store/slices/board'
import {
  MAX_PRESETS_PER_REPO,
  capturePreset,
  sanitizePresetsByRepo,
  type BoardPreset
} from './board-preset'

// ponytail: presets are read/written straight through persisted UI when the
// studio opens or saves; no store slice, since nothing else reads them.

async function readAll(): Promise<Record<string, BoardPreset[]>> {
  return sanitizePresetsByRepo((await window.api.ui.get()).boardPresetsByRepo)
}

export async function listBoardPresets(repoId: string): Promise<BoardPreset[]> {
  return (await readAll())[repoId] ?? []
}

async function writeRepo(repoId: string, list: BoardPreset[]): Promise<BoardPreset[]> {
  const all = await readAll()
  all[repoId] = list.slice(0, MAX_PRESETS_PER_REPO)
  await window.api.ui.set({ boardPresetsByRepo: all })
  return all[repoId]
}

export async function saveBoardPreset(
  repoId: string,
  worktreeId: string,
  name: string
): Promise<BoardPreset[]> {
  const preset = capturePreset(
    getBoard(useAppStore.getState(), worktreeId),
    name,
    crypto.randomUUID(),
    Date.now()
  )
  // Newest first; a same-named preset is replaced rather than duplicated.
  const rest = (await listBoardPresets(repoId)).filter((p) => p.name !== preset.name)
  return await writeRepo(repoId, [preset, ...rest])
}

export async function deleteBoardPreset(repoId: string, presetId: string): Promise<BoardPreset[]> {
  return await writeRepo(
    repoId,
    (await listBoardPresets(repoId)).filter((p) => p.id !== presetId)
  )
}
