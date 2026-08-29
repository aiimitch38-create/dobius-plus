import * as React from "react";

import type { Channel } from "@comms/shared/api/types";
import { ViewLoadingFallback } from "@comms/shared/ui/ViewLoadingFallback";

const WorkflowsView = React.lazy(async () => {
  const module = await import("@comms/features/workflows/ui/WorkflowsView");
  return { default: module.WorkflowsView };
});

type WorkflowsScreenProps = {
  channels: Channel[];
  onCloseWorkflow: () => void;
  onSelectWorkflow: (workflowId: string) => void;
  selectedWorkflowId: string | null;
};

export function WorkflowsScreen({
  channels,
  onCloseWorkflow,
  onSelectWorkflow,
  selectedWorkflowId,
}: WorkflowsScreenProps) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <React.Suspense fallback={<ViewLoadingFallback kind="workflows" />}>
        <WorkflowsView
          channels={channels}
          onCloseWorkflow={onCloseWorkflow}
          onSelectWorkflow={onSelectWorkflow}
          selectedWorkflowId={selectedWorkflowId}
        />
      </React.Suspense>
    </div>
  );
}
