# Port Spec: Buzz "Direct messages" list + single conversation thread

Source: `dobius/vendor/buzz-desktop` (vendored Buzz React/Vite/TanStack-Router
app). Every value below was read from the literal source listed in the File
Inventory section, with `file:line` citations. Nothing here is inferred from
the screenshot alone or from memory of similar chat UIs.

**Scope confirmation.** The "Direct messages" section in the left sidebar
(`data-testid="dm-list"`, title "Direct messages") in
`src/features/sidebar/ui/AppSidebar.tsx:803-846` is the actual Inbox/DM list
described in the task (this is distinct from the separate, much larger
"unified inbox" home-feed view at `src/features/home/ui/HomeView.tsx`, which
mixes channel replies, reactions, drafts and reminders — that is out of
scope per the task and was only skimmed enough to confirm it is a different
feature). Clicking a DM row navigates to a channel route that renders
`ChannelScreen` → `ChannelPane`, which is the single conversation thread view
in scope (message list = `MessageTimeline` → `TimelineMessageList` →
`MessageRow`; composer = `MessageComposer` → `MessageComposerToolbar`).

---

## Behavior

### Inbox / DM list (sidebar "Direct messages" section)

- **Empty**: `SidebarSection` returns `null` if `items.length === 0` and no
  `action`/`emptyState` is passed (`src/features/sidebar/ui/SidebarSection.tsx:391-393`).
  The DM section is always rendered with an `action` (the "New message" quick
  action + section menu), so in practice an empty DM list renders the header
  row with zero rows underneath — there is no dedicated "no DMs yet" empty
  state string found in the DM section itself (`emptyState` prop is not
  passed for `testId="dm-list"` in `AppSidebar.tsx:803-846`).
- **Loading**: `AppSidebar.tsx:619-621` renders `SidebarLoadingContent` while
  `isLoading`, replacing the whole channel/DM area with skeleton rows.
  `useSidebarLoadingShape` (`src/features/sidebar/ui/sidebarLoadingSkeleton.tsx:179-219`)
  produces 2 skeleton DM rows (`directMessages.slice(0, 2)`) with a
  circular avatar skeleton + a text skeleton, width randomized/cached per
  channel name length (`sidebarLoadingSkeleton.tsx:146-176`). Skeleton row
  markup: `sidebarLoadingSkeleton.tsx:221-241`.
- **Error**: the DM list itself has no dedicated per-row error state. Relay
  connectivity failures surface via `SidebarRelayConnectionCard`
  (`src/features/sidebar/ui/SidebarRelayConnectionCard.tsx`), title
  `"Can't reach the relay"` when disconnected (line 104), `"Connecting"` /
  `"Waiting to reconnect"` while reconnecting (lines 61-66), `"Connected"`
  when restored. Backed by `isRelayUnreachableError()` in
  `src/shared/lib/relayError.ts:14-30`, which matches errors whose message is
  prefixed `"relay unreachable:"` from the Rust backend; the constant
  `RELAY_UNREACHABLE_MESSAGE` = `"Can't reach the relay — check your VPN or
  network connection."` (`relayError.ts:19-20`). A separate generic
  `errorMessage` string can render below the sidebar list
  (`AppSidebar.tsx:850-854`) only when it is NOT a relay-unreachable error.
- **Populated**: rows render via `SidebarSection` → `ChannelMenuButton`
  (`src/features/sidebar/ui/SidebarSection.tsx:248-337`), one per DM channel.
- **Sending-in-progress**: not applicable to the list itself (composer-level,
  see below).
- **Agent-typing/thinking indicator on a list row**: none found — no per-row
  "agent is typing" affordance in the sidebar; typing indicators only render
  inside the open thread (see below). The sidebar row does render a working
  agent badge for regular channels (`ChannelWorkingBadge`,
  `SidebarSection.tsx:123-152`) but it's explicitly hidden for the DM unread
  badge slot and not part of DM row rendering logic beyond the generic
  `activeWorkingByChannelId` prop passthrough — not verified as DM-specific,
  flagging as ambiguous.
- **Permission/auth-required**: not applicable at the list level.

### Single conversation thread (`ChannelPane` + `MessageTimeline`)

- **Empty (no messages yet)**: for a DM channel, `MessageTimeline` shows the
  "direct message intro" block instead of the generic empty state
  (`src/features/messages/ui/MessageTimeline.tsx:403-420`, block markup at
  `580-605` virtualized / `763-781` non-virtualized): a stacked-avatar intro,
  the participant's display name as a heading, and body text
  `"This is the beginning of your direct message with <name>."`
  If a DM has no resolvable intro (e.g. no other participant), or for
  non-DM/forum channels, the generic empty state renders instead: title
  `"No messages yet"` / description `"Send the first message to start the
  thread."` for a channel, or `"No channel selected"` when nothing is active
  (`src/features/channels/ui/ChannelPane.tsx:659-665`); rendered in
  `MessageTimeline.tsx:793-805`.
- **Loading**: `TimelineSkeleton` renders while `isLoading` /
  `isTimelineLoading` is true (`MessageTimeline.tsx:760-762`,
  `isLoading` prop wired from `ChannelScreen`'s `messagesQuery`/`windowQuery`
  pending state — see `ChannelPane.tsx` prop `isTimelineLoading`).
- **Error**: no dedicated per-thread "could not load messages" banner was
  found inside `ChannelPane`/`MessageTimeline` — errors surface at the
  app/sidebar level via the relay-unreachable card described above, and (for
  the separate unified Home inbox, out of scope) via the "Home feed
  unavailable" / "Failed to fetch" card in
  `src/features/home/ui/HomeView.tsx:544-563` (title `"Home feed
  unavailable"`, body defaults to `"The relay did not return a feed
  response."` unless a specific `errorMessage` is supplied, "Try again"
  button calls `onRefresh`). This exact card is what Carson's screenshot
  showed — note it belongs to the out-of-scope unified inbox, not the DM
  thread view itself; flagging as ambiguous whether the native port needs an
  equivalent thread-level error card since Buzz doesn't appear to have one.
- **Populated**: `TimelineMessageList` renders grouped `MessageRow` items
  plus `DayDivider` separators.
