import logo from "../../../../../../../../resources/logo.svg";
import { cn } from "@comms/shared/lib/cn";

/**
 * The Dobius mark.
 *
 * Replaces the vendored bee mark this client shipped with. The artwork is the
 * app's own `resources/logo.svg`, the same asset the launcher and settings use,
 * so the Communications tab and the rest of Dobius+ show one identity.
 *
 * The source artwork is light ink on transparent, so it is inverted in light
 * mode and left alone in dark — the same treatment as
 * `dobius-logo-settings-icon.tsx`. Callers that used to tint the old mark with
 * `text-foreground` still compile; the class is simply inert on an image.
 */
export function DobiusMark({ className }: { className?: string }) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={cn(
        "dobius-logo__mark block object-contain invert dark:invert-0",
        className,
      )}
      src={logo}
    />
  );
}
