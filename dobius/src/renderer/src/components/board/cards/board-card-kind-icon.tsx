import React from 'react'
import {
  Brain,
  GitBranch,
  Sparkles,
  Calendar,
  Cable,
  FileText,
  Globe,
  Image as ImageIcon,
  KanbanSquare,
  ListChecks,
  PenLine,
  Shapes,
  StickyNote,
  SquareTerminal,
  Target,
  Type
} from 'lucide-react'
import type { BoardCardKind } from '@/store/slices/board'

/** One glyph per card kind: the card title bar and its placement ghost share it. */
export const BOARD_CARD_KIND_ICON: Record<BoardCardKind, React.ReactNode> = {
  console: <SquareTerminal />,
  web: <Globe />,
  note: <StickyNote />,
  text: <Type />,
  checklist: <ListChecks />,
  kanban: <KanbanSquare />,
  calendar: <Calendar />,
  shape: <Shapes />,
  stroke: <PenLine />,
  image: <ImageIcon />,
  markdown: <FileText />,
  orchestrator: <Cable />,
  memory: <Brain />,
  goal: <Target />,
  skill: <Sparkles />,
  branches: <GitBranch />
}