- **Sending-in-progress**: composer disables its own submit while
  `isSending`/upload in flight (`MessageComposerToolbar.tsx:238`,
  `sendDisabled` computed at `MessageComposer.tsx:826-839`); the just-sent
  message renders with `message.pending === true`, showing `"Sending…"` in
  place of the timestamp metadata (`MessageRow.tsx:519-529`,
  `data-testid="message-send-status"`). Send button shows a spinning ring in
  place of the arrow icon while `isSending`
  (`MessageComposerToolbar.tsx:242-249`).
- **Agent-typing/thinking indicator**: `TypingIndicatorRow`
  (`src/features/messages/ui/TypingIndicatorRow.tsx`) renders stacked small
  avatars + a shimmering text label — `"<name> is typing..."` (1 person),
  `"<a> and <b> are typing..."` (2), `"<a>, <b>, and <c> are typing..."` (3),
  `"<a>, <b>, and N others are typing..."` (4+) (`formatTypingLabel`,
  lines 38-52). For a working agent specifically, a separate
  `BotActivityComposerAction` pill renders above/alongside it inside the
  composer's activity accessory row (`ChannelComposerActivityAccessory.tsx`),
  label `"<AgentName> is working"` / `"<AgentName>: <live headline>"`
  (`src/features/channels/ui/BotActivityBar.tsx:146-157`), rotating status
  headline every 2200ms (`HEADLINE_ROTATION_MS`, `BotActivityBar.tsx:31,127-137`),
  spinning `Loader2` icon, hover-to-open popover after 150ms
  (`HOVER_OPEN_DELAY_MS`) listing all working agents.
- **Permission/auth-required**: a "moderation DM" (1:1 DM with the relay's
  own identity) is read-only for the member — composer placeholder becomes
  `"This channel is read-only."` and is disabled
  (`src/features/channels/ui/ChannelPane.tsx:306-322`, placeholder text at
  `773-776`). Timed-out-by-moderator state shows `ComposerTimeoutBanner` and
  placeholder `"You're timed out by community moderators."`
  (`ChannelPane.tsx:736-738,773-774`). Archived channels: placeholder
  `"Archived channels are read-only."` (`ChannelPane.tsx:777-778`) — DM
  channels are not typically archivable but the code path is shared.

---

## Data shape

### Inbox / DM list row (one Nostr `Channel` of `channelType: "dm"`)

Per `Channel` type (`src/shared/api/types.ts:5-20`) plus the per-row derived
metadata built by `useDmSidebarMetadata`
(`src/features/sidebar/useDmSidebarMetadata.ts`) and consumed by
`SidebarSection`/`ChannelMenuButton`:

- **Avatar**: `dmParticipantsByChannelId[channel.id]` → array of
  `{ pubkey, label, avatarUrl }` for the "other" participant(s), excluding
  self (`useDmSidebarMetadata.ts:97-139`). Rendered by `DmChannelIcon`
  (`SidebarSection.tsx:160-210`): a 1:1 DM (`channel.participantPubkeys.length
  === 2`, `isPair`) shows a single `ProfileAvatarWithStatus` (avatar +
  presence dot); a group DM with >1 other participant shows a numeric badge
  (participant count) instead of a stacked avatar; no participants resolved
  falls back to a generic `CircleDot` icon.
- **Display name vs raw-pubkey fallback**: `dmChannelLabels[channel.id]` from
  `resolveChannelDisplayLabel` (`src/features/sidebar/lib/channelLabels.ts:19-55`),
  which for a DM with no meaningful custom channel name resolves each other
  participant via `resolveUserLabel` (`src/features/profile/lib/identity.ts:91-132`).
  Fallback chain, in order: profile `displayName` (trimmed) → profile
  `nip05Handle` (trimmed) → the channel-supplied `fallbackName` (trimmed) →
  `truncatePubkey(pubkey)` (`src/shared/lib/pubkey.ts:20-25`), which renders
  as `first8chars…last4chars` (e.g. `208b5bf5…f57d`), i.e. the exact "raw
  pubkey" format visible in Carson's screenshot. The self pubkey resolves to
  the literal string `"You"` unless `preferResolvedSelfLabel` is set. Multiple
  other participants (group DM) are comma-joined via
  `formatDmParticipantDisplayName`, capped at 3 visible names + `"+N more"`
  (`src/features/channels/lib/dmParticipantDisplay.ts:8,25-38,40-52`).
- **Last-message preview text**: **not present.** The `Channel` type has no
  message-preview field (`types.ts:5-20`), and `ChannelMenuButton` /
  `SidebarSection` render only the resolved label — no snippet of the last
  message body is shown anywhere in the DM row. This differs from typical
  chat-app DM lists; flag explicitly for the native port decision.
- **Timestamp**: `channel.lastMessageAt: string | null` exists on the type
  (`types.ts:15`) but is not rendered as visible text in the DM row (used
  only for sort ordering — see `dmSidebarSort.ts` — and for
  `onMarkChannelRead(channelId, lastMessageAt)` calls). No "2m ago" style
  timestamp is shown per-row.
- **Unread indicator/count**: `unreadChannelIds: ReadonlySet<string>` +
  `unreadChannelCounts: ReadonlyMap<string, number>` passed into
  `SidebarSection`. For a DM row, when unread and not the active/selected
  channel, `UnreadCountBadge` renders (pill, count clamped to `99+`,
  `formatUnreadCount`, `SidebarSection.tsx:58-83`); note DM rows render this
  badge via a second, absolutely-positioned `UnreadCountBadge` instance at
  `SidebarSection.tsx:454-468` (distinct from the generic
  `hasUnread && channel.channelType !== "dm"` badge used for non-DM channels
  at `SidebarSection.tsx:324-334` — DM channels intentionally skip that path
  and always show a numeric badge, minimum count `1`, never a bare dot).
  When the row itself is muted and has no unread, the whole row is dimmed
  (`opacity-50`, `ChannelMenuButton`, `SidebarSection.tsx:283`).
