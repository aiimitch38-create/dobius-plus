import { getResponsiveLayoutMetrics } from '../layout/responsive-layout-metrics'

export type DesktopScreenLayout = {
  isLandscape: boolean
  fullScreen: boolean
  showHeader: boolean
  showControls: boolean
}

export function getDesktopScreenLayout(width: number, height: number): DesktopScreenLayout {
  const isLandscape = getResponsiveLayoutMetrics(width, height).isLandscape
  return {
    isLandscape,
    fullScreen: isLandscape,
    showHeader: !isLandscape,
    showControls: !isLandscape
  }
}
