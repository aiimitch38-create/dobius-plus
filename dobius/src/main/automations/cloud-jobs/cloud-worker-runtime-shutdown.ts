import type {
  CloudWorkerRuntimeSnapshotSlot,
  RuntimeSlotState
} from './cloud-worker-runtime-contract'

export async function drainCloudWorkers(args: {
  timeoutMs: number
  slots: RuntimeSlotState[]
  tickTask: Promise<void> | null
  requestCancellation: (slot: RuntimeSlotState) => Promise<void>
  refresh: (slot: RuntimeSlotState) => Promise<void>
  snapshot: () => CloudWorkerRuntimeSnapshotSlot[]
}) {
  const work = async () => {
    if (args.tickTask) {
      await Promise.allSettled([args.tickTask])
    }
    for (const slot of args.slots) {
      if (slot.state.kind === 'active') {
        try {
          await args.requestCancellation(slot)
        } catch {
          retainUncertainSlot(slot)
        }
      }
    }
    await Promise.allSettled(
      args.slots.flatMap(({ state }) => {
        if (state.kind !== 'active') {
          return []
        }
        return [state.attempt.runTask, state.attempt.cancelTask].filter(
          (task): task is Promise<unknown> => task !== null
        )
      })
    )
    await Promise.all(
      args.slots.map(async (slot) => {
        try {
          await args.refresh(slot)
        } catch {
          retainUncertainSlot(slot)
        }
      })
    )
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = await Promise.race([
    work().then(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), args.timeoutMs)
    })
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer)
    }
  })
  return {
    cleanupProven: !timedOut && args.slots.every(({ state }) => state.kind === 'idle'),
    timedOut,
    slots: args.snapshot()
  }
}

function retainUncertainSlot(slot: RuntimeSlotState) {
  if (slot.state.kind === 'active') {
    slot.state.attempt.cancellationUncertain = true
  } else if (slot.state.kind === 'idle') {
    slot.state = { kind: 'ambiguous', reason: 'Shutdown could not prove worker cleanup.' }
  }
}
