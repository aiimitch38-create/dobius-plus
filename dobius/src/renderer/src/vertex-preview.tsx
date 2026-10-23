import './assets/main.css'
import { createRoot } from 'react-dom/client'
import { StudioShell } from './components/command-center/StudioShell'
import { TooltipProvider } from './components/ui/tooltip'

// Dev-only entry renders the same components without pretending Electron services exist.
createRoot(document.getElementById('root')!).render(
  <TooltipProvider>
    <div style={{ height: '100dvh' }}>
      <StudioShell resources={[]} onResource={() => {}} onAction={() => {}} preview />
    </div>
  </TooltipProvider>
)
