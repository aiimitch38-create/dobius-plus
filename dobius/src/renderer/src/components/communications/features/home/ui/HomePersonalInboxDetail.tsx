import type { DraftViewItem } from "@comms/features/messages/ui/DraftsPanel";
import { DraftDetailPane } from "@comms/features/messages/ui/DraftDetailPane";
import type { Reminder } from "@comms/features/reminders/lib/reminderTypes";
import { ReminderDetailPane } from "@comms/features/reminders/ui/RemindersPanel";

type HomePersonalInboxDetailProps = {
  currentPubkey?: string;
  draftItem: DraftViewItem | null;
  mode: "drafts" | "reminders";
  onBack?: () => void;
  onDeleteDraft: (draftKey: string) => void;
  reminder: Reminder | null;
};

export function HomePersonalInboxDetail({
  currentPubkey,
  draftItem,
  mode,
  onBack,
  onDeleteDraft,
  reminder,
}: HomePersonalInboxDetailProps) {
  if (mode === "drafts") {
    return (
      <DraftDetailPane
        item={draftItem}
        key={draftItem?.entry.key ?? "empty"}
        onBack={onBack}
        onDelete={onDeleteDraft}
      />
    );
  }

  if (mode === "reminders") {
    return (
      <ReminderDetailPane
        onBack={onBack}
        pubkey={currentPubkey ?? ""}
        reminder={reminder}
      />
    );
  }

  return null;
}
