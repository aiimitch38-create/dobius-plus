import { createHash } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  writeSync
} from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import {
  LayaAdvisorySurface,
  type LayaAdvisoryResult,
  type LayaAdvisorySurface as LayaAdvisorySurfaceType,
  type LayaAuthoritySnapshot
} from '../../shared/laya-advisory'
import {
  assertPrivateDirectory,
  LayaAdvisoryJournalLock,
  verifyLockedJournal,
  type LayaJournalVerification
} from './laya-advisory-journal-lock'
export type { LayaJournalVerification } from './laya-advisory-journal-lock'

const MAX_JOURNAL_BYTES = 8 * 1024 * 1024
const MAX_RECORD_BYTES = 8 * 1024
const Digest = z.string().regex(/^[a-f0-9]{64}$/)
const Revision = z.string().regex(/^[a-f0-9]{40}$/)
const Id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)

export const LayaJournalDecision = z
  .object({
    kind: z.literal('decision'),
    decisionId: Id,
    createdAt: z.number().int().nonnegative(),
    surface: LayaAdvisorySurface,
    requestDigest: Digest,
    evidenceRefs: z.array(Digest).max(64),
    snapshotRevision: z.string().min(1).max(128),
    modelSourceRevision: Revision.nullable(),
    checkpointRevision: Revision.nullable(),
    evaluationReportSha256: Digest.nullable(),
    confidence: z.number().finite().min(0).max(1).nullable(),
    elapsedMs: z.number().finite().nonnegative().max(120_000).nullable(),
    status: z.enum(['unavailable', 'abstained', 'suggestion']),
    suggestion: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,47}$/)
      .nullable(),
    deterministicVeto: z.string().max(160).nullable()
  })
  .strict()
export type LayaJournalDecision = z.infer<typeof LayaJournalDecision>

export const LayaJournalOutcome = z
  .object({
    kind: z.literal('outcome'),
    decisionId: Id,
    at: z.number().int().nonnegative(),
    outcome: z.enum([
      'shown',
      'dismissed',
      'accepted',
      'rejected',
      'acted-externally',
      'corrected'
    ]),
    outcomeCode: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,47}$/)
      .nullable(),
    evidenceRef: Digest.nullable()
  })
  .strict()
export type LayaJournalOutcome = z.infer<typeof LayaJournalOutcome>

const JournalRecord = z.discriminatedUnion('kind', [LayaJournalDecision, LayaJournalOutcome])
type JournalRecord = z.infer<typeof JournalRecord>

type JournalEnvelope = {
  schemaVersion: 1
  previousHash: string | null
  record: JournalRecord
  hash: string
}

const JournalEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    previousHash: Digest.nullable(),
    record: JournalRecord,
    hash: Digest
  })
  .strict()

