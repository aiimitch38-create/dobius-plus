import { z } from 'zod'
import { CloudId } from '../../../shared/cloud-jobs'
import { CloudWorkerEnrollment } from '../../../shared/cloud-worker-enrollment'
import { HERMES_PROFILE_IDS, WorkerCaps, WorkerId } from '../../../shared/workstation-worker'

const Path = z.string().min(1).max(4096)
const IdentifierList = z.array(WorkerId).min(1).max(128)

const Root = z
  .object({
    id: WorkerId,
    canonicalPath: Path,
    allowedRecipes: IdentifierList,
    allowedWorktrees: IdentifierList
  })
  .strict()

const Worktree = z.object({ id: WorkerId, rootId: WorkerId, canonicalPath: Path }).strict()

const Recipe = z
  .object({
    id: WorkerId,
    executable: Path,
    argv: z.array(z.string().max(4096)).max(128),
    maxCaps: WorkerCaps,
    artifactPaths: z.array(z.string().min(1).max(4096)).max(128).optional(),
    hermesProfileId: z.enum(HERMES_PROFILE_IDS)
  })
  .strict()

const Profile = z
  .object({
    id: z.enum(HERMES_PROFILE_IDS),
    home: Path,
    worktreeId: WorkerId,
    allowedRoots: IdentifierList,
    allowedRecipes: IdentifierList,
    credentialRef: z.string().min(1).max(256),
    authVerified: z.boolean(),
    runtimeVerified: z.boolean()
  })
  .strict()

const Worker = z
  .object({
    workerId: WorkerId,
    profileId: z.enum(HERMES_PROFILE_IDS),
    capabilities: z
      .array(z.enum(['linux', 'macos', 'windows', 'portable']))
      .min(1)
      .max(4),
    assignments: z
      .array(
        z
          .object({
            projectId: CloudId,
            rootId: WorkerId,
            worktreeId: WorkerId,
            recipeId: WorkerId,
            minimumWorkingBytes: z.number().int().nonnegative().safe(),
            caps: WorkerCaps
          })
          .strict()
      )
      .min(1)
      .max(128)
  })
  .strict()

const EnabledConfig = z
  .object({
    schemaVersion: z.literal(1),
    enabled: z.literal(true),
    deviceId: WorkerId,
    projectBindings: z
      .array(z.object({ projectId: CloudId, rootId: WorkerId }).strict())
      .min(1)
      .max(100),
    roots: z.array(Root).min(1).max(100),
    worktrees: z.array(Worktree).min(2).max(128),
    recipes: z.array(Recipe).min(1).max(128),
    profiles: z.array(Profile).length(2),
    workers: z.array(Worker).length(2)
  })
  .strict()
  .superRefine((config, context) => {
    const unique = (values: readonly string[]) => new Set(values).size === values.length
    if (
      !unique(config.projectBindings.map((binding) => binding.projectId)) ||
      !unique(config.roots.map((root) => root.id)) ||
      !unique(config.worktrees.map((worktree) => worktree.id)) ||
      !unique(config.recipes.map((recipe) => recipe.id)) ||
      !unique(config.workers.map((worker) => worker.workerId)) ||
      !unique(config.workers.map((worker) => worker.profileId)) ||
      !unique(config.profiles.map((profile) => profile.id)) ||
      !unique(config.profiles.map((profile) => profile.home)) ||
      !unique(config.profiles.map((profile) => profile.worktreeId))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Worker configuration contains duplicate identities.'
      })
    }
    if (HERMES_PROFILE_IDS.some((id) => !config.profiles.some((profile) => profile.id === id))) {
      context.addIssue({
        code: 'custom',
        message: 'Both Hermes profile registrations are required.'
      })
    }
    const rootFor = (id: string) => config.roots.find((root) => root.id === id)
    const worktreeFor = (id: string) => config.worktrees.find((worktree) => worktree.id === id)
    const recipeFor = (id: string) => config.recipes.find((recipe) => recipe.id === id)
    for (const binding of config.projectBindings) {
      if (!rootFor(binding.rootId)) {
        context.addIssue({ code: 'custom', message: 'Project binding references an unknown root.' })
      }
    }
    for (const worktree of config.worktrees) {
      if (!rootFor(worktree.rootId)) {
        context.addIssue({ code: 'custom', message: 'Worktree references an unknown root.' })
      }
    }
    for (const profile of config.profiles) {
      if (!worktreeFor(profile.worktreeId)) {
        context.addIssue({ code: 'custom', message: 'Profile references an unknown worktree.' })
      }
    }
    for (const recipe of config.recipes) {
      const profile = config.profiles.find((entry) => entry.id === recipe.hermesProfileId)
      if (!profile || !profile.allowedRecipes.includes(recipe.id)) {
        context.addIssue({
          code: 'custom',
          message: 'Recipe is not allowed by its Hermes profile.'
        })
      }
    }
    for (const worker of config.workers) {
      const profile = config.profiles.find((entry) => entry.id === worker.profileId)
      if (!profile) {
        context.addIssue({
          code: 'custom',
          message: 'Worker references an unknown Hermes profile.'
        })
        continue
      }
      for (const input of worker.assignments) {
        const binding = config.projectBindings.find((entry) => entry.projectId === input.projectId)
        const root = rootFor(input.rootId)
        const worktree = worktreeFor(input.worktreeId)
        const recipe = recipeFor(input.recipeId)
        if (
          !binding ||
          binding.rootId !== input.rootId ||
          !root?.allowedRecipes.includes(input.recipeId) ||
          !root.allowedWorktrees.includes(input.worktreeId) ||
          worktree?.rootId !== input.rootId ||
          recipe?.hermesProfileId !== worker.profileId ||
          profile.worktreeId !== input.worktreeId ||
          !profile.allowedRoots.includes(input.rootId) ||
          !profile.allowedRecipes.includes(input.recipeId) ||
          !recipe ||
          !capsWithin(input.caps, recipe.maxCaps)
        ) {
          context.addIssue({
            code: 'custom',
            message: 'Worker assignment exceeds or mismatches trusted policy.'
          })
        }
      }
    }
  })

const DisabledConfig = z.object({ schemaVersion: z.literal(1), enabled: z.literal(false) }).strict()

export const CloudWorkerConfig = z.discriminatedUnion('enabled', [EnabledConfig, DisabledConfig])
export type CloudWorkerConfig = z.infer<typeof CloudWorkerConfig>
export type EnabledCloudWorkerConfig = z.infer<typeof EnabledConfig>

export function enrollmentsFromConfig(config: EnabledCloudWorkerConfig) {
  return config.workers.map((worker) =>
    CloudWorkerEnrollment.parse({
      workerId: worker.workerId,
      deviceId: config.deviceId,
      capabilities: worker.capabilities,
      assignments: worker.assignments.map((assignment) => ({
        ...assignment,
        profileId: worker.profileId
      }))
    })
  )
}

function capsWithin(actual: z.infer<typeof WorkerCaps>, limit: z.infer<typeof WorkerCaps>) {
  return (
    actual.wallTimeMs <= limit.wallTimeMs &&
    actual.outputBytes <= limit.outputBytes &&
    actual.artifactBytes <= limit.artifactBytes &&
    actual.memoryBytes <= limit.memoryBytes &&
    actual.cpuCount <= limit.cpuCount
  )
}
