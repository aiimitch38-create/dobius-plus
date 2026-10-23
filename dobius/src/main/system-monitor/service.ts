import { relative, isAbsolute, normalize, sep } from 'node:path'
import { z } from 'zod'
import type { SystemMonitorConfig } from '../../shared/system-monitor'
import type { SystemMonitorView, SystemMonitorViewReason } from '../../shared/system-monitor-view'
import { loadSystemMonitorSnapshot } from './adapter'
import { PrivateJsonError, readBoundedPrivateJson } from './private-json'
import { systemMonitorCloudIdSchema } from './status-schema'

const nonnegativeInteger = z.number().int().nonnegative().safe()
const policySchema = z
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
  .strict()
  .superRefine((policy, context) => {
    if (
      policy.freshnessSeconds < policy.sampleSeconds ||
      policy.criticalBytes > policy.warnBytes ||
      policy.criticalFraction > policy.warnFraction
    ) {
      context.addIssue({ code: 'custom', message: 'Inconsistent monitor policy' })
    }
  })

const configSchema = z
  .object({
    schemaVersion: z.literal(1),
    deviceId: systemMonitorCloudIdSchema,
    roots: z
      .array(
        z
          .object({
            id: systemMonitorCloudIdSchema,
            path: z.string().min(1).max(4096),
            device: nonnegativeInteger,
            inode: nonnegativeInteger
          })
          .strict()
      )
      .max(32),
    policy: policySchema,
    scan: z
      .object({
        maxEntriesPerTick: z.number().int().min(1).max(10_000),
        maxSecondsPerTick: z.number().finite().min(0.001).max(1),
        maxDirectories: z.number().int().min(1).max(10_000),
        maxInodes: z.number().int().min(1).max(50_000),
        maxDepth: z.number().int().min(1).max(128),
        refreshSeconds: z.number().int().min(60).max(86_400)
      })
      .strict()
  })
  .strict()
  .superRefine((config, context) => {
    const ids = new Set<string>()
    const paths: string[] = []
    for (const [index, root] of config.roots.entries()) {
      if (
        !isAbsolute(root.path) ||
        normalize(root.path) !== root.path ||
        root.path.includes('\0') ||
        ids.has(root.id)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['roots', index],
          message: 'Invalid root identity'
        })
        continue
      }
      ids.add(root.id)
      const overlaps = paths.some((path) => {
        const fromExisting = relative(path, root.path)
        const fromCandidate = relative(root.path, path)
        return (
          fromExisting === '' ||
          fromCandidate === '' ||
          (!fromExisting.startsWith(`..${sep}`) && fromExisting !== '..') ||
          (!fromCandidate.startsWith(`..${sep}`) && fromCandidate !== '..')
        )
      })
      if (overlaps) {
        context.addIssue({ code: 'custom', path: ['roots', index], message: 'Overlapping roots' })
      }
      paths.push(root.path)
    }
  })

function emptyView(
  reason: SystemMonitorViewReason,
  deviceId: string | null = null
): SystemMonitorView {
  return {
    availability: 'unavailable',
    deviceId,
    health: 'unavailable',
    freshness: reason === 'clock_skew' ? 'clock_skew' : 'unavailable',
    reason,
    source: null,
    sampledAtMs: null,
    ageMs: null,
    freshnessSeconds: null,
    volumes: [],
    roots: [],
    cleanupEnabled: false
  }
}

function configFailureReason(error: unknown): SystemMonitorViewReason {
  if (error instanceof PrivateJsonError) {
    if (error.reason === 'missing') {
      return 'missing_config'
    }
    if (error.reason === 'untrusted_file') {
      return 'untrusted_config'
    }
  }
  return 'invalid_config'
}

function snapshotFailureReason(
  reason:
    | 'missing'
    | 'invalid'
    | 'untrusted_file'
    | 'identity_mismatch'
    | 'clock_skew'
    | 'unsupported_platform'
): SystemMonitorViewReason {
  switch (reason) {
    case 'missing':
      return 'missing_snapshot'
    case 'invalid':
      return 'invalid_snapshot'
    case 'untrusted_file':
      return 'untrusted_snapshot'
    default:
      return reason
  }
}

/** Read-only projection of the enrolled monitor registration and its current private sample. */
export class SystemMonitorService {
  constructor(
    private readonly stateDirectory: string,
    private readonly now: () => number = Date.now
  ) {}

  status(): SystemMonitorView {
    if (process.platform === 'win32') {
      return emptyView('unsupported_platform')
    }
    if (
      !isAbsolute(this.stateDirectory) ||
      normalize(this.stateDirectory) !== this.stateDirectory
    ) {
      return emptyView('invalid_config')
    }

    let rawConfig: unknown
    try {
      rawConfig = readBoundedPrivateJson(`${this.stateDirectory}${sep}config.json`)
    } catch (error) {
      return emptyView(configFailureReason(error))
    }
    const parsedConfig = configSchema.safeParse(rawConfig)
    if (!parsedConfig.success) {
      return emptyView('invalid_config')
    }
    const config: SystemMonitorConfig = parsedConfig.data
    const snapshot = loadSystemMonitorSnapshot(this.stateDirectory, config, this.now())
    if (snapshot.availability === 'unavailable') {
      return emptyView(snapshotFailureReason(snapshot.reason), config.deviceId)
    }

    return {
      availability: 'available',
      deviceId: config.deviceId,
      health: snapshot.health,
      freshness: snapshot.freshness,
      reason: null,
      source: 'private_local_file',
      sampledAtMs: snapshot.sampledAtMs,
      // The adapter tolerates a small future-sample skew. Keep the public view
      // nonnegative so clients can validate it without extending freshness.
      ageMs: Math.max(0, snapshot.ageMs),
      freshnessSeconds: config.policy.freshnessSeconds,
      volumes: snapshot.volumes.map(({ id, totalBytes, freeBytes, usedBytes, state }) => ({
        id,
        totalBytes,
        freeBytes,
        usedBytes,
        state
      })),
      roots: snapshot.roots.map((root) => ({
        id: root.id,
        state: root.state,
        logicalBytes: root.inventory?.logicalBytes ?? null,
        allocatedBytes: root.inventory?.allocatedBytes ?? null,
        inventoryState: root.inventory?.state ?? null
      })),
      cleanupEnabled: false
    }
  }
}