- **Online/presence dot**: `dmPresenceByChannelId[channel.id]` (one of the
  `PresenceStatus` values) resolved from `usePresenceQuery`
  (`useDmSidebarMetadata.ts:48-50,55-82`); rendered on the avatar only for a
  1:1 DM or a resolved-to-one-participant view
  (`SidebarChannelIcon`, `SidebarSection.tsx:212-246`, condition at
  `227-231`). Group DMs (more than 2 total participants) do not show a
  presence dot.
- **Agent-vs-human distinction**: not explicitly rendered as a badge/icon on
  the DM row itself in the code paths read; `Channel`/participant profile
  carries `isAgent`/`ownerPubkey` elsewhere in the app (used e.g. for message
  rows, see below) but no agent badge was found wired into
  `ChannelMenuButton`/`DmChannelIcon` for the sidebar DM list specifically —
  flagging as not present rather than guessing at an icon.

### Conversation-thread message (`TimelineMessage`, rendered by `MessageRow`)

Fields actually consumed by `MessageRow.tsx` (see props destructured at
lines 61-97 and body at 309-895):

- `message.pubkey` — sender pubkey (nullable for system-authored rows).
- `message.author` — resolved display name string (already resolved
  upstream via the same `resolveUserLabel` fallback chain described above;
  `MessageRow` does not re-derive it).
- `message.avatarUrl`, `message.accent` — avatar image + accent flag, passed
  into `UserAvatar` (`MessageRow.tsx:393-401`); avatar rendered at the `md`
  size (`36px`/`h-9 w-9`, see UserAvatar sizes below) since no `size` prop is
  overridden.
- `message.body` — markdown content, rendered via the shared `Markdown`
  component (`MessageRow.tsx:356-382`).
- `message.createdAt` (unix seconds) + `message.time` (pre-formatted string)
  — `MessageTimestamp` (`src/features/messages/ui/MessageTimestamp.tsx`).
- **Own-message vs other-message styling**: **there is none.** Buzz's
  `MessageRow` is a flat Slack/Discord-style list — every message (own or
  other) is left-aligned with the same avatar-left / body-right layout,
  same background, same bubble/box treatment (in fact there is no bubble
  background at all — see Exact Visual Values). The only place "self" matters
  is the resolved author label (`"You"`) and reply/edit permission gating.
  This is a significant divergence from typical two-column chat-bubble UIs
  and must be an explicit decision point for the native port, not an
  oversight.
- **Delivery/read state**: no delivery ticks or "seen/read" indicator was
  found on `MessageRow`. The only per-message status shown is `pending`
  (`"Sending…"`, `MessageRow.tsx:519-529`) and `edited`
  (`"(edited)"` with a tooltip `"This message has been edited"`, lines
  530-537). Deleted messages are filtered out entirely upstream in
  `formatTimelineMessages.ts` (`deletedEventIds` sets, e.g. lines 93-107,
  207-240) — deleted messages simply disappear from the timeline; there is
  no "this message was deleted" placeholder row.
- **Grouping/continuation**: consecutive messages from the same
  `pubkey` within `MESSAGE_GROUPING_WINDOW_SECONDS = 10 * 60` (10 minutes)
  of each other collapse into a continuation row: no avatar/header repeat,
  just a small hover-revealed timestamp in the avatar gutter
  (`src/features/messages/lib/messageGrouping.ts:12`, consumed at
  `timelineItems.ts:238-260`, rendered via `isDisplayedAsContinuation` in
  `MessageRow.tsx:148,432-469`).
- **Day dividers**: `DayDivider` renders `"Today"` / `"Yesterday"` / a full
  weekday+date string via `formatDayHeading`
  (`src/features/messages/lib/dateFormatters.ts:56-66`+), sticky-positioned
  pill (see Exact Visual Values).

---

## Interactions

### DM list

- **Click a DM row** → `onSelectChannel(channel.id)` fires from
  `ChannelMenuButton`'s `onClick` (`SidebarSection.tsx:288`), which the app
  wires to navigate to that channel's route (`AppSidebar.tsx:832`,
  `onSelectChannel`). Opens the thread view described above.
- **"New message" quick action** — a button next to the "Direct messages"
  header (`AppSidebarPrimaryMenu`/`SectionQuickAction`,
  `AppSidebar.tsx:804-810`) calls `onNewMessage`, which is out of this
  screen's scope to fully trace (it opens a compose/new-DM flow) but the
  entry point itself lives in this section's header, so it's worth noting as
  present.
- **Section overflow menu** (`SectionActionsMenu`, `AppSidebar.tsx:811-820`)
  — sort mode toggle for the DM list (`sortModeFor("dms")`,
  `onSortModeChange`) and the same "New message" action.
- **Collapse/expand section** — clicking the "Direct messages" label toggles
  `collapsedGroups.directMessages` (`AppSidebar.tsx:318-335,833-835`),
  chevron rotates (`SidebarSection.tsx:415-422`).
- **Hide a DM ("×" button)** — per-row close button, visible on
  hover/focus-within (`SIDEBAR_ROW_ACTION_VISIBILITY_CLASS`,
  `SidebarSection.tsx:469-487`), calls `onHideDm(channel.id)`, stops
  propagation so it doesn't also select the row.
- **Right-click a DM row** → `ContextMenu` with `ChannelContextMenuItems`
  (mark read/unread, mute/unmute — `SidebarSection.tsx:493-508`).
- **Unread count badge** appears/disappears reactively; no click behavior of
  its own beyond being part of the row's click target.
- **Hover state**: row background changes via `hover:bg-sidebar-accent`
  (`sidebar.tsx:761` — the base `SidebarMenuButton` class shared by all rows,
  DM included).

### Conversation thread

- **Type in composer** — rich-text (Tiptap) editor; typing broadcasts a
  "typing" signal via `useTypingBroadcast` (`MessageComposer.tsx:139-143`)
  which is what powers the other party's `TypingIndicatorRow`.
