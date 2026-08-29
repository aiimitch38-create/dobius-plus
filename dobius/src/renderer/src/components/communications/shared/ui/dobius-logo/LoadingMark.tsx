import { cn } from "@comms/shared/lib/cn";
import { DobiusMark } from "./DobiusMark";
import "./dobius-logo.css";

/**
 * The Dobius mark for boot and wait screens.
 *
 * Replaces the vendored client's flapping-bee sprite. That sprite existed
 * because WebKit paints SVG children on the main thread, so its wing animation
 * froze while boot work hogged it; the mark here is one image animated with a
 * CSS transform, which the compositor runs regardless of what the main thread
 * is doing — the same reason, one element instead of three.
 */
export function LoadingMark({ className }: { className?: string }) {
  return (
    <DobiusMark className={cn("dobius-logo--breathe", className)} />
  );
}