export type LayaJournalProviderMetadata = {
  elapsedMs: number | null
  sourceRevision?: string
  checkpointRevision?: string
  evaluationReportSha256?: string
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/** Private append-only journal; each row is hash-chained and contains metadata only. */
export class LayaAdvisoryJournal {
  private readonly filePath: string

  constructor(filePath: string) {
    if (!isAbsolute(filePath)) {
      throw new Error('Advisory journal path must be absolute.')
    }
    this.filePath = resolve(filePath)
  }

  appendAuthorityUnavailable(
    surface: LayaAdvisorySurfaceType,
    result: Extract<LayaAdvisoryResult, { status: 'unavailable' }>,
    createdAt: number
  ): JournalEnvelope {
    return this.append({
      kind: 'decision',
      decisionId: result.decisionId,
      createdAt,
      surface,
      requestDigest: result.requestDigest,
      evidenceRefs: [],
      snapshotRevision: 'authority-unavailable',
      modelSourceRevision: null,
      checkpointRevision: null,
      evaluationReportSha256: null,
      confidence: null,
      elapsedMs: null,
      status: 'unavailable',
      suggestion: null,
      deterministicVeto: null
    })
  }

  appendAdvisoryResult(
    snapshot: LayaAuthoritySnapshot,
    result: LayaAdvisoryResult,
    metadata: LayaJournalProviderMetadata,
    createdAt: number
  ): JournalEnvelope {
    return this.append({
      kind: 'decision',
      decisionId: result.decisionId,
      createdAt,
      surface: snapshot.surface,
      requestDigest: result.requestDigest,
      evidenceRefs: snapshot.evidenceRefs,
      snapshotRevision: snapshot.sourceRevision,
      modelSourceRevision: metadata.sourceRevision ?? null,
      checkpointRevision: metadata.checkpointRevision ?? null,
      evaluationReportSha256: metadata.evaluationReportSha256 ?? null,
      confidence: result.status === 'unavailable' ? null : result.confidence,
      elapsedMs: metadata.elapsedMs,
      status: result.status,
      suggestion: result.status === 'suggestion' ? result.decision : null,
      deterministicVeto: result.status === 'abstained' ? result.deterministicVeto : null
    })
  }

  append(recordInput: LayaJournalDecision | LayaJournalOutcome): JournalEnvelope {
    const record = JournalRecord.parse(recordInput)
    const directory = dirname(this.filePath)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    assertPrivateDirectory(directory)
    const releaseLock = LayaAdvisoryJournalLock.acquire(this.filePath)
    try {
      return this.appendLocked(record)
    } finally {
      releaseLock()
    }
  }

  private appendLocked(record: JournalRecord): JournalEnvelope {
    const { lastHash, records, decisionIds } = this.verifyLocked()
    if (records >= 10_000) {
      throw new Error('Advisory journal record limit reached.')
    }
    if (record.kind === 'outcome' && !decisionIds.includes(record.decisionId)) {
      throw new Error('Advisory outcome must reference an existing decision.')
    }
    const body = { schemaVersion: 1 as const, previousHash: lastHash, record }
    const envelope: JournalEnvelope = { ...body, hash: hash(body) }
    const line = `${JSON.stringify(envelope)}\n`
    if (Buffer.byteLength(line) > MAX_RECORD_BYTES) {
      throw new Error('Advisory journal row exceeds its size limit.')
    }

    const pathInfo = (() => {
      try {
        return lstatSync(this.filePath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return null
        }
        throw error
      }
    })()
    if (pathInfo && (pathInfo.isSymbolicLink() || !pathInfo.isFile())) {
      throw new Error('Advisory journal must be a regular file.')
    }
    const flags =
      constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0)
    const descriptor = openSync(this.filePath, flags, 0o600)
    try {
      const info = fstatSync(descriptor)
      if (
        !info.isFile() ||
        info.nlink !== 1 ||
        info.size + Buffer.byteLength(line) > MAX_JOURNAL_BYTES
      ) {
        throw new Error('Advisory journal is invalid or full.')
      }
      if (pathInfo && (info.dev !== pathInfo.dev || info.ino !== pathInfo.ino)) {
        throw new Error('Advisory journal changed while opening.')
      }
      if (process.getuid && (info.uid !== process.getuid() || (info.mode & 0o077) !== 0)) {
        throw new Error('Advisory journal file must be private to this user.')
      }
      let offset = 0
      const bytes = Buffer.from(line)
      while (offset < bytes.length) {
        offset += writeSync(descriptor, bytes, offset, bytes.length - offset)
      }
      fsyncSync(descriptor)
    } finally {
      closeSync(descriptor)
    }
    return envelope
  }

  verify(): LayaJournalVerification {
    try {
      const directory = dirname(this.filePath)
      assertPrivateDirectory(directory)
      const releaseLock = LayaAdvisoryJournalLock.acquire(this.filePath)
      try {
        return this.verifyLocked()
      } finally {
        releaseLock()
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { records: 0, lastHash: null, decisionIds: [] }
      }
      throw error
    }
  }

  private verifyLocked(): LayaJournalVerification {
    return verifyLockedJournal(
      this.filePath,
      MAX_JOURNAL_BYTES,
      MAX_RECORD_BYTES,
      (value) => JournalEnvelopeSchema.parse(value),
      hash
    )
  }
}
