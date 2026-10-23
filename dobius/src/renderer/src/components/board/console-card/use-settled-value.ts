import { useEffect, useState } from 'react'

/** `value` once it has stopped changing for `delayMs`; the previous settled value until then. */
export function useSettledValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    if (Object.is(value, settled)) {
      return
    }
    const timer = window.setTimeout(() => setSettled(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [delayMs, settled, value])
  return settled
}
