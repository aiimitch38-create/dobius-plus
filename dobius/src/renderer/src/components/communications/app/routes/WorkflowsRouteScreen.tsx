import { useAppNavigation } from "@comms/app/navigation/useAppNavigation";
import { useChannelsQuery } from "@comms/features/channels/hooks";
import { WorkflowsScreen } from "@comms/features/workflows/ui/WorkflowsScreen";

type WorkflowsRouteScreenProps = {
  selectedWorkflowId: string | null;
};

export function WorkflowsRouteScreen({
  selectedWorkflowId,
}: WorkflowsRouteScreenProps) {
  const { closeWorkflowDetail, goWorkflow } = useAppNavigation();
  const channelsQuery = useChannelsQuery();
  const channels = channelsQuery.data ?? [];
  const memberChannels = channels.filter((channel) => channel.isMember);

  return (
    <WorkflowsScreen
      channels={memberChannels}
      onCloseWorkflow={closeWorkflowDetail}
      onSelectWorkflow={(workflowId) => {
        void goWorkflow(workflowId);
      }}
      selectedWorkflowId={selectedWorkflowId}
    />
  );
}