- **Enter** → submits the message (`submitOnEnter` Tiptap extension,
  `src/features/messages/lib/useRichTextEditor.ts:436-451`; fires before
  ProseMirror's default paragraph-split so Enter never inserts a blank line).
- **Shift+Enter** → inserts a hard line break instead of submitting
  (`useRichTextEditor.ts:404`, `"Shift-Enter"` keymap entry).
- **Click Send button** → same `submitMessage()` path via the form's
  `onSubmit` (`MessageComposer.tsx:682-688,918-920`); button is
  `type="submit"`, disabled while `sendDisabled` (empty content and no
  pending attachment, uploading, or a mention-invite flow in progress —
  `MessageComposer.tsx:826-839`) or while `isSending`
  (`MessageComposerToolbar.tsx:238`).
- **ArrowUp in an empty composer** → edits your own last message (Slack-style
  parity), handled at the raw ProseMirror `handleKeyDown` layer, guarded to
  only fire with no modifiers, autocomplete closed, and an empty doc
  (`useRichTextEditor.ts:496-575` region, guard list at 559-566).
- **Escape while editing** → cancels edit mode (`MessageComposer.tsx:731-735`).
- **⌘K / Ctrl+K** → opens the link editor when a selection/caret-on-link
  applies (`useRichTextEditor.ts:535-557`); otherwise falls through to the
  app's global quick-search shortcut.
- **@ button** → opens mention picker (`onOpenMentionPicker`,
  `MessageComposerToolbar.tsx:164-176`).
- **Paperclip button** → attach image/file (`onPaperclip`,
  `MessageComposerToolbar.tsx:181-192`); drag-and-drop onto the composer/
  message area also uploads (`ChannelPane.tsx:602-617`,
  `DropZoneOverlay`).
- **Emoji picker button** → `ComposerEmojiPicker` (toolbar, lines 195-202).
- **"Aa" formatting toggle** → expands/collapses an inline formatting
  toolbar with a spring animation (`presenceSpring`, stiffness 400 / damping
  28, `MessageComposerToolbar.tsx:12-17`); crossfades between the passive
  icon row (`@ 📎 😊 Aa`) and the expanded formatting row.
  Framer/`motion` `AnimatePresence mode="popLayout"`.
- **Scroll behavior / pagination**: NOT infinite-scroll-on-demand by default
  in the sense of auto-loading as you approach the top in all cases — a
  `fetchOlder()` call is triggered either by the virtualizer's
  `onStartReached` callback or (non-virtualized path) by
  `useLoadOlderOnScroll` watching a top sentinel element
  (`MessageTimeline.tsx:566-572,639-640`); while fetching, a small spinner
  pill is pinned near the top (`isFetchingOlder`,
  `MessageTimeline.tsx:679-693`). `historyExhausted` stops further fetches.
  This is auto-load-on-scroll-near-top, not a manual "Load more" button.
- **Unread pill**: a floating pill (`UnreadPill`) appears when there are
  unread messages and you're scrolled away from them, labeled with the
  unread count; clicking it jumps to the oldest unread message
  (`handleJumpToOldestUnread`, `MessageTimeline.tsx:481-486,660-675`). A
  second "jump to latest"/new-message pill appears at the bottom when not
  at-bottom (`MessageTimeline.tsx:824-840`).
- **Hover a message row** → row background tints (`hover:bg-muted/50`,
  `MessageRow.tsx:797-798`) and reveals a floating action bar (reply, react,
  edit, delete, remind-later, mark unread — `MessageActionBar`) plus, for a
  continuation row, a small hover-revealed timestamp
  (`continuationTimestampGutter`, opacity 0→100 on
  `group-hover/message`, `MessageRow.tsx:432-447`).
- **Click reactions / react button**: out of scope per the task (reactions
  explicitly excluded) — noted only because it lives in the same row and
  must not be ported.
- **Reply/thread-open**: out of scope per the task (threads/replies UI
  explicitly excluded) — `onReply` exists on the row but its target (the
  side thread panel) is a separate, excluded feature.

---

## Exact visual values

All values below are literal Tailwind class strings or literal numbers
pulled from the source, with `file:line`. Buzz's CSS variable *names* (see
Token note at the end) match Dobius's shadcn token names 1:1
(`--background`, `--foreground`, `--primary`, `--primary-foreground`,
`--secondary`, `--muted`, `--muted-foreground`, `--border`, `--destructive`,
`--radius`) but the actual color *values* differ — Buzz ships a Catppuccin
theme (light = Latte, confirmed at
`src/shared/styles/globals/theme.css:1-40`) with primary
`hsl(266 85.05% 58.04%)` (a violet/purple), whereas Dobius's own
`--primary` is a near-neutral black/white
(`dobius/src/renderer/src/assets/main.css:139,218`). Base `--radius` is
identical in both: `0.625rem` (Buzz `theme.css:4`; Dobius `main.css:131`).

### Sidebar DM list row

- Row height: `h-8` (32px), `text-sm`, `rounded-md`, `gap-2`, `p-2` — base
  `SidebarMenuButton` classes (`src/shared/ui/sidebar.tsx:761,770`).
- DM avatar size: `DM_AVATAR_SIZE = 24` (24px), status-dot geometry scaled
  from `DEFAULT_HOVER_PROFILE_STATUS_GEOMETRY`
  (`SidebarSection.tsx:52-56`); icon wrapper `h-6 w-6`
  (`SidebarSection.tsx:193,196-197`).
- Unread count badge: `h-5 min-w-5` pill, `rounded-full`, `bg-primary`,
  `text-primary-foreground`, `text-2xs font-semibold`
  (`SidebarSection.tsx:73-76`); label text capped `"99+"` beyond 99
  (`formatUnreadCount`, line 58-60).
- Group-DM participant-count badge: `h-6 w-6 rounded-full bg-sidebar-accent/80
  text-2xs font-semibold text-sidebar-foreground` (`SidebarSection.tsx:181-186`).
- Muted + no-unread row: `opacity-50` (`SidebarSection.tsx:283`).
- Active/selected row background: `bg-sidebar-active`, text
  `text-sidebar-active-foreground`, `shadow-xs`
  (`sidebar.tsx:761`, `data-[active=true]:...`).
- Section title / chevron: label button text default size (inherits
  `SidebarGroupLabel`), chevron `size-2.5`, opacity 0→100 on
  section/row hover (`SidebarSection.tsx:42-45`).
