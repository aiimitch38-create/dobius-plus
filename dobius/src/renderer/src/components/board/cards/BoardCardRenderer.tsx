import React, { useCallback } from 'react'
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
  Type
} from 'lucide-react'
import { useAppStore } from '@/store'
import { useConfirmationDialog } from '@/components/confirmation-dialog'
import { closeTerminalTab } from '@/components/terminal/terminal-tab-actions'
import { consoleActions } from '../console-card/console-actions'
import {
  getBoard,
  type BoardCard,
  type BoardCardKind,
  type BoardCardPatch,
  type NewBoardCard
} from '@/store/slices/board'
import { BoardCardFrame, type BoardCardAction } from './BoardCardFrame'
import { useBoardLinkMode } from '../board-links/board-link-mode'
import { useCardStyleEditor } from '../board-tool-panels/card-style-editor'
import { nextLineDirection } from './shape-geometry'
import type { MinSize, Rect } from './card-geometry'
import { CalendarCard } from './CalendarCard'
import { ChecklistCard } from './ChecklistCard'
import { ImageCard } from './ImageCard'
import { KanbanCard } from './KanbanCard'
import { MarkdownDocCard } from './MarkdownDocCard'
import { NoteCard } from './NoteCard'
import { OrchestratorCard } from './OrchestratorCard'
import { BranchesCard } from './BranchesCard'
import { MemoryCard } from './MemoryCard'
import { SkillCard } from './SkillCard'
import { ShapeCard } from './ShapeCard'
import { StrokeCard } from './StrokeCard'
import { TextCard } from './TextCard'
import { WebTileCard } from './WebTileCard'
import { ConsoleCardBody, ConsoleCardTitleAccessory } from '../console-card/ConsoleCard'
import { translate } from '@/i18n/i18n'

export type BoardCardRendererProps = {
  worktreeId: string
  card: BoardCard
  zoom: number
  selected: boolean
  /** Selection lives in BoardPage; additive = shift/cmd-click. */
  onSelect: (cardId: string, additive: boolean) => void
  /** World-space drag delta; BoardPage moves the whole selection. */
  onDragBy: (cardId: string, dx: number, dy: number) => void
  onDragEnd?: (cardId: string) => void
}

const KIND_ICON: Record<BoardCardKind, React.ReactNode> = {
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
  skill: <Sparkles />,
  branches: <GitBranch />
}

const BARE_KINDS: ReadonlySet<BoardCardKind> = new Set(['text', 'shape', 'stroke', 'image'])
const BARE_MIN: MinSize = { w: 24, h: 24 }
const DUPLICATE_OFFSET = 24

