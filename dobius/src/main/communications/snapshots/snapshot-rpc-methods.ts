/**
 * RPC methods backing the 9 teams-snapshots commands (export/encode/
 * preview/confirm for both agent and team snapshots, plus
 * fetch_snapshot_bytes). Same defineMethod/zod shape as
 * src/main/runtime/rpc/methods/teams.ts.
 *
 * WIRING (not applied here — see the build report): one import + one
 * array-spread line in src/main/runtime/rpc/methods/index.ts
 * (`...SNAPSHOT_METHODS`), and one allowlist entry per method name below in
 * COMMUNICATIONS_RUNTIME_METHODS (src/shared/communications-bridge.ts).
 */
import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../../runtime/rpc/core'
import { requiredString } from '../../runtime/rpc/schemas'
import {
  confirmAgentSnapshotImport,
  encodeAgentSnapshotForSend,
  exportAgentSnapshot,
  previewAgentSnapshotImport
} from './agent-snapshot'
import {
  confirmTeamSnapshotImport,
  encodeTeamSnapshotForSend,
  exportTeamSnapshot,
  previewTeamSnapshotImport
} from './team-snapshot'
import { fetchSnapshotBytes } from './snapshot-fetch'

const SnapshotFormat = z.enum(['json', 'png'])
const SnapshotMemoryLevel = z.enum(['none', 'core', 'everything'])
const OptionalNullableString = z
  .unknown()
  .transform((value) => (typeof value === 'string' && value.trim() ? value : null))
  .pipe(z.union([z.string(), z.null()]))
  .optional()

const AgentExportInput = z.object({
  id: requiredString('Missing agent id'),
  memoryLevel: SnapshotMemoryLevel,
  format: SnapshotFormat,
  avatarPngDataUrl: OptionalNullableString
})

const TeamExportInput = z.object({
  id: requiredString('Missing team id'),
  memoryLevel: SnapshotMemoryLevel,
  format: SnapshotFormat
})

const FileBytes = z.object({
  fileBytes: z.array(z.number().int().min(0).max(255)).max(4 * 1024 * 1024, 'Snapshot file too large')
})

const ConfirmImport = FileBytes.extend({
  keepAllowlist: z.boolean()
})

const FetchSnapshotBytesInput = z.object({
  url: requiredString('Missing snapshot URL'),
  filename: requiredString('Missing snapshot filename'),
  expectedSha256: requiredString('Missing expected SHA-256'),
  expectedSize: z.number().int().min(0)
})

export const SNAPSHOT_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'agent.snapshot.export',
    params: AgentExportInput,
    handler: async (params) => ({ saved: await exportAgentSnapshot(params) })
  }),
  defineMethod({
    name: 'agent.snapshot.encode',
    params: AgentExportInput,
    handler: (params) => encodeAgentSnapshotForSend(params)
  }),
  defineMethod({
    name: 'agent.snapshot.previewImport',
    params: FileBytes,
    handler: (params) => previewAgentSnapshotImport(params.fileBytes)
  }),
  defineMethod({
    name: 'agent.snapshot.confirmImport',
    params: ConfirmImport,
    handler: (params) => confirmAgentSnapshotImport(params)
  }),
  defineMethod({
    name: 'team.snapshot.export',
    params: TeamExportInput,
    handler: async (params) => ({ saved: await exportTeamSnapshot(params) })
  }),
  defineMethod({
    name: 'team.snapshot.encode',
    params: TeamExportInput,
    handler: (params) => encodeTeamSnapshotForSend(params)
  }),
  defineMethod({
    name: 'team.snapshot.previewImport',
    params: FileBytes,
    handler: (params) => previewTeamSnapshotImport(params.fileBytes)
  }),
  defineMethod({
    name: 'team.snapshot.confirmImport',
    params: ConfirmImport,
    handler: (params) => confirmTeamSnapshotImport(params)
  }),
  defineMethod({
    name: 'snapshot.fetchBytes',
    params: FetchSnapshotBytesInput,
    handler: (params) => fetchSnapshotBytes(params)
  })
]
