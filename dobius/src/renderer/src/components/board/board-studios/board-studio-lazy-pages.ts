// Heavy existing pages mounted inside Board studios. Declared here (not via
// app-lazy-pages) so the Board chunk does not import the module that lazily
// imports the Board itself.
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'

export const SkillsPage = lazy(() => import('@/components/skills/SkillsPage'))
export const Settings = lazy(() => import('@/components/settings/Settings'))
export const AutomationsPage = lazy(() => import('@/components/automations/AutomationsPage'))
export const NativeChatView = lazy(() => import('@/components/native-chat/NativeChatView'))
export const FileExplorer = lazy(() => import('@/components/right-sidebar/FileExplorer'))
export const EditorPanel = lazy(() => import('@/components/editor/EditorPanel'))
export const AgentsPage = lazy(() => import('@/components/agents/AgentsPage'))
// Same restored Communications client the Classic sidebar mounts as BuzzPage.
export const BuzzPage = lazy(() => import('@/components/communications/CommunicationsPage'))
// Same Vertex Kanban the Classic Tasks page lazily mounts (TaskPage.tsx VertexBoard).
export const KanbanPage = lazy(() => import('@/components/kanban/KanbanBoard'))
