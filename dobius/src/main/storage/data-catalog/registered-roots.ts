import { lstat, realpath, stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import {
  CatalogOpaqueId,
  CatalogRootId,
  CatalogRootIdentitySchema,
  RegisteredCatalogRootSchema,
  type CatalogFileIdentity,
  type CatalogRootIdentityReader,
  type RegisteredCatalogRoot,
  type RegisteredCatalogRootProvider
} from './types'

export type AuthorizedRootResolution =
  | { state: 'authorized'; root: RegisteredCatalogRoot }
  | { state: 'denied' }
  | { state: 'unavailable' }
  | { state: 'changed' }

export class BoundedOperationError extends Error {
  constructor(readonly reason: 'cancelled' | 'timeout') {
    super(reason === 'cancelled' ? 'Operation cancelled.' : 'Operation deadline exceeded.')
  }
}

export function runBounded<T>(
  start: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
  onLateValue?: (value: T) => void | Promise<void>
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new BoundedOperationError('cancelled'))
      return
    }
    const controller = new AbortController()
    const abort = () => {
      controller.abort()
      finish(() => reject(new BoundedOperationError('cancelled')))
    }
    const onTimeout = () => {
      controller.abort()
      finish(() => reject(new BoundedOperationError('timeout')))
    }
    const finish = (settle: () => void) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      settle()
    }
    let settled = false
    const timer = setTimeout(onTimeout, timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    const operationSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal
    Promise.resolve()
      .then(() => {
        if (settled) {
          throw new BoundedOperationError('cancelled')
        }
        return start(operationSignal)
      })
      .then(
        (value) => {
          if (settled) {
            void Promise.resolve(onLateValue?.(value)).catch(() => undefined)
          } else {
            finish(() => resolve(value))
          }
        },
        (error: unknown) => finish(() => reject(error))
      )
  })
}

export function fileIdentity(value: {
  dev: bigint
  ino: bigint
  birthtimeNs?: bigint
}): CatalogFileIdentity {
  return {
    dev: String(value.dev),
    ino: String(value.ino),
    ...(value.birthtimeNs === undefined ? {} : { birthtimeNs: String(value.birthtimeNs) })
  }
}

function sameIdentity(left: CatalogFileIdentity, right: CatalogFileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function sameRootIdentity(
  left: RegisteredCatalogRoot['identity'],
  right: RegisteredCatalogRoot['identity']
): boolean {
  return (
    sameIdentity(left, right) &&
    left.incarnation.provider === right.incarnation.provider &&
    left.incarnation.scope === right.incarnation.scope &&
    left.incarnation.token === right.incarnation.token
  )
}

export function sameRegisteredRoot(
  left: RegisteredCatalogRoot,
  right: RegisteredCatalogRoot
): boolean {
  return (
    left.id === right.id &&
    left.kind === right.kind &&
    left.canonicalPath === right.canonicalPath &&
    left.generation === right.generation &&
    left.browseGranted === true &&
    right.browseGranted === true &&
    sameRootIdentity(left.identity, right.identity)
  )
}

/** Resolve only roots selected by trusted registration, then recheck canonical directory identity. */
export async function resolveAuthorizedCatalogRoot(
  provider: RegisteredCatalogRootProvider,
  principalId: string,
  rootId: string,
  signal?: AbortSignal,
  operationTimeoutMs = 1000,
  readRootIdentity?: CatalogRootIdentityReader
): Promise<AuthorizedRootResolution> {
  const principal = CatalogOpaqueId.safeParse(principalId)
  const parsedRootId = CatalogRootId.safeParse(rootId)
  if (!principal.success || !parsedRootId.success || signal?.aborted) {
    return { state: 'denied' }
  }

  let registration: RegisteredCatalogRoot | null
  try {
    registration = await runBounded(
      (operationSignal) =>
        provider.resolveAuthorizedRoot(principal.data, parsedRootId.data, operationSignal),
      operationTimeoutMs,
      signal
    )
  } catch {
    return { state: 'unavailable' }
  }
  if (signal?.aborted) {
    return { state: 'unavailable' }
  }
  if (registration === null) {
    return { state: 'denied' }
  }
  if (!readRootIdentity) {
    return { state: 'unavailable' }
  }
  const parsedRegistration = RegisteredCatalogRootSchema.safeParse(registration)
  if (!parsedRegistration.success) {
    return { state: 'unavailable' }
  }
  if (parsedRegistration.data.id !== parsedRootId.data) {
    return { state: 'unavailable' }
  }
  registration = parsedRegistration.data
  if (
    !isAbsolute(registration.canonicalPath) ||
    resolve(registration.canonicalPath) !== registration.canonicalPath
  ) {
    return { state: 'unavailable' }
  }

  try {
    const linkInfo = await runBounded(
      () => lstat(registration.canonicalPath, { bigint: true }),
      operationTimeoutMs,
      signal
    )
    if (!linkInfo.isDirectory() || linkInfo.isSymbolicLink()) {
      return { state: 'changed' }
    }
    const canonicalPath = await runBounded(
      () => realpath(registration.canonicalPath),
      operationTimeoutMs,
      signal
    )
    const current = await runBounded(
      () => stat(registration.canonicalPath, { bigint: true }),
      operationTimeoutMs,
      signal
    )
    const capturedIdentity = await runBounded(
      () => readRootIdentity(registration.canonicalPath),
      operationTimeoutMs,
      signal
    )
    const parsedIdentity = CatalogRootIdentitySchema.safeParse(capturedIdentity)
    if (!parsedIdentity.success) {
      return { state: 'unavailable' }
    }
    if (
      canonicalPath !== registration.canonicalPath ||
      !current.isDirectory() ||
      !sameIdentity(registration.identity, fileIdentity(current)) ||
      !sameRootIdentity(registration.identity, parsedIdentity.data)
    ) {
      return { state: 'changed' }
    }
  } catch {
    return { state: 'unavailable' }
  }
  if (signal?.aborted) {
    return { state: 'unavailable' }
  }
  return { state: 'authorized', root: registration }
}
