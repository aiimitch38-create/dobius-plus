import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

const Identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
const CanonicalUuid = z
  .string()
  .uuid()
  .refine((value) => value === value.toLowerCase())
const SortedIdentifiers = z
  .array(Identifier)
  .min(1)
  .max(64)
  .superRefine((values, ctx) => {
    if (values.some((value, index) => index > 0 && values[index - 1]! >= value)) {
      ctx.addIssue({ code: 'custom', message: 'Values must be unique and sorted.' })
    }
  })

const Resource = z
  .object({ method: Identifier, projectId: Identifier, resourceId: Identifier })
  .strict()
const EnrollmentIdentitySchema = z
  .object({
    schemaVersion: z.literal(1),
    serviceId: Identifier,
    instanceId: CanonicalUuid,
    audienceRuntimeId: CanonicalUuid,
    authorizationGeneration: z.number().int().positive().safe(),
    allowedMethods: SortedIdentifiers,
    allowedProjects: SortedIdentifiers,
    allowedResources: z
      .array(Resource)
      .min(1)
      .max(256)
      .superRefine((items, ctx) => {
        const keys = items.map((item) => `${item.method}\0${item.projectId}\0${item.resourceId}`)
        if (keys.some((key, index) => index > 0 && keys[index - 1]! >= key)) {
          ctx.addIssue({ code: 'custom', message: 'Resources must be unique and sorted.' })
        }
      })
  })
  .strict()

export const AdamServicePrincipalEnrollmentSchema = z
  .object({
    identity: EnrollmentIdentitySchema,
    credential: z.string().regex(/^[A-Za-z0-9_-]{43}$/)
  })
  .strict()

export const AdamServicePrincipalRequestSchema = z
  .object({
    audienceRuntimeId: CanonicalUuid,
    method: Identifier,
    projectId: Identifier,
    resourceId: Identifier
  })
  .strict()

export const AdamServicePrincipalPeerSchema = z
  .object({
    serviceId: Identifier,
    instanceId: CanonicalUuid,
    audienceRuntimeId: CanonicalUuid,
    authorizationGeneration: z.number().int().positive().safe()
  })
  .strict()

export const AdamServicePrincipalVerifyInputSchema = z
  .object({
    peer: z.unknown(),
    credential: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    request: AdamServicePrincipalRequestSchema
  })
  .strict()

export type AdamServicePrincipalResource = Readonly<z.infer<typeof Resource>>
export type AdamServicePrincipalIdentity = Readonly<
  Omit<
    z.infer<typeof EnrollmentIdentitySchema>,
    'allowedMethods' | 'allowedProjects' | 'allowedResources'
  > & {
    allowedMethods: readonly string[]
    allowedProjects: readonly string[]
    allowedResources: readonly AdamServicePrincipalResource[]
  }
>
export type AdamServicePrincipalRequest = Readonly<
  z.infer<typeof AdamServicePrincipalRequestSchema>
>
export type AdamServicePrincipalProof = Readonly<{ identity: AdamServicePrincipalIdentity }>

export function parseServiceId(raw: unknown): string {
  return Identifier.parse(raw)
}

export function parseGeneration(raw: unknown): number {
  return z.number().int().positive().safe().parse(raw)
}

export function decodeCredential(value: string): Buffer {
  const decoded = Buffer.from(value, 'base64url')
  if (decoded.length !== 32 || decoded.toString('base64url') !== value) {
    throw new Error('invalid credential')
  }
  return decoded
}

export function detachIdentity(
  identity: z.infer<typeof EnrollmentIdentitySchema> | AdamServicePrincipalIdentity
): AdamServicePrincipalIdentity {
  return Object.freeze({
    ...identity,
    allowedMethods: Object.freeze([...identity.allowedMethods]),
    allowedProjects: Object.freeze([...identity.allowedProjects]),
    allowedResources: Object.freeze(
      identity.allowedResources.map((item) => Object.freeze({ ...item }))
    )
  })
}

export function samePeer(
  identity: AdamServicePrincipalIdentity,
  peer: z.infer<typeof AdamServicePrincipalPeerSchema>
): boolean {
  return (
    identity.serviceId === peer.serviceId &&
    identity.instanceId === peer.instanceId &&
    identity.audienceRuntimeId === peer.audienceRuntimeId &&
    identity.authorizationGeneration === peer.authorizationGeneration
  )
}

export function sameDigest(expected: Buffer, actual: Buffer): boolean {
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function assertAllowed(
  identity: Pick<
    AdamServicePrincipalIdentity,
    'audienceRuntimeId' | 'allowedMethods' | 'allowedProjects' | 'allowedResources'
  >,
  request: z.infer<typeof AdamServicePrincipalRequestSchema>
): void {
  const resourceAllowed = identity.allowedResources.some(
    (item) =>
      item.method === request.method &&
      item.projectId === request.projectId &&
      item.resourceId === request.resourceId
  )
  if (
    request.audienceRuntimeId !== identity.audienceRuntimeId ||
    !identity.allowedMethods.includes(request.method) ||
    !identity.allowedProjects.includes(request.projectId) ||
    !resourceAllowed
  ) {
    throw new Error('request denied')
  }
}
