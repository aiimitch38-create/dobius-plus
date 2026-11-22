// The updater's read-only status for the runtime RPC (`dobius update status`),
// handed over when the updater IPC registers. Why a separate module: the RPC
// manifest must not import updater.ts, which loads electron-updater tooling.
import type { UpdateStatus } from '../shared/types'

let readStatus: (() => UpdateStatus) | null = null

export function setUpdateStatusReader(reader: (() => UpdateStatus) | null): void {
  readStatus = reader
}

export function updateStatusForRuntime(): UpdateStatus {
  if (!readStatus) {
    throw new Error('Update status is not ready yet. Open the Dobius+ window and try again.')
  }
  return readStatus()
}
