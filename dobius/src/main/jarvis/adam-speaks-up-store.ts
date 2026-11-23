// Small saved state for "ADAM speaks up": the day the morning brief last ran
// and the iMessage handle Carson verified. Why save(): when a write fails it
// throws and drops the refused value from memory, so the old value stays and
// a later tick can try again instead of believing a claim that was never saved.
import { SafeJsonFile } from '../storage/safe-json-file'

const DATE = /^\d{4}-\d{2}-\d{2}$/

function savedValue<T>(file: SafeJsonFile<T>, value: T, label: string): boolean {
  try {
    file.save(value)
    return true
  } catch (error) {
    console.warn(`${label} could not be saved:`, error)
    return false
  }
}

export type BriefDayStore = {
  lastRunDate: () => string | null
  /** False when the day could not be saved; the old day is kept. */
  setLastRunDate: (date: string | null) => boolean
}

export function createBriefDayStore(filePath: () => string): BriefDayStore {
  const file = new SafeJsonFile<{ lastRunDate: string | null }>({
    filePath,
    parse: (raw) => {
      const date = (raw as { lastRunDate?: unknown } | null)?.lastRunDate
      return date === null || (typeof date === 'string' && DATE.test(date))
        ? { lastRunDate: date }
        : undefined
    },
    fallback: () => ({ lastRunDate: null }),
    label: '[adam] adam-morning-brief.json'
  })
  return {
    lastRunDate: () => file.get().lastRunDate,
    setLastRunDate: (date) => savedValue(file, { lastRunDate: date }, 'Morning brief day')
  }
}

export type VerifiedHandleStore = {
  verifiedHandle: () => string | null
  setVerifiedHandle: (handle: string | null) => boolean
}

export function createVerifiedHandleStore(filePath: () => string): VerifiedHandleStore {
  const file = new SafeJsonFile<{ verifiedHandle: string | null }>({
    filePath,
    parse: (raw) => {
      const handle = (raw as { verifiedHandle?: unknown } | null)?.verifiedHandle
      return handle === null || (typeof handle === 'string' && handle.length <= 200)
        ? { verifiedHandle: handle }
        : undefined
    },
    fallback: () => ({ verifiedHandle: null }),
    // Why private: it holds Carson's phone number or email.
    mode: 0o600,
    label: '[adam] adam-brief-handle.json'
  })
  return {
    verifiedHandle: () => file.get().verifiedHandle,
    setVerifiedHandle: (handle) =>
      savedValue(file, { verifiedHandle: handle }, 'Verified iMessage handle')
  }
}
