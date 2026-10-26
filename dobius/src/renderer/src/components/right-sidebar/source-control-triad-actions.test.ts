import { describe, expect, it } from 'vitest'
import type { DropdownEntry } from './source-control-dropdown-items'
import { resolveTriadActions, triadSlotForRemoteOp } from './source-control-triad-actions'

const entries: DropdownEntry[] = [
  { kind: 'commit', label: 'Commit', title: 'Commit staged', disabled: false },
  { kind: 'separator' },
  { kind: 'push', label: 'Push', title: 'Nothing to push', disabled: true },
  { kind: 'pull', label: 'Pull 1 commit', title: 'Pull 1 commit', disabled: false },
  { kind: 'fast_forward', label: 'Fast-forward', title: 'ff', disabled: false },
  { kind: 'publish', label: 'Publish Branch', title: 'Branch is already published', disabled: true }
]

describe('resolveTriadActions', () => {
  it('uses the primary Commit reason and the push/pull items as-is', () => {
    const triad = resolveTriadActions(entries, {
      kind: 'commit',
      label: 'Commit',
      title: 'Stage files to commit',
      disabled: true
    })
    expect(triad.commit).toEqual({
      kind: 'commit',
      label: 'Commit',
      title: 'Stage files to commit',
      disabled: true
    })
    expect(triad.push.kind).toBe('push')
    expect(triad.push.disabled).toBe(true)
    expect(triad.pull).toMatchObject({ kind: 'pull', label: 'Pull 1 commit', disabled: false })
  })

  it('swaps in Publish when it is the live action and fast-forward when pull is blocked', () => {
    const noUpstream = entries.map((e) =>
      e.kind === 'publish'
        ? { ...e, title: 'Publish this branch to origin', disabled: false }
        : e.kind === 'pull'
          ? { ...e, disabled: true }
          : e
    )
    const triad = resolveTriadActions(noUpstream, {
      kind: 'publish',
      label: 'Publish Branch',
      title: 'Publish',
      disabled: false
    })
    expect(triad.push).toMatchObject({ kind: 'publish', label: 'Publish Branch', disabled: false })
    expect(triad.pull).toMatchObject({ kind: 'fast_forward', disabled: false })
    expect(triad.commit).toMatchObject({ kind: 'commit', title: 'Commit staged' })
  })

  it('maps in-flight remote ops to the matching slot', () => {
    expect(triadSlotForRemoteOp('push')).toBe('push')
    expect(triadSlotForRemoteOp('publish')).toBe('push')
    expect(triadSlotForRemoteOp('sync')).toBe('pull')
    expect(triadSlotForRemoteOp('fetch')).toBeNull()
    expect(triadSlotForRemoteOp(null)).toBeNull()
  })
})
