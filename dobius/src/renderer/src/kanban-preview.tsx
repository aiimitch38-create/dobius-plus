import './assets/main.css'

import ReactDOM from 'react-dom/client'
import { Toaster } from '@/components/ui/sonner'
import KanbanBoard from './components/kanban/KanbanBoard'

// Why the Toaster here: the board confirms assignment and creation with
// toasts. App.tsx mounts one for the real app; this preview needs its own or
// those confirmations silently do nothing outside Electron.
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <>
    <KanbanBoard />
    <Toaster closeButton toastOptions={{ className: 'font-sans text-sm' }} />
  </>
)
