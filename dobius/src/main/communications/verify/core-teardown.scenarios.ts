/**
 * CORE scenario steps, part 3: teardown. Split from core.scenarios.ts to
 * keep every file under the repo's max-lines limit; core.scenarios.ts
 * re-exports CORE_TEARDOWN_STEPS so command-scenario.ts's import surface
 * is unchanged, and runtime ordering is byte-for-byte identical.
 *
 * SEAM — see core.scenarios.ts's header. delete_persona goes through the
 * gateway (agent.delete); the channel cycle is relay-protocol work and
 * uses direct helpers.
 */
import { fail, expectUndefined, isRecord, ok } from '../scenario-contract'
import {
  archiveChannelWorld,
  deleteChannelWorld,
  joinChannelWorld,
  leaveChannelWorld,
  unarchiveChannelWorld,
  type DirectScenarioStep
} from './relay-world-ops'

/**
 * Tears down the live world CORE_SETUP_STEPS established, after every
 * family's steps have had a chance to operate on it. Original relative
 * order preserved; requiresSecondBoundary kept on every step — each
 * rewrites kind 39000 or 39002 under the same d tag, so the newest write
 * must be provably last (see ScenarioStep.requiresSecondBoundary).
 */
export const CORE_TEARDOWN_STEPS: DirectScenarioStep[] = [
  {
    // The method honestly reports what it removed where the vendor case
    // discarded the result — oracle strengthened accordingly.
    command: 'agent.delete',
    via: 'method',
    args: (ctx) => ({ id: ctx.personaId }),
    shapeCheck: (r, ctx) =>
      isRecord(r) && r.removed === true && r.id === ctx.personaId
        ? ok()
        : fail(`unexpected delete result: ${JSON.stringify(r)}`)
  },
  {
    // The vendored case awaited the updated channel detail and discarded it,
    // returning undefined — the direct helpers keep that void surface.
    command: 'archive_channel',
    direct: archiveChannelWorld,
    args: (ctx) => ({ channelId: ctx.channelId }),
    shapeCheck: expectUndefined,
    requiresSecondBoundary: true
  },
  {
    command: 'unarchive_channel',
    direct: unarchiveChannelWorld,
    args: (ctx) => ({ channelId: ctx.channelId }),
    shapeCheck: expectUndefined,
    requiresSecondBoundary: true
  },
  {
    command: 'join_channel',
    direct: joinChannelWorld,
    args: (ctx) => ({ channelId: ctx.channelId }),
    shapeCheck: expectUndefined,
    requiresSecondBoundary: true
  },
  {
    command: 'leave_channel',
    direct: leaveChannelWorld,
    args: (ctx) => ({ channelId: ctx.channelId }),
    shapeCheck: expectUndefined,
    requiresSecondBoundary: true
  },
  {
    command: 'delete_channel',
    direct: deleteChannelWorld,
    args: (ctx) => ({ channelId: ctx.channelId }),
    shapeCheck: expectUndefined,
    requiresSecondBoundary: true
  }
]
