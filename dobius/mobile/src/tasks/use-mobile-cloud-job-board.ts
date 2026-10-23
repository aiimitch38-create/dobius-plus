import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CloudJobBoardController,
  emptyCloudJobBoard,
  type CloudJobBoardState,
  type CloudJobReadSource
} from '../../../src/shared/cloud-job-projection'
export function useMobileCloudJobBoard(source: CloudJobReadSource | null) {
  const [value, setValue] = useState<{
    source: CloudJobReadSource | null
    state: CloudJobBoardState
  }>({ source: null, state: emptyCloudJobBoard() })
  const reader = useRef<CloudJobBoardController | null>(null)
  useEffect(() => {
    if (!source) {
      reader.current = null
      return
    }
    const controller = new CloudJobBoardController(source)
    reader.current = controller
    setValue({ source, state: controller.state })
    const unsubscribe = controller.subscribe((state) => setValue({ source, state }))
    void controller.refresh()
    const timer = setInterval(() => void controller.refresh(), 5000)
    return () => {
      clearInterval(timer)
      unsubscribe()
      controller.dispose()
      if (reader.current === controller) {
        reader.current = null
      }
    }
  }, [source])
  const refresh = useCallback(() => {
    void reader.current?.refresh()
  }, [])
  return { state: value.source === source ? value.state : emptyCloudJobBoard(!!source), refresh }
}
