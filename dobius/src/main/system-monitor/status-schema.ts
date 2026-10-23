import { z } from 'zod'

const MAX_ROOTS = 32
const nonnegativeInteger = z.number().int().nonnegative().safe()
const finiteNonnegative = z.number().finite().nonnegative()
// IDs are portable metadata tokens, never absolute or relative filesystem paths.
export const systemMonitorCloudIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
export const systemMonitorVolumeIdSchema = z
  .string()
  .max(16)
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine((value) => Number.isSafeInteger(Number(value)))
const boundedPolicy = z
  .object({
    sampleSeconds: z.number().int().min(10).max(3600),
    freshnessSeconds: z.number().int().min(10).max(86_400),
    warnBytes: nonnegativeInteger,
    warnFraction: z.number().finite().min(0).max(1),
    criticalBytes: nonnegativeInteger,
    criticalFraction: z.number().finite().min(0).max(1),
    hysteresisBytes: nonnegativeInteger,
    hysteresisFraction: z.number().finite().min(0).max(1),
    safetyMarginBytes: nonnegativeInteger,
    unknownEstimateBytes: nonnegativeInteger
  })
  .superRefine((policy, context) => {
    if (policy.freshnessSeconds < policy.sampleSeconds) {
      context.addIssue({ code: 'custom', message: 'Freshness must cover a sampling interval' })
    }
    if (policy.criticalBytes > policy.warnBytes || policy.criticalFraction > policy.warnFraction) {
      context.addIssue({
        code: 'custom',
        message: 'Critical thresholds must not exceed warning thresholds'
      })
    }
  })

export const systemMonitorRegistrationSchema = z.object({
  deviceId: systemMonitorCloudIdSchema,
  roots: z
    .array(
      z.object({
        id: systemMonitorCloudIdSchema,
        path: z.string().min(1).max(4096),
        device: nonnegativeInteger,
        inode: nonnegativeInteger
      })
    )
    .max(MAX_ROOTS),
  policy: boundedPolicy
})

const inventorySchema = z
  .object({
    generation: z.string().min(1).max(128),
    state: z.enum(['scanning', 'partial', 'complete']),
    startedAt: finiteNonnegative,
    finishedAt: finiteNonnegative.nullable(),
    logicalBytes: nonnegativeInteger,
    allocatedBytes: nonnegativeInteger.nullable(),
    files: nonnegativeInteger,
    directories: nonnegativeInteger,
    pendingDirectories: nonnegativeInteger,
    skipped: z.object({
      symlinks: nonnegativeInteger,
      mounts: nonnegativeInteger,
      specialFiles: nonnegativeInteger,
      hardlinks: nonnegativeInteger
    }),
    errorCount: nonnegativeInteger,
    errors: z
      .array(
        z.object({
          reason: z.string().min(1).max(128),
          relativePath: z.string().max(512),
          pathTruncated: z.boolean()
        })
      )
      .max(16),
    limitReached: z.boolean(),
    reclaimableBytes: z.null(),
    consistency: z.literal('live_observation')
  })
  .nullable()

const rootSchema = z.object({
  id: systemMonitorCloudIdSchema,
  path: z.string().min(1).max(4096),
  identity: z.object({ device: nonnegativeInteger, inode: nonnegativeInteger }),
  state: z.enum(['available', 'unavailable']),
  volumeId: systemMonitorVolumeIdSchema.nullable(),
  reason: z.literal('root_unavailable_or_identity_changed').optional(),
  inventory: inventorySchema
})

const volumeSchema = z
  .object({
    id: systemMonitorVolumeIdSchema,
    totalBytes: nonnegativeInteger,
    freeBytes: nonnegativeInteger,
    usedBytes: nonnegativeInteger,
    state: z.enum(['healthy', 'warning', 'critical']),
    thresholds: z.object({
      warningBytes: nonnegativeInteger,
      criticalBytes: nonnegativeInteger,
      hysteresisBytes: nonnegativeInteger
    }),
    history: z
      .array(z.object({ sampledAt: finiteNonnegative, freeBytes: nonnegativeInteger }))
      .max(60),
    freeBytesPerSecond: z.number().finite().nullable()
  })
  .superRefine((volume, context) => {
    if (
      volume.totalBytes <= 0 ||
      volume.freeBytes > volume.totalBytes ||
      volume.usedBytes > volume.totalBytes
    ) {
      context.addIssue({ code: 'custom', message: 'Volume capacity values are inconsistent' })
    }
    if (volume.thresholds.criticalBytes > volume.thresholds.warningBytes) {
      context.addIssue({ code: 'custom', message: 'Critical threshold exceeds warning threshold' })
    }
  })

