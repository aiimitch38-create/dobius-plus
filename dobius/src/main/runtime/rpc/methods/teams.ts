import { z } from 'zod'
import type { Team } from '../../../communications/team-store'
import { createTeam, getTeam, listTeams, removeTeam, updateTeam } from '../../../communications/team-store'
import { defineMethod, type RpcMethod } from '../core'
import { OptionalPlainString, requiredString } from '../schemas'

const OptionalStringArray = z.array(z.string()).optional()

const TeamId = z.object({
  id: requiredString('Missing team id')
})

const TeamCreate = z.object({
  name: requiredString('Missing team name'),
  description: OptionalPlainString,
  instructions: OptionalPlainString,
  personaIds: OptionalStringArray,
  // Why: Dobius-connected Claude/Codex account ids this team's agents run
  // under. team-store.ts's normalizeAccountIds() is the enforcement point
  // for "id only, never a token" — this schema just shapes the transport.
  accountIds: OptionalStringArray
})

const TeamUpdateFields = z.object({
  name: z
    .unknown()
    .transform((value) => (typeof value === 'string' && value.length > 0 ? value : undefined))
    .pipe(z.union([z.string(), z.undefined()]))
    .optional(),
  description: OptionalPlainString,
  instructions: OptionalPlainString,
  personaIds: OptionalStringArray,
  accountIds: OptionalStringArray
})

const TeamUpdate = z.object({
  id: requiredString('Missing team id'),
  updates: TeamUpdateFields
})

function showTeam(id: string): Team {
  const team = getTeam(id)
  if (!team) {
    throw new Error(`Team not found: ${id}`)
  }
  return team
}

export const TEAM_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'team.list',
    params: null,
    handler: () => ({ teams: listTeams() })
  }),
  defineMethod({
    name: 'team.show',
    params: TeamId,
    handler: (params) => ({ team: showTeam(params.id) })
  }),
  defineMethod({
    name: 'team.create',
    params: TeamCreate,
    handler: (params) => {
      const teams = createTeam(params)
      // Why: createTeam appends the new record and returns the full roster,
      // so the last entry is the team that was just created.
      return { team: teams.at(-1) }
    }
  }),
  defineMethod({
    name: 'team.update',
    params: TeamUpdate,
    handler: (params) => {
      const teams = updateTeam(params.id, params.updates)
      return { team: teams.find((team) => team.id === params.id) }
    }
  }),
  defineMethod({
    name: 'team.delete',
    params: TeamId,
    handler: (params) => {
      showTeam(params.id)
      removeTeam(params.id)
      return { removed: true, id: params.id }
    }
  })
]
