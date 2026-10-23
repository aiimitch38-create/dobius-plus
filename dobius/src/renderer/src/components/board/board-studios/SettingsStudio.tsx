import React from 'react'
import { Settings } from './board-studio-lazy-pages'
import { useStudioCloseOverride } from './use-studio-close-override'

export function SettingsStudio({ onClose }: { onClose: () => void }): React.JSX.Element {
  useStudioCloseOverride('closeSettingsPage', onClose)
  return <Settings />
}
