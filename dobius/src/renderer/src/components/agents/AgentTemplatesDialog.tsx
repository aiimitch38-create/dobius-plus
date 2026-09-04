import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type { AgentTemplate } from '../../../../shared/agent-templates'
import { AGENT_TEMPLATES } from '../../../../shared/agent-templates'
import { AgentAvatar } from './AgentAvatar'

export function AgentTemplatesDialog({
  open,
  onOpenChange,
  onSelectTemplate
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectTemplate: (template: AgentTemplate) => void
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-3rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Templates</DialogTitle>
          <DialogDescription>
            Ready-made agents. Pick one to pre-fill a new crew member — you can edit everything
            before saving, same as building from scratch.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {AGENT_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              className="flex w-full items-start gap-3 rounded-md border border-border p-3 text-left hover:bg-accent"
              onClick={() => onSelectTemplate(template)}
            >
              <AgentAvatar icon={template.icon} color={template.color} className="size-8" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{template.name}</div>
                <div className="text-xs leading-5 text-muted-foreground">
                  {template.description}
                </div>
              </div>
              <Button type="button" size="xs" variant="outline" tabIndex={-1}>
                Use
              </Button>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
