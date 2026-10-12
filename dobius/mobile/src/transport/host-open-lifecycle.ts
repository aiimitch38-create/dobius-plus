import type { ConnectionState, HostProfile } from './types'

export type PendingHostOpen = {
  promise: Promise<void>
  hostGeneration: number
  providerEpoch: number
}

export class HostOpenLifecycle {
  readonly pending = new Map<string, PendingHostOpen>()
  private readonly generations = new Map<string, number>()
  private providerEpoch = 0
  private providerActive = true

  begin(hostId: string, promise: Promise<void>): PendingHostOpen {
    const pending: PendingHostOpen = {
      promise,
      hostGeneration: this.generations.get(hostId) ?? 0,
      providerEpoch: this.providerEpoch
    }
    this.pending.set(hostId, pending)
    return pending
  }

  isCurrent(hostId: string, pending: PendingHostOpen): boolean {
    return (
      this.providerActive &&
      this.providerEpoch === pending.providerEpoch &&
      (this.generations.get(hostId) ?? 0) === pending.hostGeneration &&
      this.pending.get(hostId) === pending
    )
  }

  invalidateHost(hostId: string): void {
    this.generations.set(hostId, (this.generations.get(hostId) ?? 0) + 1)
  }

  finish(hostId: string, pending: PendingHostOpen): void {
    if (this.pending.get(hostId) === pending) {
      this.pending.delete(hostId)
    }
  }

  activateProvider(): void {
    this.providerActive = true
  }

  deactivateProvider(): void {
    this.providerActive = false
    this.providerEpoch += 1
  }
}

export function closeHostEntry<
  Entry extends { client: { close: () => void }; unsubState: () => void },
  Profile
>(
  hostId: string,
  store: Map<string, Entry>,
  lifecycle: HostOpenLifecycle,
  primedHosts: Map<string, Profile>,
  notifyHostState: (hostId: string, state: ConnectionState) => void,
  notifyAllHosts: () => void
): void {
  lifecycle.invalidateHost(hostId)
  primedHosts.delete(hostId)
  const entry = store.get(hostId)
  if (!entry) {
    return
  }
  entry.unsubState()
  entry.client.close()
  store.delete(hostId)
  notifyHostState(hostId, 'disconnected')
  notifyAllHosts()
}

export async function loadPendingHostProfile(
  hostId: string,
  isCurrent: () => boolean,
  loadHosts: () => Promise<HostProfile[]>,
  onFailure: () => void
): Promise<HostProfile | undefined> {
  try {
    const hosts = await loadHosts()
    if (!isCurrent()) {
      return undefined
    }
    return hosts.find((host) => host.id === hostId)
  } catch {
    if (isCurrent()) {
      onFailure()
    }
    return undefined
  }
}

export function notifyHostOpenFailure(
  hostId: string,
  notifyHostState: (hostId: string, state: ConnectionState) => void,
  notifyAllHosts: () => void
): void {
  notifyHostState(hostId, 'disconnected')
  notifyAllHosts()
}