- DM-list row text color token override: `color: var(--buzz-dm-fg)` when
  `data-buzz-sidebar` theme is active, scoped to
  `[data-testid="dm-list"] [data-sidebar="menu-button"]:not([data-active="true"])`
  (`src/shared/styles/globals/theme.css:568-577`).

### Conversation thread — DM intro block (empty-state header)

- Avatar stack size: `60px × 60px` (`h-[60px] w-[60px]`) per participant,
  `UserAvatar` size `md`, overlapping with `-ml-5` (`-20px`) offset and a
  radial mask cutout between overlapping avatars
  (`DirectMessageIntroAvatarStack.tsx:26-45`).
- Overflow-count bubble ("+N"): same `60px` circle, `bg-secondary`,
  `text-secondary-foreground`, label `text-lg` (`DirectMessageIntroAvatarStack.tsx:47-56`).
- Display-name heading: `text-xl font-semibold leading-7 tracking-tight
  text-foreground`, `mt-4` (`MessageTimeline.tsx:592,771`).
- Sub-copy: `text-sm leading-5 text-muted-foreground`, `mt-1`
  (`MessageTimeline.tsx:595,774`), other-participant name inline
  `font-medium text-foreground`.

### Conversation thread — generic empty state

- Card: `rounded-2xl border border-dashed border-border/80 bg-card/70
  px-6 py-10 text-center shadow-xs` (`MessageTimeline.tsx:795`).
- Title: `text-base font-semibold tracking-tight` (line 798).
- Body: `mt-2 text-sm text-muted-foreground` (line 801).

### Conversation thread — day divider

- Sticky pill: `sticky top-(--buzz-channel-content-top-padding,5.75rem)
  z-20`, container `flex justify-center` (`DayDivider.tsx`).
- Pill: `rounded-full border border-border/70 bg-background px-2.5 py-1
  text-2xs font-medium tracking-[0.02em] text-muted-foreground/70`.

### Conversation thread — message row (`MessageRow`)

- Row container: `rounded-2xl`, vertical padding `py-1`, horizontal
  `mx-1 px-2` (when hover background enabled), flex `gap-2.5`
  (`MessageRow.tsx:792-808`).
- Hover/focus background: `hover:bg-muted/50 focus-within:bg-muted/50`
  (line 798).
- **No bubble background color at all** — message content sits directly on
  the row background; the only background differentiation is the whole-row
  hover tint above (not a per-sender bubble color).
- Avatar: `UserAvatar` default size `md` → `h-9 w-9` (36px),
  `text-xs` initials, `shadow-xs` (`UserAvatar.tsx:14,51`); sizes available:
  `xs` = `h-5 w-5`/`text-3xs` (20px), `sm` = `h-6 w-6`/`text-2xs` (24px),
  `md` = `h-9 w-9`/`text-xs` (36px) (`UserAvatar.tsx:11-15`).
- Avatar fallback (no image): initials on `bg-secondary
  text-secondary-foreground font-semibold`, or `bg-primary
  text-primary-foreground` when `accent` is set (`UserAvatar.tsx:64-70`).
- Author name: `text-sm font-semibold leading-4 tracking-tight`, `truncate`,
  optional `hover:underline` (`MessageHeader.tsx:33-51`,
  `MessageAuthorText`).
- Header row layout: `flex flex-wrap items-baseline gap-x-1.5 gap-y-0
  leading-4` (`MessageHeader.tsx:10-24`, `MessageHeaderRow`).
- Timestamp: `text-xs font-normal leading-4 tabular-nums
  text-muted-foreground/55`, tooltip delay `500ms`
  (`MessageTimestamp.tsx:13,36-39`); tooltip shows full date/time via
  `formatFullDateTime`.
- Message body text: `text-sm max-w-full` for markdown content; emoji-only
  messages render at `text-4xl` (`MessageRow.tsx:359-363`).
- `"Sending…"` status text: `font-normal text-muted-foreground/70`
  (`MessageRow.tsx:523-526`).
- `"(edited)"` status text: `text-muted-foreground/70`, tooltip
  `"This message has been edited"` (lines 530-537).
- Continuation-row grouping window: **10 minutes**
  (`MESSAGE_GROUPING_WINDOW_SECONDS = 10 * 60`,
  `messageGrouping.ts:12`) — same author + gap ≤ 600s ⇒ continuation (no
  repeated avatar/header, just a small opacity-0→100-on-hover timestamp in
  the avatar gutter).
- Route-target highlight animation: `animate-[route-target-highlight-fade_2s_ease-out_forwards]`
  (2s ease-out fade), `bg-primary/10` (`MessageRow.tsx:805-807`,
  `TimelineMessageList.tsx:765`).

### Conversation thread — typing indicator

- Container padding: `px-4 py-2` (default variant)
  (`TypingIndicatorRow.tsx:82`).
- Avatar stack: `h-5 w-5 rounded-lg ring-1 ring-background`, `-ml-1.5`
  overlap for each subsequent avatar (`TypingIndicatorRow.tsx:104-107`).
- Label: `text-xs font-medium leading-4 text-muted-foreground`, wrapped in a
  `Shimmer` (shimmering-text) effect (`TypingIndicatorRow.tsx:126-136`).
- Agent "working" pill (composer accessory, inline variant): avatar `!h-4.5
  !w-4.5`, `Shimmer`-wrapped status label, headline rotates every
  `HEADLINE_ROTATION_MS = 2200`ms (`BotActivityBar.tsx:31,127-137,181-215`).
  Hover-to-open popover delay `150ms` open / `180ms` close
  (`HOVER_OPEN_DELAY_MS`, `HOVER_CLOSE_DELAY_MS`, `BotActivityBar.tsx:29-30`).

### Composer

- Outer form: `rounded-2xl border border-border/50 bg-background/80 px-3
  pb-2 pt-3 shadow-none supports-backdrop-filter:bg-background/70` (light),
  `dark:bg-background/70 dark:supports-backdrop-filter:bg-background/55`,
  `sm:px-4`, plus `backdrop-blur-md dark:backdrop-blur-xl` when
  `layoutMode === "standalone"` (`MessageComposer.tsx:901-906`).
