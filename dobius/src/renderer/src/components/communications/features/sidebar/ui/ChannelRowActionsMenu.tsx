import { EllipsisVertical, LogOut, Trash2 } from "lucide-react";
import { useState } from "react";

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

// Hover-revealed "more actions" button (Delete/Leave channel) on a single
// row — the existing right-click menu has both actions but isn't
// discoverable without knowing to right-click. See TASK COMMS.4.
export function ChannelRowActionsMenu({
  channel,
  onDeleteChannel,
  onLeaveChannel,
}: {
  channel: Channel;
  onDeleteChannel?: (channel: Channel) => void;
  onLeaveChannel?: (channel: Channel) => void;
}) {
  // Only fetch membership once the menu is actually opened — this component
  // renders as a permanent sibling in every visible channel row, so an
  // unconditional query here would fire one members-list fetch per channel
  // on every sidebar mount instead of 0-1 (see Task COMMS.4 review).
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const canLoadOwnerActions =
    channel.channelType !== "dm" && Boolean(onDeleteChannel) && isMenuOpen;
  const membersQuery = useChannelMembersQuery(channel.id, canLoadOwnerActions);
  const currentPubkey = useIdentityQuery().data?.pubkey;
  const { canDeleteChannel } = useChannelModerationCapabilities(
    membersQuery.data,
    currentPubkey,
    canLoadOwnerActions,
  );

  if (!onDeleteChannel && !onLeaveChannel) {
    return null;
  }

  return (
    <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
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
