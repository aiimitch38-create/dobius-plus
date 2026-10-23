// Header icon + one-line subtitle per studio (the title stays in BoardStudioHost).
// Partial on purpose: a studio without an entry gets the generic icon, no subtitle.
import {
  Bot,
  Code2,
  FileText,
  Layers,
  Map as MapIcon,
  MessageSquare,
  NotebookPen,
  PanelsTopLeft,
  Repeat,
  Settings,
  Sparkles,
  Brain,
  type LucideIcon
} from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { BoardStudioId } from './board-studio-ids'

const ICONS: Partial<Record<BoardStudioId, LucideIcon>> = {
  'mission-map': MapIcon,
  docs: FileText,
  'generate-doc': Sparkles,
  markdown: NotebookPen,
  code: Code2,
  skills: Sparkles,
  settings: Settings,
  memory: Brain,
  chat: MessageSquare,
  loops: Repeat,
  agents: Bot,
  presets: Layers
}

export function boardStudioIcon(studio: BoardStudioId): LucideIcon {
  return ICONS[studio] ?? PanelsTopLeft
}

export function boardStudioSubtitle(studio: BoardStudioId): string | null {
  switch (studio) {
    case 'mission-map':
      return translate(
        'board.studio.subtitle.missionMap',
        'Who directs whom on this board. Click a node to jump to it.'
      )
    case 'docs':
      return translate(
        'board.studio.subtitle.docs',
        'Read the repo’s documents, or have an agent write a new one.'
      )
    case 'generate-doc':
      return translate(
        'board.studio.subtitle.generateDoc',
        'Pick what to write and which agent writes it. It lands in the repo as markdown.'
      )
    case 'markdown':
      return translate(
        'board.studio.subtitle.markdown',
        'Edit the repo’s markdown and see how the docs link together.'
      )
    case 'code':
      return translate(
        'board.studio.subtitle.code',
        'Browse and edit files, then pin one to the board.'
      )
    case 'presets':
      return translate(
        'board.presets.subtitle',
        'Whole arrangements of crews, task boards and previews, wired up for you. Choose one, pick its agents, deploy.'
      )
    case 'loops':
      return translate(
        'board.studio.subtitle.loops',
        'Recurring instructions for your consoles: on idle, on matching output, or until a goal is met.'
      )
    case 'memory':
      return translate(
        'board.studio.subtitle.memory',
        'Durable facts per repo. They reach an agent only when a memory card pushes them.'
      )
    case 'skills':
      return translate(
        'board.studio.subtitle.skills',
        'Installed skills from home, repo, bundled and plugin folders.'
      )
    case 'settings':
      return translate(
        'board.studio.subtitle.settings',
        'Dobius settings, without leaving the board.'
      )
    default:
      return null
  }
}
