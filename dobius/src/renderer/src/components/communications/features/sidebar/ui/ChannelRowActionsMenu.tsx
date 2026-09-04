import { EllipsisVertical, LogOut, Trash2 } from "lucide-react";

import { useChannelMembersQuery } from "@comms/features/channels/hooks";
import { useChannelModerationCapabilities } from "@comms/features/channels/ui/ChannelManagementModerationActions";
import { deferMenuAction } from "@comms/features/sidebar/ui/sidebarMenuHelpers";
import { useIdentityQuery } from "@comms/shared/api/hooks";
import type { Channel } from "@comms/shared/api/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@comms/shared/ui/dropdown-menu";
import { SidebarMenuAction } from "@comms/shared/ui/sidebar";

/**
 * A hover-revealed "more actions" button on a single channel row — Delete
 * channel / Leave channel. The right-click context menu
 * (`ChannelContextMenuItems`) already has both actions, but nothing on the
 * row itself is discoverable without already knowing to right-click; the
 * only other menu nearby is `SectionActionsMenu` in `CustomChannelSection.tsx`,
 * which is section-level and has no per-channel actions. See TASK COMMS.4.
 * Reuses the same moderation-capability gating as the context menu so a
 * non-owner never sees Delete, and calls the same already-wired
 * `onDeleteChannel`/`onLeaveChannel` handlers — no new backend wiring.
 */
export function ChannelRowActionsMenu({
  channel,
  onDeleteChannel,
  onLeaveChannel,
}: {
  channel: Channel;
  onDeleteChannel?: (channel: Channel) => void;
  onLeaveChannel?: (channel: Channel) => void;
}) {
  const canLoadOwnerActions =
    channel.channelType !== "dm" && Boolean(onDeleteChannel);
  const membersQuery = useChannelMembersQuery(channel.id, canLoadOwnerActions);
  const currentPubkey = useIdentityQuery().data?.pubkey;
  const { canDeleteChannel } = useChannelModerationCapabilities(
    membersQuery.data,
    currentPubkey,
    canLoadOwnerActions,
  );

  if (!canDeleteChannel && !onLeaveChannel) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuAction
          aria-label={`More actions for ${channel.name}`}
          data-testid={`channel-row-actions-${channel.name}`}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          showOnHover
        >
          <EllipsisVertical />
        </SidebarMenuAction>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onLeaveChannel ? (
          <DropdownMenuItem
            onSelect={() => deferMenuAction(() => onLeaveChannel(channel))}
          >
            <LogOut className="h-4 w-4" />
            <span>Leave channel</span>
          </DropdownMenuItem>
        ) : null}
        {canDeleteChannel ? (
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            data-testid={`delete-channel-row-${channel.name}`}
            onSelect={() => deferMenuAction(() => onDeleteChannel?.(channel))}
          >
            <Trash2 className="h-4 w-4" />
            <span>Delete channel</span>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