const alertSchema = z.object({
  sampledAt: finiteNonnegative,
  kind: z.enum(['root_state_changed', 'space_state_changed']),
  rootId: systemMonitorCloudIdSchema.optional(),
  volumeId: systemMonitorVolumeIdSchema.optional(),
  from: z.string().nullable(),
  to: z.string()
})

export const systemMonitorStatusSchema = z
  .object({
    schemaVersion: z.literal(1),
    deviceId: systemMonitorCloudIdSchema,
    sampledAt: finiteNonnegative,
    freshnessSeconds: z.number().int().min(10).max(86_400),
    health: z.enum(['unconfigured', 'healthy', 'warning', 'critical', 'unavailable']),
    roots: z.array(rootSchema).max(MAX_ROOTS),
    volumes: z.array(volumeSchema).max(MAX_ROOTS),
    alerts: z.array(alertSchema).max(200),
    cleanupReceipts: z.array(z.never()),
    cleanupEnabled: z.literal(false),
    publisher: z.literal('private_local_file'),
    platform: z.string().min(1).max(64),
    inventorySupported: z.boolean(),
    topConsumers: z
      .array(
        z.object({
          rootId: systemMonitorCloudIdSchema,
          logicalBytes: nonnegativeInteger,
          allocatedBytes: nonnegativeInteger.nullable(),
          state: z.enum(['scanning', 'partial', 'complete'])
        })
      )
      .max(MAX_ROOTS)
  })
  .superRefine((status, context) => {
    const rootIds = new Set<string>()
    const referencedVolumeIds = new Set<string>()
    const volumeIds = new Set(status.volumes.map((volume) => volume.id))

    if (volumeIds.size !== status.volumes.length) {
      context.addIssue({ code: 'custom', path: ['volumes'], message: 'Duplicate volume identity' })
    }
    for (const [index, root] of status.roots.entries()) {
      if (rootIds.has(root.id)) {
        context.addIssue({
          code: 'custom',
          path: ['roots', index, 'id'],
          message: 'Duplicate root identity'
        })
      }
      rootIds.add(root.id)
      if (root.state === 'available') {
        const expectedVolumeId = String(root.identity.device)
        if (root.volumeId !== expectedVolumeId || !volumeIds.has(expectedVolumeId)) {
          context.addIssue({
            code: 'custom',
            path: ['roots', index, 'volumeId'],
            message: 'Available roots must reference their registered volume identity'
          })
        } else {
          referencedVolumeIds.add(expectedVolumeId)
        }
      } else if (root.volumeId !== null) {
        context.addIssue({
          code: 'custom',
          path: ['roots', index, 'volumeId'],
          message: 'Unavailable roots cannot reference a volume'
        })
      }
    }
    if (referencedVolumeIds.size !== volumeIds.size) {
      context.addIssue({
        code: 'custom',
        path: ['volumes'],
        message: 'Every volume must be referenced by an available registered root'
      })
    }

    for (const [index, alert] of status.alerts.entries()) {
      if (alert.rootId && !rootIds.has(alert.rootId)) {
        context.addIssue({
          code: 'custom',
          path: ['alerts', index, 'rootId'],
          message: 'Unknown root ID'
        })
      }
      if (alert.volumeId && !volumeIds.has(alert.volumeId)) {
        context.addIssue({
          code: 'custom',
          path: ['alerts', index, 'volumeId'],
          message: 'Unknown volume ID'
        })
      }
    }
    for (const [index, consumer] of status.topConsumers.entries()) {
      if (!rootIds.has(consumer.rootId)) {
        context.addIssue({
          code: 'custom',
          path: ['topConsumers', index, 'rootId'],
          message: 'Unknown root ID'
        })
      }
    }
  })

export type RuntimeSystemMonitorStatus = z.infer<typeof systemMonitorStatusSchema>
