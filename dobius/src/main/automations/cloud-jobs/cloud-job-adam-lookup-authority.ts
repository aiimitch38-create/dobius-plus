import type { CloudJob, CloudJobInput } from '../../../shared/cloud-jobs'
import type { CloudJobAdamBindingGrant } from '../../../shared/cloud-job-adam-receipts'
import type SyncDatabase from '../../sqlite/sync-database'
import type { CloudJobStore } from './store'
import { findCloudJobAdamChildByVerifiedGrant } from './cloud-job-adam-child-lookup'

type CurrentStore = { store: CloudJobStore | null; generation: string; active: boolean }

export type CloudJobAdamLookupReader = {
  assertCurrent(assertExternalCurrent: () => void): void
  read(
    input: CloudJobInput,
    grant: CloudJobAdamBindingGrant,
    assertExternalCurrent: () => void
  ): CloudJob | null
}

export function createCloudJobAdamLookupReader(
  db: SyncDatabase,
  store: CloudJobStore,
  generation: string,
  projectId: string,
  readCurrent: () => CurrentStore
): CloudJobAdamLookupReader {
  const projectSnapshot = JSON.stringify(store.project(projectId))
  const projectRevision = store.projectAuthorityRevision(projectId)
  const assertStoreCurrent = () => {
    const current = readCurrent()
    if (
      current.store !== store ||
      current.generation !== generation ||
      !current.active ||
      store.projectAuthorityRevision(projectId) !== projectRevision ||
      JSON.stringify(store.project(projectId)) !== projectSnapshot
    ) {
      throw new Error('Cloud job lookup authority changed.')
    }
  }
  const assertCurrent = (assertExternalCurrent: () => void) => {
    assertExternalCurrent()
    assertStoreCurrent()
  }
  return Object.freeze({
    assertCurrent,
    read: (input, grant, assertExternalCurrent) =>
      findCloudJobAdamChildByVerifiedGrant(db, input, grant, () =>
        assertCurrent(assertExternalCurrent)
      )
  })
}
