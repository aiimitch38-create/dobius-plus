import { app, safeStorage } from 'electron'
import { z } from 'zod'
import { CloudJobAdamBindingGrant } from '../../../shared/cloud-job-adam-receipts'
import {
  MAX_PURPOSE_BYTES,
  MAX_SEALED_CHARS,
  PURPOSE,
  PurposeEnvelope,
  SEALED_PREFIX,
  SealedIntentRequest
} from './cloud-job-adam-intent-protocol'
import {
  assertIntentRuntimeCurrent,
  inspectIntentRuntime,
  requireIntentAvailability,
  requireIntentDecryption
} from './cloud-job-adam-intent-runtime'
import type { IntentRuntimeReader } from './cloud-job-adam-intent-runtime'

const DecryptResult = z.object({ result: z.string(), shouldReEncrypt: z.boolean() }).strict()

export class CloudJobAdamIntentUnsealerError extends Error {
  constructor() {
    super('ADAM intent recovery is unavailable.')
    this.name = 'CloudJobAdamIntentUnsealerError'
  }
}

export type CloudJobAdamIntentRecovery = Readonly<{
  intentId: string
  grant: Readonly<z.infer<typeof CloudJobAdamBindingGrant>>
}>
export type CloudJobAdamIntentUnsealer = {
  unseal(raw: unknown): Promise<CloudJobAdamIntentRecovery>
  invalidate(): void
  dispose(): void
}

/** Main-only factory; no secret-store API runs until unseal is called. */
export function createCloudJobAdamIntentUnsealer(): CloudJobAdamIntentUnsealer {
  return createUnsealer(() => ({
    platform: process.platform,
    electronVersion: process.versions.electron,
    app,
    safeStorage
  }))
}

/** @internal Trusted test/composition seam, not a caller identity or authorization proof. */
export function createCloudJobAdamIntentUnsealerWithRuntime(
  reader: IntentRuntimeReader
): CloudJobAdamIntentUnsealer {
  return createUnsealer(reader)
}

function createUnsealer(readRuntime: IntentRuntimeReader): CloudJobAdamIntentUnsealer {
  let generation = 0
  let disposed = false
  const invalidate = () => {
    generation += 1
    disposed = true
  }

  return {
    invalidate,
    dispose: invalidate,
    async unseal(raw: unknown): Promise<CloudJobAdamIntentRecovery> {
      const callGeneration = generation
      try {
        if (disposed) {
          throw new CloudJobAdamIntentUnsealerError()
        }
        const parsed = SealedIntentRequest.parse(raw)
        const identity = Object.freeze({ ...parsed.identity })
        const request = Object.freeze({ ...parsed, identity })
        const ciphertext = decodeSealedEnvelope(request.sealedEnvelope)

        const snapshot = inspectIntentRuntime(readRuntime(), 'decrypt')
        const decrypt = requireIntentDecryption(snapshot.safeStorage)
        assertIntentRuntimeCurrent(
          readRuntime,
          snapshot,
          callGeneration,
          generation,
          disposed,
          'decrypt'
        )
        const available = await requireIntentAvailability(snapshot.safeStorage)
        assertIntentRuntimeCurrent(
          readRuntime,
          snapshot,
          callGeneration,
          generation,
          disposed,
          'decrypt'
        )
        if (available !== true) {
          throw new CloudJobAdamIntentUnsealerError()
        }

        assertIntentRuntimeCurrent(
          readRuntime,
          snapshot,
          callGeneration,
          generation,
          disposed,
          'decrypt'
        )
        const rawResult = await decrypt(ciphertext)
        assertIntentRuntimeCurrent(
          readRuntime,
          snapshot,
          callGeneration,
          generation,
          disposed,
          'decrypt'
        )
        const stillAvailable = await requireIntentAvailability(snapshot.safeStorage)
        assertIntentRuntimeCurrent(
          readRuntime,
          snapshot,
          callGeneration,
          generation,
          disposed,
          'decrypt'
        )
        if (stillAvailable !== true) {
          throw new CloudJobAdamIntentUnsealerError()
        }

        const result = DecryptResult.parse(rawResult)
        if (
          result.shouldReEncrypt ||
          Buffer.byteLength(result.result, 'utf8') > MAX_PURPOSE_BYTES
        ) {
          throw new CloudJobAdamIntentUnsealerError()
        }
        const purpose = PurposeEnvelope.parse(JSON.parse(result.result))
        if (
          purpose.purpose !== PURPOSE ||
          purpose.intentId !== request.intentId ||
          !sameIdentity(purpose.identity, identity)
        ) {
          throw new CloudJobAdamIntentUnsealerError()
        }
        const grant = Object.freeze(
          CloudJobAdamBindingGrant.parse({ ...identity, capability: purpose.capability })
        )
        return Object.freeze({ intentId: request.intentId, grant })
      } catch {
        throw new CloudJobAdamIntentUnsealerError()
      }
    }
  }
}

function decodeSealedEnvelope(sealed: string): Buffer {
  if (sealed.length > MAX_SEALED_CHARS || !sealed.startsWith(SEALED_PREFIX)) {
    throw new CloudJobAdamIntentUnsealerError()
  }
  const encoded = sealed.slice(SEALED_PREFIX.length)
  if (
    !encoded ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
  ) {
    throw new CloudJobAdamIntentUnsealerError()
  }
  const ciphertext = Buffer.from(encoded, 'base64')
  if (ciphertext.length === 0 || ciphertext.toString('base64') !== encoded) {
    throw new CloudJobAdamIntentUnsealerError()
  }
  return ciphertext
}

function sameIdentity(
  actual: z.infer<typeof SealedIntentRequest>['identity'],
  expected: z.infer<typeof SealedIntentRequest>['identity']
): boolean {
  return (
    actual.schemaVersion === expected.schemaVersion &&
    actual.bindingId === expected.bindingId &&
    actual.adamInstanceId === expected.adamInstanceId &&
    actual.parentObjectiveId === expected.parentObjectiveId &&
    actual.parentObjectiveVersion === expected.parentObjectiveVersion &&
    actual.projectId === expected.projectId &&
    actual.contextDigest === expected.contextDigest &&
    actual.requestFingerprint === expected.requestFingerprint &&
    actual.expiresAtMs === expected.expiresAtMs
  )
}
