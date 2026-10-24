/** @type {import('tailwindcss').Config} */
export default {
  theme: {
    extend: {
      // Sub-`text-xs` ramp for meta text (timestamps, count badges, tracking
      // labels) and tiny glyphs. Defined in rem so Cmd +/- zoom — which scales
      // the root <html> font-size — keeps scaling them. Do NOT reintroduce
      // arbitrary `text-[…rem]` / `text-[…px]` literals; the px-text guard
      // rejects them. Stock scale picks up from here: xs (12px), sm (14px)…
      fontSize: {
        "2xs": "0.6875rem", // 11px — meta-text workhorse (timestamps, badges)
        "3xs": "0.5rem", // 8px — tiny glyphs / micro labels
        badge: "0.625rem", // 10px — compact status badges
        // 40px — onboarding page titles (tightened tracking for large display type)
        title: ["2.5rem", { lineHeight: "1.15", letterSpacing: "-0.02em" }],
        // 36px — the backup-step private key, shown large in monospace
        "nsec-key": ["2.25rem", { lineHeight: "1.3" }],
      },
      boxShadow: {
        "content-edge": "-1px -1px 0 0 hsl(var(--comms-sidebar-border) / 0.45)",
        // Edge + elevation for a surface anchored to the right of the content
        // area, whose only exposed edge faces left. Tailwind's stock shadows are
        // all y-offset, so they cast almost nothing sideways — `shadow-xl` on a
        // left-facing edge is nearly invisible. Both layers run -x so they wrap
        // the surface's rounded left corners: the hairline draws the boundary
        // (and carries dark mode, where a black shadow reads as nothing), the
        // soft layer carries the lift. A left-only `border` can't do this job —
        // it tapers out at each corner instead of turning it.
        "panel-left":
          "-1px 0 0 0 hsl(var(--comms-border) / 0.8), -16px 0 32px -12px rgb(0 0 0 / 0.18)",
      },
      borderRadius: {
        lg: "var(--comms-radius)",
        md: "calc(var(--comms-radius) - 2px)",
        sm: "calc(var(--comms-radius) - 4px)",
      },
      spacing: {
        4.5: "1.125rem",
      },
      fontFamily: {
        sans: [
          '"Inter Variable"',
          "Inter",
          '"Avenir Next"',
          '"Segoe UI"',
          "sans-serif",
        ],
      },
      colors: {
        background: "hsl(var(--comms-background))",
        foreground: "hsl(var(--comms-foreground))",
        card: {
          DEFAULT: "hsl(var(--comms-card))",
          foreground: "hsl(var(--comms-card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--comms-popover))",
          foreground: "hsl(var(--comms-popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--comms-primary))",
          foreground: "hsl(var(--comms-primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--comms-secondary))",
          foreground: "hsl(var(--comms-secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--comms-muted))",
          foreground: "hsl(var(--comms-muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--comms-accent))",
          foreground: "hsl(var(--comms-accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--comms-destructive))",
          foreground: "hsl(var(--comms-destructive-foreground))",
        },
        border: "hsl(var(--comms-border))",
        input: "hsl(var(--comms-input))",
        ring: "hsl(var(--comms-ring))",
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--comms-sidebar-foreground))",
          primary: "hsl(var(--comms-sidebar-primary))",
          "primary-foreground": "hsl(var(--comms-sidebar-primary-foreground))",
          active: "hsl(var(--sidebar-active))",
          "active-foreground": "hsl(var(--sidebar-active-foreground))",
          accent: "hsl(var(--comms-sidebar-accent))",
          "accent-foreground": "hsl(var(--comms-sidebar-accent-foreground))",
          border: "hsl(var(--comms-sidebar-border))",
          ring: "hsl(var(--comms-sidebar-ring))",
        },
        status: {
          added: "var(--status-added)",
          deleted: "var(--status-deleted)",
          modified: "var(--status-modified)",
        },
        warning: {
          DEFAULT: "var(--ui-warning)",
          bg: "var(--ui-warning-bg)",
        },
      },
    },
  },
  plugins: [],
};
