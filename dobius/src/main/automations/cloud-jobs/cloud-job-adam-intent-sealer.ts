import { app, safeStorage } from 'electron'
import {
  AdamIntentEnvelope,
  MAX_SEALED_CHARS,
  PURPOSE,
  PurposeEnvelope,
  SEALED_PREFIX
} from './cloud-job-adam-intent-protocol'
import {
  assertIntentRuntimeCurrent,
  inspectIntentRuntime,
  requireIntentAvailability,
  requireIntentEncryption
} from './cloud-job-adam-intent-runtime'
import type { IntentRuntimeReader } from './cloud-job-adam-intent-runtime'

export class CloudJobAdamIntentSealerError extends Error {
  constructor() {
    super('ADAM intent sealing is unavailable.')
    this.name = 'CloudJobAdamIntentSealerError'
  }
}

export type CloudJobAdamIntentSealer = {
  seal(raw: unknown): Promise<string>
  invalidate(): void
  dispose(): void
}

/** Main-only factory. The Electron bindings are resolved only when seal is called. */
export function createCloudJobAdamIntentSealer(): CloudJobAdamIntentSealer {
  return createSealer(() => ({
    platform: process.platform,
    electronVersion: process.versions.electron,
    app,
    safeStorage
  }))
}

/** @internal Test/composition seam; dependencies are trusted and are not caller identity. */
export function createCloudJobAdamIntentSealerWithRuntime(
  reader: IntentRuntimeReader
): CloudJobAdamIntentSealer {
  return createSealer(reader)
}

function createSealer(readRuntime: IntentRuntimeReader): CloudJobAdamIntentSealer {
  let generation = 0
  let disposed = false

  const invalidate = () => {
    generation += 1
    disposed = true
  }

  return {
    invalidate,
    dispose: invalidate,
    async seal(raw: unknown): Promise<string> {
      const callGeneration = generation
      try {
        if (disposed) {
          throw new CloudJobAdamIntentSealerError()
        }
        // Caller-controlled accessors and proxies must stay inside this redaction boundary.
        const parsed = AdamIntentEnvelope.safeParse(raw)
        if (!parsed.success) {
          throw new CloudJobAdamIntentSealerError()
        }
        const identity = Object.freeze({ ...parsed.data.identity })
        const envelope = Object.freeze({ ...parsed.data, identity })
        const purpose = PurposeEnvelope.parse({
          purpose: PURPOSE,
          schemaVersion: 1,
          intentId: envelope.intentId,
          identity,
          capability: envelope.capability
        })
        const plaintext = JSON.stringify(purpose)

        const snapshot = inspectIntentRuntime(readRuntime(), 'encrypt')
        const encrypt = requireIntentEncryption(snapshot.safeStorage)
        assertIntentRuntimeCurrent(
          readRuntime,
          snapshot,
          callGeneration,
          generation,
          disposed,
          'encrypt'
        )
        const available = await requireIntentAvailability(snapshot.safeStorage)
        assertIntentRuntimeCurrent(
          readRuntime,
          snapshot,
          callGeneration,
          generation,
          disposed,
          'encrypt'
        )
        if (available !== true) {
          throw new CloudJobAdamIntentSealerError()
        }

        assertIntentRuntimeCurrent(
          readRuntime,
          snapshot,
          callGeneration,
          generation,
          disposed,
          'encrypt'
        )
        const ciphertext = await encrypt(plaintext)
        assertIntentRuntimeCurrent(
          readRuntime,
          snapshot,
          callGeneration,
          generation,
          disposed,
          'encrypt'
        )
        const stillAvailable = await requireIntentAvailability(snapshot.safeStorage)
        assertIntentRuntimeCurrent(
          readRuntime,
          snapshot,
          callGeneration,
          generation,
          disposed,
          'encrypt'
        )
        if (stillAvailable !== true) {
          throw new CloudJobAdamIntentSealerError()
        }

        return encodeCiphertext(ciphertext, envelope.capability)
      } catch {
        throw new CloudJobAdamIntentSealerError()
      }
    }
  }
}

function encodeCiphertext(ciphertext: unknown, capability: string): string {
  if (
    !Buffer.isBuffer(ciphertext) ||
    ciphertext.length === 0 ||
    ciphertext.includes(Buffer.from(capability, 'utf8'))
  ) {
    throw new CloudJobAdamIntentSealerError()
  }
  const encodedLength = SEALED_PREFIX.length + Math.ceil(ciphertext.length / 3) * 4
  if (encodedLength > MAX_SEALED_CHARS) {
    throw new CloudJobAdamIntentSealerError()
  }
  const base64 = ciphertext.toString('base64')
  if (!Buffer.from(base64, 'base64').equals(ciphertext)) {
    throw new CloudJobAdamIntentSealerError()
  }
  const result = `${SEALED_PREFIX}${base64}`
  if (result.length > MAX_SEALED_CHARS || result.includes(capability)) {
    throw new CloudJobAdamIntentSealerError()
  }
  return result
}
