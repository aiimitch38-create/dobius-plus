import type { PrimaryAction, RemoteOpKind } from './source-control-primary-action-types'
import type { DropdownActionKind, DropdownEntry, DropdownItem } from './source-control-dropdown-items'

// Why: the Board-hosted Source Control panel shows three always-visible
// buttons (Commit / Push / Pull) instead of the adaptive split button. They
// reuse the dropdown's already-gated items so labels, disabled reasons and
// dispatch stay identical to the "…" menu — no second source of git truth.

export type TriadAction = {
  kind: DropdownActionKind
  label: string
  title: string
  disabled: boolean
}

export type TriadActions = {
  commit: TriadAction
  push: TriadAction
  pull: TriadAction
}

const PUSH_OP_KINDS: ReadonlySet<RemoteOpKind> = new Set(['push', 'publish', 'force_push'])
const PULL_OP_KINDS: ReadonlySet<RemoteOpKind> = new Set(['pull', 'fast_forward', 'sync'])

function item(entries: readonly DropdownEntry[], kind: DropdownActionKind): DropdownItem | null {
  const found = entries.find((entry) => entry.kind === kind)
  return found && found.kind !== 'separator' ? found : null
}

function toTriad(entry: DropdownItem): TriadAction {
  return { kind: entry.kind, label: entry.label, title: entry.title, disabled: entry.disabled }
}

export function resolveTriadActions(
  entries: readonly DropdownEntry[],
  primaryAction: PrimaryAction
): TriadActions {
  const commitItem = item(entries, 'commit')
  const commit: TriadAction =
    primaryAction.kind === 'commit'
      ? // Why: the primary's title carries the precise reason (stage files /
        // enter a message / conflicts) while the item's label stays "Commit".
        {
          kind: 'commit',
          label: commitItem?.label ?? primaryAction.label,
          title: primaryAction.title,
          disabled: primaryAction.disabled
        }
      : commitItem
        ? toTriad(commitItem)
        : { kind: 'commit', label: 'Commit', title: primaryAction.title, disabled: true }

  const publishItem = item(entries, 'publish')
  const pushItem = item(entries, 'push')
  // Why: with no upstream the honest push is "Publish Branch" (same slot).
  const pushSource = publishItem && !publishItem.disabled ? publishItem : (pushItem ?? publishItem)
  const push: TriadAction = pushSource
    ? toTriad(pushSource)
    : { kind: 'push', label: 'Push', title: '', disabled: true }

  const pullItem = item(entries, 'pull')
  const fastForwardItem = item(entries, 'fast_forward')
  const pullSource =
    pullItem && pullItem.disabled && fastForwardItem && !fastForwardItem.disabled
      ? fastForwardItem
      : (pullItem ?? fastForwardItem)
  const pull: TriadAction = pullSource
    ? toTriad(pullSource)
    : { kind: 'pull', label: 'Pull', title: '', disabled: true }

  return { commit, push, pull }
}

/** Which triad slot (if any) should spin for the remote op currently running. */
export function triadSlotForRemoteOp(kind: RemoteOpKind | null): 'push' | 'pull' | null {
  if (!kind) {
    return null
  }
  if (PUSH_OP_KINDS.has(kind)) {
    return 'push'
  }
  if (PULL_OP_KINDS.has(kind)) {
    return 'pull'
  }
  return null
}
