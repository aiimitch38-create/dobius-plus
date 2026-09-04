import { useEffect, useRef, useState } from 'react'
import type { AppState } from '@/store'

// Why: AddRepoDialog's close effect aborts in-flight clone/nested work. Keep
// one closed render after the modal deselects, then remove hidden
// SSH/remote subscriptions on a deferred unmount instead of tearing the
// dialog down mid-close.
export function useAddRepoDialogMountGate(activeModal: AppState['activeModal']): boolean {
  const [shouldMount, setShouldMount] = useState(false)
  const unmountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (activeModal === 'add-repo') {
      if (unmountTimerRef.current) {
        clearTimeout(unmountTimerRef.current)
        unmountTimerRef.current = null
      }
      setShouldMount(true)
      return
    }
    if (shouldMount && !unmountTimerRef.current) {
      unmountTimerRef.current = setTimeout(() => {
        setShouldMount(false)
        unmountTimerRef.current = null
      }, 0)
    }
    return () => {
      if (unmountTimerRef.current) {
        clearTimeout(unmountTimerRef.current)
        unmountTimerRef.current = null
      }
    }
  }, [activeModal, shouldMount])

  return shouldMount
}