export const BoardCardRenderer = React.memo(function BoardCardRenderer({
  worktreeId,
  card,
  zoom,
  selected,
  onSelect,
  onDragBy,
  onDragEnd
}: BoardCardRendererProps): React.JSX.Element {
  const id = card.id
  const onChange = useCallback(
    (patch: BoardCardPatch) => useAppStore.getState().updateCard(worktreeId, id, patch),
    [worktreeId, id]
  )
  const bare = BARE_KINDS.has(card.kind)
  const confirm = useConfirmationDialog()

  const actions: BoardCardAction[] = [
    {
      label: translate('board.card.bringToFront', 'Bring to front'),
      onSelect: () => useAppStore.getState().bringToFront(worktreeId, [id])
    },
    {
      label: translate('board.card.sendToBack', 'Send to back'),
      // Why: lift everything else (order kept) so z stays above group frames at 0.
      onSelect: () => {
        const state = useAppStore.getState()
        const others = getBoard(state, worktreeId).cards.filter((c) => c.id !== id)
        state.bringToFront(
          worktreeId,
          others.map((c) => c.id)
        )
      }
    },
    ...(card.kind === 'shape' && (card.shape === 'line' || card.shape === 'arrow')
      ? [
          {
            label: translate('board.card.turnDirection', 'Turn direction'),
            onSelect: () => onChange({ direction: nextLineDirection(card.direction) })
          }
        ]
      : []),
    ...(card.kind === 'shape' || card.kind === 'stroke' || card.kind === 'text'
      ? [
          {
            label: translate('board.style.edit', 'Edit style…'),
            onSelect: () => useCardStyleEditor.getState().open({ worktreeId, cardId: id })
          }
        ]
      : []),
    {
      label: translate('board.links.drawArrow', 'Draw arrow to…'),
      onSelect: () =>
        useBoardLinkMode.getState().start({ kind: 'arrow', worktreeId, fromCardId: id })
    },
    // Why: a console card points at one live terminal tab; a copy would share it.
    ...(card.kind === 'console'
      ? []
      : [
          {
            label: translate('board.card.duplicate', 'Duplicate'),
            onSelect: () => {
              const { id: _id, z: _z, ...rest } = card
              useAppStore.getState().addCard(worktreeId, {
                ...rest,
                x: card.x + DUPLICATE_OFFSET,
                y: card.y + DUPLICATE_OFFSET
              } as NewBoardCard)
            }
          }
        ]),
    ...(card.kind === 'console' ? consoleActions(worktreeId, card, confirm) : []),
    {
      label:
        card.kind === 'console'
          ? translate('board.console.close', 'Close this agent')
          : translate('board.card.delete', 'Delete'),
      destructive: true,
      onSelect: () => {
        if (card.kind !== 'console') {
          useAppStore.getState().removeCards(worktreeId, [id])
          return
        }
        void confirm({
          title: translate('board.console.closeTitle', 'Close {{name}}?', { name: card.title }),
          description: translate(
            'board.console.closeBody',
            'This ends the agent and closes its terminal.'
          ),
          confirmLabel: translate('board.console.closeConfirm', 'Close agent'),
          confirmVariant: 'destructive'
        }).then((ok) => {
          if (ok) {
            closeTerminalTab(card.tabId)
            useAppStore.getState().removeCards(worktreeId, [id])
          }
        })
      }
    }
  ]

  return (
    <BoardCardFrame
      rect={card}
      z={card.z}
      zoom={zoom}
      onRename={(name) => useAppStore.getState().updateCard(worktreeId, id, { title: name })}
      // Why: file cards fall back to the file name when no title was given.
      title={
        card.title ||
        (card.kind === 'markdown' ? (card.path.split(/[\\/]/).at(-1) ?? card.path) : '')
      }
      icon={KIND_ICON[card.kind]}
      selected={selected}
      titleAccessory={
        card.kind === 'console' ? (
          <ConsoleCardTitleAccessory worktreeId={worktreeId} card={card} />
        ) : undefined
      }
      bare={bare}
      minSize={bare ? BARE_MIN : undefined}
      actions={actions}
      onSelect={(additive) => {
        onSelect(id, additive)
        useAppStore.getState().bringToFront(worktreeId, [id])
      }}
      onDragBy={(dx, dy) => onDragBy(id, dx, dy)}
      onDragEnd={onDragEnd ? () => onDragEnd(id) : undefined}
      onResize={(rect: Rect) => useAppStore.getState().resizeCard(worktreeId, id, rect)}
    >
      {card.kind === 'console' ? (
        <ConsoleCardBody worktreeId={worktreeId} card={card} zoom={zoom} focused={selected} />
      ) : (
        renderBody(card, worktreeId, onChange)
      )}
    </BoardCardFrame>
  )
})

function renderBody(
  card: BoardCard,
  worktreeId: string,
  onChange: (patch: BoardCardPatch) => void
): React.ReactNode {
  switch (card.kind) {
    case 'console':
      return null
    case 'web':
      return <WebTileCard card={card} onChange={onChange} worktreeId={worktreeId} />
    case 'note':
      return <NoteCard card={card} onChange={onChange} worktreeId={worktreeId} />
    case 'text':
      return <TextCard card={card} onChange={onChange} />
    case 'checklist':
      return <ChecklistCard card={card} onChange={onChange} />
    case 'kanban':
      return <KanbanCard card={card} onChange={onChange} />
    case 'calendar':
      return <CalendarCard card={card} onChange={onChange} />
    case 'shape':
      return <ShapeCard card={card} />
    case 'stroke':
      return <StrokeCard card={card} />
    case 'image':
      return <ImageCard card={card} worktreeId={worktreeId} />
    case 'markdown':
      return <MarkdownDocCard card={card} worktreeId={worktreeId} />
    case 'orchestrator':
      return <OrchestratorCard worktreeId={worktreeId} card={card} onChange={onChange} />
    case 'memory':
      return <MemoryCard worktreeId={worktreeId} card={card} onChange={onChange} />
    case 'skill':
      return <SkillCard worktreeId={worktreeId} card={card} onChange={onChange} />
    case 'branches':
      return <BranchesCard worktreeId={worktreeId} />
  }
}
