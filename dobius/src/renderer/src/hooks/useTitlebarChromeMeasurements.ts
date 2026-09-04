import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

export type UseTitlebarChromeMeasurementsParams = {
  isFullScreen: boolean
  showTitlebarAppName: boolean | undefined
  showSidebar: boolean
  leftTitlebarChromeIsFloating: boolean
  sidebarOpen: boolean
  workspaceChromeActive: boolean
  rightSidebarOpen: boolean
}

export type UseTitlebarChromeMeasurementsResult = {
  titlebarLeftControlsRef: RefObject<HTMLDivElement | null>
  titlebarRightClusterRef: RefObject<HTMLDivElement | null>
  collapsedSidebarHeaderWidth: number
  titlebarRightClusterWidth: number
}

export function useTitlebarChromeMeasurements({
  isFullScreen,
  showTitlebarAppName,
  showSidebar,
  leftTitlebarChromeIsFloating,
  sidebarOpen,
  workspaceChromeActive,
  rightSidebarOpen
}: UseTitlebarChromeMeasurementsParams): UseTitlebarChromeMeasurementsResult {
  const titlebarLeftControlsRef = useRef<HTMLDivElement | null>(null)
  const titlebarRightClusterRef = useRef<HTMLDivElement | null>(null)
  const [collapsedSidebarHeaderWidth, setCollapsedSidebarHeaderWidth] = useState(0)
  const [titlebarRightClusterWidth, setTitlebarRightClusterWidth] = useState(0)

  useLayoutEffect(() => {
    const controls = titlebarLeftControlsRef.current
    if (!controls) {
      return
    }

    const updateWidth = (): void => {
      setCollapsedSidebarHeaderWidth(controls.getBoundingClientRect().width)
    }

    updateWidth()
    const observer = new ResizeObserver(() => {
      updateWidth()
    })
    observer.observe(controls)
    return () => observer.disconnect()
  }, [isFullScreen, showTitlebarAppName, showSidebar, leftTitlebarChromeIsFloating, sidebarOpen])

  // Why: the floating top-right cluster (TV, Quick Commands, notifications,
  // sidebar toggle) overlays the rightmost pane's tab strip in a separate DOM
  // branch. Measuring its real width — rather than hardcoding a per-button sum
  // that silently under-reserves whenever a button is added — lets the tab strip
  // reserve exactly enough space so long tab titles never slide under it.
  useLayoutEffect(() => {
    const cluster = titlebarRightClusterRef.current
    if (!cluster) {
      setTitlebarRightClusterWidth(0)
      return
    }

    const updateWidth = (): void => {
      setTitlebarRightClusterWidth(cluster.getBoundingClientRect().width)
    }

    updateWidth()
    const observer = new ResizeObserver(() => {
      updateWidth()
    })
    observer.observe(cluster)
    return () => observer.disconnect()
  }, [workspaceChromeActive, rightSidebarOpen])

  return {
    titlebarLeftControlsRef,
    titlebarRightClusterRef,
    collapsedSidebarHeaderWidth,
    titlebarRightClusterWidth
  }
}
