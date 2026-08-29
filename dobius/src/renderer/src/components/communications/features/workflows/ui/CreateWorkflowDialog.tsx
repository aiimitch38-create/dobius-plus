import type { Channel } from "@comms/shared/api/types";
import { WorkflowDialog } from "./WorkflowDialog";

type CreateWorkflowDialogProps = {
  channels: Channel[];
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export function CreateWorkflowDialog({
  channels,
  onOpenChange,
  open,
}: CreateWorkflowDialogProps) {
  return (
    <WorkflowDialog
      channels={channels}
      mode="create"
      onOpenChange={onOpenChange}
      open={open}
    />
  );
}
