// The one Board snapshot service of this main process, for the RPC methods
// (`dobius board snapshots ...`) that cannot be handed it at registration.
import type { BoardSnapshotService } from './board-snapshot-service'

let active: BoardSnapshotService | null = null

export function setActiveBoardSnapshotService(service: BoardSnapshotService | null): void {
  active = service
}

export function getActiveBoardSnapshotService(): BoardSnapshotService | null {
  return active
}
