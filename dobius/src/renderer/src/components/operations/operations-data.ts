import type { LucideIcon } from 'lucide-react'
import {
  Bell,
  Bot,
  Boxes,
  Cloud,
  Code2,
  Eye,
  Github,
  Hash,
  Mail,
  MessageSquare,
  Phone,
  Terminal,
  UserRound,
  Wrench
} from 'lucide-react'

export type FeedItem = {
  icon: LucideIcon
  title: string
  detail: string
  meta: string
  tone: string
  badge?: string
}
export type AgentItem = {
  icon: LucideIcon
  name: string
  role: string
  model: string
  usage: string
  memory: string
  tasks: string
  tone: string
}

export const conversations: FeedItem[] = [
  {
    icon: Hash,
    title: '# Full Team',
    detail: 'Friday: Hey Carson. Nothing open on my side…',
    meta: '8:33 PM',
    tone: 'neutral',
    badge: '3'
  },
  {
    icon: UserRound,
    title: 'Adam',
    detail: "Right here. Nothing's changed on my end…",
    meta: '8:32 PM',
    tone: 'blue'
  },
  {
    icon: UserRound,
    title: 'Watson',
    detail: 'Can you have the team review the SMID…',
    meta: '8:24 PM',
    tone: 'blue',
    badge: '1'
  },
  {
    icon: Bot,
    title: 'Gunner',
    detail: 'Heartbeat, nothing to action. Could not verif…',
    meta: '8:20 PM',
    tone: 'green'
  },
  {
    icon: Bell,
    title: 'Edith',
    detail: 'No newer Adam message appears after that…',
    meta: '8:15 PM',
    tone: 'violet'
  },
  { icon: Hash, title: '# Features', detail: 'Merged PR #107 ✓', meta: '7:48 PM', tone: 'neutral' },
  {
    icon: Hash,
    title: '# general',
    detail: 'Carson: Pushing updates now.',
    meta: '6:32 PM',
    tone: 'neutral'
  },
  {
    icon: Phone,
    title: 'Hermes (Phone)',
    detail: 'Call completed (2m 14s)',
    meta: '5:21 PM',
    tone: 'green'
  },
  {
    icon: Mail,
    title: 'Client – Acme Inc.',
    detail: 'Received new assets (3 files)',
    meta: '4:11 PM',
    tone: 'amber'
  },
  {
    icon: Hash,
    title: '# Home base Dobius',
    detail: 'Friday: TLDR: landscape splits into three…',
    meta: '3:02 PM',
    tone: 'neutral'
  },
  {
    icon: Boxes,
    title: 'Notion Bot',
    detail: 'Database updated: Tasks',
    meta: '1:14 PM',
    tone: 'neutral'
  }
]

export const agents: AgentItem[] = [
  {
    icon: UserRound,
    name: 'Adam',
    role: 'Lead Developer',
    model: 'claude-opus-4-8',
    usage: '12%',
    memory: '2.4 GB',
    tasks: '3 tasks',
    tone: 'neutral'
  },
  {
    icon: MessageSquare,
    name: 'Voice Conductor',
    role: 'Voice & Transcription',
    model: 'gpt-4o-realtime',
    usage: '4%',
    memory: '512 MB',
    tasks: 'Idle',
    tone: 'blue'
  },
  {
    icon: Bot,
    name: 'Gunner',
    role: 'Head of SMIDs',
    model: 'gpt-5.4',
    usage: '18%',
    memory: '1.1 GB',
    tasks: '2 tasks',
    tone: 'green'
  },
  {
    icon: Eye,
    name: 'Friday',
    role: 'Research & Analysis',
    model: 'claude-opus-4-8',
    usage: '22%',
    memory: '1.8 GB',
    tasks: '1 task',
    tone: 'cyan'
  },
  {
    icon: Wrench,
    name: 'Edith',
    role: 'QA & Review',
    model: 'gpt-5.4',
    usage: '9%',
    memory: '920 MB',
    tasks: 'Idle',
    tone: 'amber'
  },
  {
    icon: Wrench,
    name: 'Watson',
    role: 'Personal Assistant',
    model: 'vertex-tools',
    usage: '11%',
    memory: '1.2 GB',
    tasks: '3 tasks',
    tone: 'blue'
  }
]

export const alerts: FeedItem[] = [
  {
    icon: Boxes,
    title: 'Agent: Adam',
    detail: 'Task started: Review SMID compliance',
    meta: '9:27 PM',
    tone: 'blue'
  },
  {
    icon: Terminal,
    title: 'Terminal: main · Claude',
    detail: 'Running: npm run dev',
    meta: '9:26 PM',
    tone: 'neutral'
  },
  {
    icon: Cloud,
    title: 'System: VPS (Dallas)',
    detail: 'Sync completed (1.2 GB)',
    meta: '9:25 PM',
    tone: 'blue'
  },
  {
    icon: Bot,
    title: 'Agent: Watson',
    detail: 'Connected to Gmail API',
    meta: '9:24 PM',
    tone: 'green'
  },
  {
    icon: Github,
    title: 'GitHub',
    detail: 'PR #107 merged (feat/vertex-task-backend)',
    meta: '9:23 PM',
    tone: 'neutral'
  },
  {
    icon: Bot,
    title: 'Agent: Gunner',
    detail: 'Heartbeat received',
    meta: '9:22 PM',
    tone: 'green'
  },
  {
    icon: Terminal,
    title: 'Terminal: main · Claude',
    detail: 'Build completed in 12.4s',
    meta: '9:21 PM',
    tone: 'neutral'
  },
  {
    icon: Code2,
    title: 'System: Local',
    detail: 'Disk usage at 62%',
    meta: '9:20 PM',
    tone: 'neutral'
  },
  {
    icon: Eye,
    title: 'Agent: Friday',
    detail: 'Research task completed',
    meta: '9:18 PM',
    tone: 'cyan'
  },
  {
    icon: Boxes,
    title: 'Notion',
    detail: 'Database updated: Tasks',
    meta: '9:17 PM',
    tone: 'neutral'
  },
  {
    icon: Code2,
    title: 'API: Create',
    detail: 'POST /communications/channel',
    meta: '9:16 PM',
    tone: 'violet'
  },
  {
    icon: Cloud,
    title: 'Agent: Edith',
    detail: 'Idle – no new tasks',
    meta: '9:16 PM',
    tone: 'blue'
  }
]
