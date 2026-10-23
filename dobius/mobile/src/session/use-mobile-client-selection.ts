import AsyncStorage from '@react-native-async-storage/async-storage'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MobileClientSelectionController,
  mobileClientSelectionKey
} from './mobile-client-selection'

export function useMobileClientSelection(hostId: string, worktreeId: string) {
  const controller = useMemo(
    () =>
      new MobileClientSelectionController(
        AsyncStorage,
        mobileClientSelectionKey(hostId, worktreeId)
      ),
    [hostId, worktreeId]
  )
  const [status, setStatus] = useState<
    'loading' | 'selected' | 'empty' | 'missing' | 'unavailable'
  >('loading')
  const requests = useMemo(() => ({ terminals: false, tabs: false }), [controller])
  const currentControllerRef = useRef<typeof controller | null>(controller)
  currentControllerRef.current = controller
  // A response from an old route must never publish into the next workstation.
  const isCurrent = useCallback(() => currentControllerRef.current === controller, [controller])
  const onHydratedRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    currentControllerRef.current = controller
    let disposed = false
    void controller.hydrate().then(() => {
      if (!disposed) {
        onHydratedRef.current?.()
      }
    })
    return () => {
      disposed = true
      if (currentControllerRef.current === controller) {
        currentControllerRef.current = null
      }
    }
  }, [controller])
  return { controller, onHydratedRef, isCurrent, requests, status, setStatus }
}
