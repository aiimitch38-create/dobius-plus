import { useState } from 'react'
import { Button } from '../ui/button'
import { SearchableSetting } from './SearchableSetting'

export function MobileScreenSharingSection(): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const enable = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      await window.api.mobile.enableScreenSharing()
      setMessage(
        'Screen Recording setup opened. Allow Dobius+ Computer Use in macOS Privacy & Security. If viewing still reports missing permission, quit and reopen Dobius+ yourself.'
      )
    } catch {
      setMessage(
        'Screen sharing setup could not open. Build and install the desktop update, then try again.'
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <SearchableSetting
      title="Desktop screen viewing"
      description="Let your phone view your Mac’s main display."
      keywords={['screen', 'desktop', 'recording', 'phone']}
    >
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Your phone can see everything visible, including private messages and passwords. Screen
          Recording belongs to the Dobius+ Computer Use helper; Accessibility is not needed for
          viewing. Each session asks you to approve the named phone and shows a Stop button on the
          Mac.
        </p>
        <Button size="sm" disabled={busy} onClick={() => void enable()}>
          {busy ? 'Opening setup…' : 'Enable screen sharing'}
        </Button>
        {message ? (
          <p className="text-xs text-muted-foreground" role="status">
            {message}
          </p>
        ) : null}
      </div>
    </SearchableSetting>
  )
}
