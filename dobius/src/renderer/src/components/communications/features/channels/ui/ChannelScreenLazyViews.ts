import * as React from "react";

export const ChannelPane = React.lazy(async () => {
  const module = await import("@comms/features/channels/ui/ChannelPane");
  return { default: module.ChannelPane };
});

export const ForumView = React.lazy(async () => {
  const module = await import("@comms/features/forum/ui/ForumView");
  return { default: module.ForumView };
});

export const UserProfilePanel = React.lazy(async () => {
  const module = await import("@comms/features/profile/ui/UserProfilePanel");
  return { default: module.UserProfilePanel };
});