- Footer wrapper: `px-4 pb-2 pt-0`; with a border-top variant `border-t
  border-border/40 pt-3` when `showTopBorder` (`MessageComposer.tsx:883-888`).
- Text input area: `max-h-32 overflow-y-auto` scroll container
  (`MessageComposer.tsx:980`); editor content class includes `min-h-0
  resize-none border-0 bg-transparent px-0 py-0 text-sm leading-5
  text-foreground shadow-none focus-visible:ring-0 caret-foreground`
  (`useRichTextEditor.ts:492`). Placeholder default `"Write a message…"`
  (`useRichTextEditor.ts:458`); DM-specific placeholder is
  `` `Message ${displayName}` `` (`ChannelPane.tsx:782-784`).
- Toolbar row: `mt-2 flex flex-wrap items-center justify-between gap-3`
  (`MessageComposerToolbar.tsx:56`); icon buttons are `size="icon"`
  ghost-variant `Button`s (standard shadcn icon-button sizing — exact px
  size lives in the shared `Button` component, not re-declared here).
- Send button: `rounded-full`, `size="icon"`, `type="submit"`,
  icon `ArrowUp` when idle, a `h-4 w-4 animate-spin rounded-full border-2
  border-primary-foreground border-t-transparent` spinner when `isSending`
  (`MessageComposerToolbar.tsx:234-250`).
- Formatting-toggle expand/collapse spring: `{ type: "spring", stiffness:
  400, damping: 28 }` (`presenceSpring`, `MessageComposerToolbar.tsx:12-17`),
  used via Framer Motion `AnimatePresence mode="popLayout"`.
- Upload-error banner: `rounded-lg bg-destructive/10 px-3 py-2 text-xs
  text-destructive`, `mb-2` (`MessageComposer.tsx:948`).

### Relay-unreachable card (sidebar)

- Icon: `CloudOff`/`Check`/`Spinner`, `h-5 w-5` (`relayError.ts` usage in
  `SidebarRelayConnectionCard.tsx:81-92`, via `SidebarCompactActionCard`).
- Title text exactly `"Can't reach the relay"` (disconnected, tone
  `"neutral"`), `"Connecting"` / `"Waiting to reconnect"` (reconnecting),
  `"Connected"` (tone `"success"`) (`relayError` file lines 61-63,99-107).

---

## Dobius design-system overlap notes (not solved here, only flagged)

- Dobius's `src/renderer/src/assets/main.css` already defines the same
  semantic CSS variable *names* Buzz uses (`--background`, `--foreground`,
  `--primary`, `--primary-foreground`, `--secondary`, `--muted`,
  `--muted-foreground`, `--border`, `--destructive`, `--radius` and its
  `--radius-sm/md/lg/xl/2xl/3xl/4xl` scale, `main.css:114-120,131-149,211-228`).
  Buzz's actual color values (Catppuccin violet primary) do NOT match
  Dobius's neutral black/white primary — a native port must choose whether
  to reskin to Dobius's palette (recommended, since the task is "native UI
  port," not "reskin Buzz") or keep Buzz's Catppuccin values verbatim.
- Dobius's `src/renderer/src/components/ui/` currently has no `avatar.tsx`,
  `sidebar.tsx`, `tooltip.tsx`, `textarea`/rich-text composer, or `skeleton`
  primitive (only `badge.tsx`, `button.tsx`, `button-group.tsx`,
  `input.tsx`, `scroll-area.tsx` were found) — all of Buzz's avatar,
  sidebar-menu, tooltip, and skeleton building blocks used above (`Avatar`/
  `AvatarFallback`, `SidebarMenuButton` family, `Tooltip`, `Skeleton`) will
  need net-new shadcn primitives in Dobius rather than reuse.
- Buzz's composer is a full Tiptap rich-text editor (mentions, emoji,
  formatting toolbar, link cards, image paste/upload, draft persistence).
  None of that exists in Dobius's `input.tsx`. A native port that only needs
  "type + Enter to send" could reasonably start from a plain `<textarea>`
  instead of porting Tiptap, but that is a product decision, not made here.

---

## File inventory

Sidebar / DM list:
- `src/features/sidebar/ui/AppSidebar.tsx` — top-level sidebar; wires
  `SidebarSection` for the "Direct messages" group (title, testId
  `dm-list`, quick-create + sort menu, collapse toggle).
- `src/features/sidebar/ui/SidebarSection.tsx` — generic sidebar list
  section; renders each channel/DM row (`ChannelMenuButton`), unread badge,
  hide-DM button, context menu, DM avatar/presence icon (`DmChannelIcon`).
- `src/features/sidebar/useDmSidebarMetadata.ts` — derives per-DM-channel
  display label, participant list (avatar+label+pubkey), and presence status,
  excluding the current user.
- `src/features/sidebar/lib/dmSidebarSort.ts` — sort order for DM rows
  (not read in depth beyond confirming its role; sort mode is user-selectable).
- `src/features/sidebar/lib/channelLabels.ts` — `resolveChannelDisplayLabel`,
  the DM display-name resolution/fallback logic.
- `src/features/sidebar/ui/sidebarLoadingSkeleton.tsx` — sidebar loading
  skeleton shape (incl. 2 DM skeleton rows) and its markup.
- `src/features/sidebar/ui/SidebarRelayConnectionCard.tsx` — relay
  connection status card ("Can't reach the relay" / connecting / connected).
- `src/shared/lib/relayError.ts` — relay-unreachable error detection +
  canonical message strings.
- `src/features/profile/lib/identity.ts` — `resolveUserLabel`, the shared
  display-name → nip05 → fallbackName → truncated-pubkey resolution chain
  used by both the DM list and message rows.
- `src/shared/lib/pubkey.ts` — `truncatePubkey` (raw-pubkey display format).
- `src/features/channels/lib/dmParticipantDisplay.ts` — `buildDirectMessageIntro`,
  `formatDmParticipantDisplayName`, `getDmParticipantPreview` (group-DM name
  joining/truncation, DM intro data for the empty-thread header).
- `src/shared/api/types.ts` — `Channel` type (fields available per DM row;
  confirms no last-message-preview field exists).
