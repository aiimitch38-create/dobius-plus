import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { z } from 'zod'

const BackendSchema = z.object({
  enabled: z.boolean(),
  baseUrl: z.string().url(),
  apiKeyEnv: z.string().min(1),
  timeoutMs: z.number().int().positive().max(300_000),
  failClosed: z.literal(true),
  taskModels: z.record(z.string(), z.string().min(1)),
  defaultTaskClass: z.string().min(1),
  allowedModelPrefixes: z.array(z.string().min(1)).min(1),
  noMemory: z.boolean().default(true),
  noCache: z.boolean().default(false)
})

const RoutingConfigSchema = z.object({
  version: z.literal(1),
  activeBackend: z.literal('omniroute'),
  backends: z.object({ omniroute: BackendSchema })
})

export type ModelRoutingConfig = z.infer<typeof RoutingConfigSchema>

export function loadModelRoutingConfig(path: string): ModelRoutingConfig {
  return RoutingConfigSchema.parse(parse(readFileSync(path, 'utf8')))
}
