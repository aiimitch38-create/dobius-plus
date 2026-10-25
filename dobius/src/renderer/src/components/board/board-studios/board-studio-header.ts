// Header icon + one-line subtitle per studio (the title stays in BoardStudioHost).
// Partial on purpose: a studio without an entry gets the generic icon, no subtitle.
import {
  Bot,
  CalendarClock,
  Code2,
  FileText,
  GitBranch,
  History,
  Layers,
  ListChecks,
  ListTodo,
  Map as MapIcon,
  MessageSquare,
  MessageSquareText,
  NotebookPen,
  PanelsTopLeft,
  Plug,
  Repeat,
  Settings,
  Smartphone,
  Sparkles,
  SquareKanban,
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
  presets: Layers,
  'source-control': GitBranch,
  checks: ListChecks,
  ports: Plug,
  prompts: MessageSquareText,
  vault: History,
  'asana-tasks': ListTodo,
  automations: CalendarClock,
  'tasks-page': SquareKanban,
  mobile: Smartphone
}

export function boardStudioIcon(studio: BoardStudioId): LucideIcon {
  return ICONS[studio] ?? PanelsTopLeft
}

export function boardStudioSubtitle(studio: BoardStudioId): string | null {
  switch (studio) {
    case 'mission-map':
      return translate(
        'board.studio.subtitle.missionMapInspect',
        'Who directs whom on this board. Click a node to inspect it, double-click to jump to it.'
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
    case 'source-control':
      return translate(
        'board.studio.subtitle.sourceControl',
        'Changes, commits, branches and pull requests for this workspace.'
      )
    case 'checks':
      return translate(
        'board.studio.subtitle.checks',
        'CI checks and review comments on the pull request for this branch.'
      )
    case 'ports':
      return translate(
        'board.studio.subtitle.ports',
        'Ports your dev servers listen on, with forwarding for remote workspaces.'
      )
    case 'prompts':
      return translate('board.studio.subtitle.prompts', 'Saved prompts, ready to send to a console.')
    case 'vault':
      return translate(
        'board.studio.subtitle.vault',
        'Past agent sessions for this workspace, searchable and resumable.'
      )
    case 'asana-tasks':
      return translate('board.studio.subtitle.asanaTasks', 'Asana tasks synced into Dobius.')
    case 'automations':
      return translate(
        'board.studio.subtitle.automations',
        'Scheduled repo automations: cron-style runs and their history.'
      )
    case 'tasks-page':
      return translate(
        'board.studio.subtitle.tasksPage',
        'Issues and pull requests from GitHub, GitLab, Linear and Jira.'
      )
    case 'mobile':
      return translate(
        'board.studio.subtitle.mobile',
        'Pair your phone with Dobius and follow your consoles from anywhere.'
      )
    default:
      return null
  }
}