- `src/shared/ui/sidebar.tsx` — base `SidebarMenuButton` sizing/classes
  (row height, padding, active/hover states) shared by every sidebar row.

Routing / screen wiring:
- `src/app/routes/index.tsx` — home route (unified inbox, out of scope,
  read only to distinguish it from the DM sidebar).
- `src/app/routes/ChannelRouteScreen.tsx` — resolves the active channel by
  id and renders `ChannelScreen`; also fetches route-target/deep-link
  events (thread ancestor resolution — mostly out of scope threading logic).
- `src/features/channels/ui/ChannelScreen.tsx` — top-level per-channel
  screen; wires messages/composer/thread-panel/members/agent-session data.
  Very large file (980 lines) that mixes in-scope (message list + composer)
  and heavily out-of-scope (threads, reactions, agent sessions, members,
  moderation, welcome/onboarding) concerns; only skimmed for the in-scope
  wiring (empty/loading props into `ChannelPane`).
- `src/features/channels/ui/ChannelPane.tsx` — renders the message timeline
  + composer dock for the active channel/DM; DM-specific placeholder text,
  moderation-DM/timeout/archived read-only states, drag-and-drop upload zone.
- `src/features/home/ui/HomeView.tsx` — unified inbox view (out of scope);
  only read for its "Home feed unavailable" / relay error card, which is the
  exact copy from Carson's screenshot, to confirm it belongs to the
  out-of-scope unified inbox rather than the DM thread.

Message timeline / rows:
- `src/features/messages/ui/MessageTimeline.tsx` — scroll container,
  empty/DM-intro/loading-skeleton surface selection, unread pill, jump-to-
  latest pill, older-message fetch triggering.
- `src/features/messages/ui/TimelineMessageList.tsx` — virtualized/
  non-virtualized row list, day-divider insertion, wraps `MessageRow`.
- `src/features/messages/ui/MessageRow.tsx` — the actual message bubble/row
  (avatar, header, body, timestamp, edited/pending/deleted-adjacent states,
  continuation layout, hover action bar). Read in full (894 lines).
- `src/features/messages/ui/MessageHeader.tsx` — `MessageHeaderRow`,
  `MessageAuthorText` (author name typography).
- `src/features/messages/ui/MessageTimestamp.tsx` — timestamp text +
  tooltip (full date/time).
- `src/features/messages/lib/messageGrouping.ts` — continuation-grouping
  window constant (10 minutes) and same-author check.
- `src/features/messages/lib/dateFormatters.ts` — `formatTime`,
  `formatFullDateTime`, `formatDayHeading` ("Today"/"Yesterday"/date).
- `src/features/messages/ui/DirectMessageIntroAvatarStack.tsx` — the
  60px overlapping-avatar stack shown at the top of an empty DM thread.
- `src/shared/ui/UserAvatar.tsx` — avatar component; size variants
  (`xs`/`sm`/`md`), fallback initials styling.
- `src/features/messages/ui/TypingIndicatorRow.tsx` — human typing
  indicator row (avatar stack + shimmering label).
- `src/features/channels/ui/ChannelComposerActivityAccessory.tsx` /
  `src/features/channels/ui/BotActivityBar.tsx` — agent "working"/thinking
  indicator pill shown above the composer.

Composer:
- `src/features/messages/ui/MessageComposer.tsx` — full composer
  implementation (Tiptap rich-text editor, send/edit flow, drafts, media,
  mentions). Read in full (1027 lines); only the send/submit/keyboard and
  outer-JSX portions are in scope, the rest (mentions, custom emoji, link
  editor, attachment editing) is composer-internal plumbing not itemized
  above beyond what's needed for the "type + send" interaction.
- `src/features/messages/ui/MessageComposerToolbar.tsx` — toolbar buttons
  (mention, attach, emoji, formatting toggle, send button) and their exact
  classes/animation.
- `src/features/messages/ui/ComposerDockToolbar.tsx` — thin wrapper that
  adds a layout spacer for the "dock" composer placement.
- `src/features/messages/lib/useRichTextEditor.ts` — Tiptap editor setup;
  read for Enter-submits / Shift+Enter-newline / ArrowUp-edit-last-message /
  ⌘K-link-shortcut keyboard behavior (partial read, keyboard-relevant
  sections only — file is large and covers formatting marks, code blocks,
  link handling not itemized here).

Theme / design tokens:
- `src/shared/styles/globals/theme.css` — Buzz's CSS variable theme
  (Catppuccin Latte/Mocha), confirms token names match Dobius's shadcn
  tokens but color values differ; also confirms the DM-row color override
  (`--buzz-dm-fg`) is theme-scoped, not a Tailwind utility.
- `tailwind.config.js` — confirmed present (not deeply read; Buzz's classes
  above are literal Tailwind utility strings, no custom class aliases were
  needed to interpret them).
- `dobius/src/renderer/src/assets/main.css` — Dobius's own token file,
  skimmed for `--radius`/`--primary`/`--muted`/`--border`/`--background`/
  `--foreground`/`--secondary`/`--destructive` to compare against Buzz's.
- `dobius/src/renderer/src/components/ui/` — directory listing only (no
  file-by-file read), to confirm which shadcn primitives Dobius already has
  (`badge`, `button`, `button-group`, `input`, `scroll-area`) vs. what a
  port would need to add (`avatar`, `sidebar`, `tooltip`, `skeleton`,
  rich-text/textarea composer).

