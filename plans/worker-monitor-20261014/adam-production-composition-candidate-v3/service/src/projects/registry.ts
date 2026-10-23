import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { z } from 'zod'

const ProjectIdSchema = z.string().regex(/^[a-z][a-z0-9-]{1,62}$/)
const AliasSchema = z.string().regex(/^[a-z0-9][a-z0-9+ -]{0,62}$/i)

const ProjectManifestSchema = z.object({
  id: ProjectIdSchema,
  name: z.string().min(1).max(120),
  aliases: z.array(AliasSchema).min(1),
  owner: z.string().min(1).max(120),
  classification: z.enum(['product', 'control_plane', 'supporting_tool', 'maintenance', 'registry_only']),
  status: z.enum(['active', 'blocked', 'stale', 'unknown', 'archived']),
  riskTier: z.enum(['low', 'medium', 'high', 'critical']),
  dataSensitivity: z.enum(['public', 'internal', 'confidential', 'restricted']),
  locations: z.array(z.object({
    path: z.string().min(1),
    role: z.enum(['canonical', 'worktree', 'legacy_alias', 'missing']),
    verified: z.boolean(),
    branch: z.string().min(1).optional(),
    revision: z.string().regex(/^[0-9a-f]{40}$/).optional()
  }).strict()).min(1),
  execution: z.object({
    mode: z.enum(['managed', 'read_only', 'disabled']),
    repoSelector: z.string().regex(/^id:[a-z0-9._:-]+$/i).optional()
  }).strict(),
  purpose: z.string().min(1).max(500),
  notes: z.array(z.string().min(1).max(500)).default([])
}).strict().superRefine((project, context) => {
  const canonicalLocations = project.locations.filter((location) => location.role === 'canonical')
  const verifiedCanonicalLocations = canonicalLocations.filter((location) => location.verified)
  if (project.execution.mode === 'managed' && !project.execution.repoSelector) {
    context.addIssue({ code: 'custom', message: 'managed projects require execution.repoSelector', path: ['execution', 'repoSelector'] })
  }
  if (project.execution.mode === 'managed' && verifiedCanonicalLocations.length !== 1) {
    context.addIssue({ code: 'custom', message: 'managed projects require one verified canonical location', path: ['locations'] })
  }
  if (project.execution.mode === 'disabled' && project.execution.repoSelector) {
    context.addIssue({ code: 'custom', message: 'disabled projects may not declare execution.repoSelector', path: ['execution', 'repoSelector'] })
  }
  if (canonicalLocations.length > 1) {
    context.addIssue({ code: 'custom', message: 'a project may declare only one canonical location', path: ['locations'] })
  }
  for (const [index, location] of project.locations.entries()) {
    const syntheticPath = location.path.startsWith('registry-evidence:') || location.path.startsWith('registry-only:')
    if (location.role === 'missing' && location.verified) {
      context.addIssue({ code: 'custom', message: 'missing locations cannot be verified', path: ['locations', index, 'verified'] })
    }
    if (location.verified && syntheticPath) {
      context.addIssue({ code: 'custom', message: 'verified locations require a filesystem path', path: ['locations', index, 'path'] })
    }
  }
})

export const ProjectRegistrySchema = z.object({
  version: z.literal(1),
  authority: z.object({
    registryId: z.literal('adam-project-registry'),
    sourceOfTruth: z.literal('ADAM config/project-registry.yaml'),
    reconciledAt: z.string().datetime(),
    dobiusPlus: z.object({
      canonicalCheckout: z.string().min(1),
      sourcePath: z.string().min(1),
      compiledOutputPath: z.string().min(1),
      runtimeEntryPath: z.string().min(1),
      packagedOutputPath: z.string().min(1),
      installedAppPath: z.string().min(1),
      activation: z.string().min(1)
    }).strict(),
    adam: z.object({
      canonicalCheckout: z.string().min(1),
      sourcePath: z.string().min(1),
      distPath: z.string().min(1),
      runtimeEntryPath: z.string().min(1),
      activation: z.string().min(1)
    }).strict()
  }).strict(),
  projects: z.array(ProjectManifestSchema).min(1)
}).strict().superRefine((registry, context) => {
  const identities = new Map<string, number>()
  for (const [index, project] of registry.projects.entries()) {
    const normalizedId = normalizeProjectAlias(project.id)
    const idOwner = identities.get(normalizedId)
    if (idOwner !== undefined && idOwner !== index) {
      context.addIssue({ code: 'custom', message: `duplicate project id: ${project.id}`, path: ['projects', index, 'id'] })
    }
    identities.set(normalizedId, index)
  }
  for (const [index, project] of registry.projects.entries()) {
    const projectAliases = new Set<string>()
    for (const alias of project.aliases) {
      const normalizedAlias = normalizeProjectAlias(alias)
      const owner = identities.get(normalizedAlias)
      if (projectAliases.has(normalizedAlias) || (owner !== undefined && owner !== index)) {
        context.addIssue({ code: 'custom', message: `duplicate project alias: ${alias}`, path: ['projects', index, 'aliases'] })
      }
      projectAliases.add(normalizedAlias)
      identities.set(normalizedAlias, index)
    }
  }
  const locationOwners = new Map<string, number>()
  for (const [index, project] of registry.projects.entries()) {
    for (const location of project.locations) {
      if (location.role === 'missing') continue
      const normalizedPath = location.path.trim().toLocaleLowerCase()
      const owner = locationOwners.get(normalizedPath)
      if (owner !== undefined && owner !== index) {
        context.addIssue({ code: 'custom', message: `location belongs to multiple projects: ${location.path}`, path: ['projects', index, 'locations'] })
      }
      locationOwners.set(normalizedPath, index)
    }
  }
})

export type ProjectRegistry = z.infer<typeof ProjectRegistrySchema>
export type ProjectManifest = ProjectRegistry['projects'][number]

export const DEFAULT_PROJECT_REGISTRY_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../config/project-registry.yaml'
)

export function defaultProjectRegistryPath(): string {
  return process.env.ADAM_PROJECT_REGISTRY_FILE ?? DEFAULT_PROJECT_REGISTRY_PATH
}

export function loadProjectRegistry(path: string = defaultProjectRegistryPath()): ProjectRegistry {
  return ProjectRegistrySchema.parse(parse(readFileSync(path, 'utf8')))
}

export function normalizeProjectAlias(value: string): string {
  return value.trim().toLocaleLowerCase()
}

export function findProjectByAlias(registry: ProjectRegistry, alias: string): ProjectManifest | undefined {
  const normalizedAlias = normalizeProjectAlias(alias)
  return registry.projects.find((project) =>
    normalizeProjectAlias(project.id) === normalizedAlias
    || project.aliases.some((item) => normalizeProjectAlias(item) === normalizedAlias)
  )
}
