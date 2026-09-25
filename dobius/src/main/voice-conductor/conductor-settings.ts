import { getAsanaConfig } from '../asana/asana-config'
import { getImessageBridgeConfig } from '../imessage-bridge/bridge-config'
import { createAsanaQueue, type AsanaTaskLister, type LaneAssignees } from './asana-queue'
import type { AsanaQueue } from './types'

// The conductor's settings come from the same owners the rest of the app uses,
// read at each use so a Settings change applies to a running conductor.

/** Build/review lane assignees from Settings (asana-config myGid / reviewGid). */
export function conductorLaneAssignees(): LaneAssignees {
  const config = getAsanaConfig()
  return { buildGid: config.myGid, reviewGid: config.reviewGid }
}

/** Carson's iMessage handle: the iMessage bridge "your handle" setting. */
export function conductorImessageHandle(): string | null {
  return getImessageBridgeConfig().selfHandle
}

/** An Asana queue whose lanes are re-read from Settings on every fetch. */
export function createSettingsLaneAsanaQueue(
  getLanes: () => LaneAssignees = conductorLaneAssignees,
  listTasks?: AsanaTaskLister
): AsanaQueue {
  return {
    fetch: (queue) => createAsanaQueue({ ...getLanes(), listTasks }).fetch(queue)
  }
}