Files found but explicitly NOT deep-read (out of scope or redundant with
the above, listed so the next agent doesn't re-discover them from scratch):
`src/features/home/ui/InboxListPane.tsx`, `InboxDetailPane.tsx`,
`InboxMessageRow.tsx`, `HomePersonalInboxDetail.tsx`,
`src/features/home/lib/inbox.ts`, `inboxListRows.ts`, `inboxSelection.ts`
(all belong to the separate, out-of-scope unified Home inbox feature, which
mixes channel replies/reactions/drafts/reminders); `MessageThreadPanel.tsx`,
`MessageActionBar.tsx`, `MessageReactions.tsx`, `AgentSessionThreadPanel.tsx`,
`ChannelManagementAuxiliaryPanel.tsx`, `UserProfilePanel.tsx` (threads,
reactions, agent sessions, channel management, profile panel — all
explicitly out of scope).

---

## Stage 3 — Mapping table (verified against real Dobius code, not guessed)

Verified by reading `dobius/src/main/communications/command-manifest.json` (258
tracked commands, 54 implemented), `dobiusCommunications.ts`, and
`useTypingBroadcast.ts` directly. "Implemented" below means the relay-backed
function already exists and works today — a native port calls that function
directly (no bridge/IPC hop needed since native code runs in the same
process as the rest of Dobius's renderer), not that zero code is needed.

### Sidebar DM list

| Need | Dobius service | Verdict |
|---|---|---|
| DM channel list | `loadRelayChannels()` — implemented, relay kind 39000/39002 query | **WIRE** |
| Avatar/label per participant | `loadDobiusUserProfile` / `loadDobiusUsersBatch` — implemented (relay kind-0) | **WIRE** (data); `useDmSidebarMetadata` hook itself is pure derivation, gets rewritten natively |
| Display-name fallback chain | Pure logic (`resolveUserLabel`, `truncatePubkey`), no backend call | **WIRE** (port the logic, no service needed) |
| Last-message preview text | Not present in Buzz today (confirmed: no field, no UI) | **N/A** — not a real Buzz feature, nothing to port |
| Per-row timestamp | Not rendered in Buzz today (field exists, unused) | **N/A** |
| Unread indicator/count | No `mark_channel_read`/read-state command exists anywhere in the 258-command manifest | **CUT** for v1 (would need a new read-state service — real work, not wired to anything today) |
| Presence dot (online/offline) | `get_presence` command defined but **not implemented** (0/1 in manifest) | **CUT** for v1 |
| Agent-vs-human badge on row | Not present in Buzz's current DM list UI | **N/A** |
| Click row → open thread | Local navigation/view state | **WIRE** (trivial, no service) |
| "New message" / start new DM | `open_dm` — implemented | **CUT for v1 UI entry point** (backend already works, but v1 only opens *existing* DMs — trivial to add once the thread view is proven) |
| Sort-mode menu | Local UI state only | **CUT** for v1 |
| Collapse/expand section | Local UI state only | **WIRE** (trivial, no service) |
| Hide DM (×) | `hide_dm` — defined but **not implemented** | **CUT** for v1 |
| Right-click: mark read/unread, mute/unmute | Depends on unread/read-state (not implemented); mute state exists as a prop but no relay-backed mute command found | **CUT** for v1 |

### Conversation thread

| Need | Dobius service | Verdict |
|---|---|---|
| Message history (paginated) | `get_channel_window` — **implemented** (Package 2, cursor-paginated) | **WIRE** |
| Send message | `send_channel_message` — **implemented**, already dispatches to Dobius agents natively when an agent is mentioned/DMed | **WIRE** |
| Edit message | `edit_message` — **implemented** | **WIRE** |
| Delete message | `delete_message` — **implemented** | **WIRE** |
| DM intro block (empty-thread header) | Same participant/profile data as sidebar avatars | **WIRE** (logic port) |
| Loading skeleton | Local UI state | **WIRE** (trivial) |
| Typing indicator (send signal) | `relayClient.sendTypingIndicator()` — publishes a kind:20002 event **directly to the relay**, bypasses the Dobius bridge entirely, fully portable as-is | **WIRE** |
| Typing indicator (receive/render) | Subscribe to kind:20002 events via the same relay query pattern already used elsewhere | **WIRE** |
| Agent "working" indicator | `agent.runs` RPC — **implemented**, but only returns `running`/`success`/`failed` + a static summary, polled every 750ms. No rotating live headline text exists anywhere. | **WIRE, simplified**: a plain "`<agent> is working`" spinner using the existing poll loop. **CUT**: the rotating-headline / multi-agent hover popover version — no data source for it |
| "Sending…" optimistic state | Client-side state around the `send_channel_message` call, no separate service | **WIRE** (client logic) |
| Message grouping / continuation, day dividers | Pure client-side derivation from timestamps | **WIRE** (logic port) |
| Reactions | Out of scope per task | **CUT** |
| Threads/replies panel | Out of scope per task | **CUT** |
| Rich text composer (Tiptap: mentions, emoji picker, formatting toolbar, link cards, image paste/upload, drafts) | No media-upload backend exists in this slice (that's Package 4 territory); Tiptap itself is a large UI dependency Dobius doesn't have | **CUT for v1** — plain `<textarea>` + Enter-to-send + Shift+Enter-newline only, per the spec's own flagged recommendation |
| ArrowUp-edit-last-message, ⌘K link editor | Depends on the rich text editor | **CUT for v1** |
| Read-only / moderation-DM / timeout / archived placeholders | Moderation data out of scope | **CUT for v1** |
| Unread pill / jump-to-latest pill | Depends on unread tracking (cut above) | **CUT for v1** |
| Drag-and-drop file upload | No media backend wired (Package 4) | **CUT for v1** |

### Visual approach

**Decision (Carson, 2026-08-05): keep Buzz's actual look, do not reskin to
Dobius's neutral tokens.** Reasoning: Dobius+ already has precedent for
wholesale-adopting Buzz's visual identity (the "Buzz" App Skin shipped
2026-07-30, `dobius/src/renderer/src/assets/buzz-skin.css`, selectable in
Settings → Appearance), and the whole point of this port is preserving
Buzz's UI/UX exactly, not re-theming it. The native tab's CSS variables
(`--primary`, `--secondary`, `--muted`, `--background`, etc.) get Buzz's
literal Catppuccin values (primary `hsl(266 85.05% 58.04%)`, light = Latte /
dark = Mocha, see `theme.css:1-40` in the vendored source), scoped to the
tab, not applied app-wide — this is not the same mechanism as the gradient
"Buzz" App Skin, which repaints the *entire* app chrome and stays a
separate, independent toggle. Layout, spacing, type scale, and the flat
(no-bubble) message-row treatment carry over as-is regardless, since those
were never in question. New shadcn primitives needed: `avatar`, `sidebar`
menu-button family, `tooltip`, `skeleton` — none currently exist in
`dobius/src/renderer/src/components/ui/`.
