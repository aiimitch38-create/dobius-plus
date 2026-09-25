import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DOBIUS_FEATURE_MAP, DOBIUS_REPO_IDENTITY_PATH } from './session-workspace-feature-map'

// dobius/src/main/agents → repo root
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')

describe('DOBIUS_FEATURE_MAP', () => {
  it('names only paths that exist in this repo', () => {
    const missing = DOBIUS_FEATURE_MAP.flatMap((feature) => feature.paths).filter(
      (repoPath) => !existsSync(path.join(REPO_ROOT, repoPath))
    )
    expect(missing).toEqual([])
  })

  it('identifies this repo as the Dobius+ repo', () => {
    expect(existsSync(path.join(REPO_ROOT, DOBIUS_REPO_IDENTITY_PATH))).toBe(true)
  })
})
