// Starter shapes in the Diagrams panel: small ready-made diagrams drawn
// instantly (no agent), in the same node/edge model the agent streams.
import { translate } from '@/i18n/i18n'
import type { DiagramEdge, DiagramNode, ParsedDiagram } from './diagram-model'

export type DiagramStarterId = 'flow' | 'steps' | 'decision' | 'mind-map'
export const DIAGRAM_STARTERS: readonly DiagramStarterId[] = [
  'flow',
  'steps',
  'decision',
  'mind-map'
]

export function diagramStarterLabel(id: DiagramStarterId): string {
  switch (id) {
    case 'flow':
      return translate('board.diagram.starter.flow', 'Flow')
    case 'steps':
      return translate('board.diagram.starter.steps', 'Steps')
    case 'decision':
      return translate('board.diagram.starter.decision', 'Decision branch')
    case 'mind-map':
      return translate('board.diagram.starter.mindMap', 'Mind map')
  }
}

function build(nodes: DiagramNode[], edges: DiagramEdge[]): ParsedDiagram {
  const layers: string[] = []
  for (const node of nodes) {
    if (!layers.includes(node.layer)) {
      layers.push(node.layer)
    }
  }
  return { nodes, edges, layers, done: true }
}

export function diagramStarter(id: DiagramStarterId): ParsedDiagram {
  const t = (key: string, fallback: string): string =>
    translate(`board.diagram.node.${key}`, fallback)
  switch (id) {
    case 'flow':
      return build(
        [
          { id: 'start', label: t('start', 'Start'), layer: '1', shape: 'ellipse' },
          { id: 'process', label: t('process', 'Process'), layer: '2', shape: 'rect' },
          { id: 'end', label: t('end', 'End'), layer: '3', shape: 'ellipse' }
        ],
        [
          { from: 'start', to: 'process' },
          { from: 'process', to: 'end' }
        ]
      )
    case 'steps':
      return build(
        [1, 2, 3, 4].map((n) => ({
          id: `s${n}`,
          label: translate('board.diagram.node.step', 'Step {{n}}', { n }),
          layer: String(n),
          shape: 'rect' as const
        })),
        [1, 2, 3].map((n) => ({ from: `s${n}`, to: `s${n + 1}` }))
      )
    case 'decision':
      return build(
        [
          { id: 'start', label: t('start', 'Start'), layer: '1', shape: 'ellipse' },
          { id: 'q', label: t('question', 'Question?'), layer: '2', shape: 'diamond' },
          { id: 'yes', label: t('yes', 'Yes path'), layer: '3', shape: 'rect' },
          { id: 'no', label: t('no', 'No path'), layer: '3', shape: 'rect' }
        ],
        [
          { from: 'start', to: 'q' },
          { from: 'q', to: 'yes', label: t('yesEdge', 'yes') },
          { from: 'q', to: 'no', label: t('noEdge', 'no') }
        ]
      )
    case 'mind-map':
      return build(
        [
          { id: 'center', label: t('idea', 'Central idea'), layer: '1', shape: 'ellipse' },
          ...[1, 2, 3, 4].map((n) => ({
            id: `b${n}`,
            label: translate('board.diagram.node.branch', 'Branch {{n}}', { n }),
            layer: '2',
            shape: 'rect' as const
          }))
        ],
        [1, 2, 3, 4].map((n) => ({ from: 'center', to: `b${n}` }))
      )
  }
}
