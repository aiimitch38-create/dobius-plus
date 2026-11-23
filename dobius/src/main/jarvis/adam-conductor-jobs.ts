// The conductor's tracked jobs for the live voice's standing instructions
// (7.13). Only a speakable name and a fixed status leave here: never a
// terminal title or anything an agent wrote.
import { speakableName } from '../../shared/conductor-speech'
import type { ConductorDeps, ConductorJob, Tracked } from './adam-conductor-types'

export const CONDUCTOR_JOBS_MAX = 8

function statusOf(entry: Tracked): ConductorJob['status'] {
  if (entry.askedAt !== null) {
    return 'needs-carson'
  }
  return entry.sawWorking ? 'working' : 'sent'
}

/** The newest tracked jobs first, at most CONDUCTOR_JOBS_MAX. */
export async function conductorJobs(
  tracked: Iterable<Tracked>,
  identify: ConductorDeps['identify']
): Promise<ConductorJob[]> {
  const newest = [...tracked].toSorted((a, b) => b.sentAt - a.sentAt).slice(0, CONDUCTOR_JOBS_MAX)
  return Promise.all(
    newest.map(async (entry) => {
      const identity = await identify(entry.handle).catch(() => null)
      return { name: speakableName(identity?.agentName, identity?.project), status: statusOf(entry) }
    })
  )
}
