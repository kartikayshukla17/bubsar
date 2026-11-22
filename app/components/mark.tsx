import type { Mark as MarkKind } from "~/lib/board";

export const MARK_LABEL: Record<MarkKind, string> = {
  drift: "Drift",
  planned: "Planned",
  active: "Applying",
  checking: "Checking",
  handoff: "Your turn",
  applied: "Applied",
  failed: "Failed",
  verified: "Verified",
  unexercised: "Not exercised",
  unknown: "Never verified",
};

const SIGNAL = "#c6f432";
const INK = "#0b0b0c";

/**
 * State marks. Every state reads without colour: stamp, strike, open box, ring.
 * `tone` is the surface it sits on: "ink" (dark bay) or "paper" (a strip).
 */
export function Mark({
  kind,
  tone = "ink",
  size = 16,
  fresh = false,
  title,
}: {
  kind: MarkKind;
  tone?: "ink" | "paper";
  size?: number;
  fresh?: boolean;
  title?: string;
}) {
  const fg = tone === "ink" ? "#ffffff" : INK;
  const label = title ?? MARK_LABEL[kind];
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    role: "img" as const,
    "aria-label": label,
    className: `bb-mark${kind === "active" || kind === "checking" ? " bb-mark--active" : ""}`,
    "data-fresh": fresh ? "true" : undefined,
  };

  switch (kind) {
    case "verified":
      return (
        <svg {...common}>
          <rect
            x="1"
            y="1"
            width="14"
            height="14"
            rx="2"
            fill={SIGNAL}
            stroke={INK}
            strokeWidth="1"
          />
          <path
            d="M4.4 8.3l2.3 2.3 4.9-5"
            fill="none"
            stroke={INK}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "applied":
      return (
        <svg {...common}>
          <rect
            x="1.75"
            y="1.75"
            width="12.5"
            height="12.5"
            rx="2"
            fill="none"
            stroke={fg}
            strokeWidth="1.5"
          />
          <path
            d="M4.6 8.3l2.2 2.2 4.6-4.7"
            fill="none"
            stroke={fg}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "failed":
      return (
        <svg {...common}>
          <rect x="1" y="1" width="14" height="14" rx="2" fill={fg} />
          <path
            d="M5.2 5.2l5.6 5.6M10.8 5.2l-5.6 5.6"
            fill="none"
            stroke={tone === "ink" ? INK : "#ffffff"}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      );
    case "drift":
      return (
        <svg {...common}>
          <rect
            x="1.75"
            y="1.75"
            width="12.5"
            height="12.5"
            rx="2"
            fill="none"
            stroke={fg}
            strokeWidth="1.5"
          />
          <path d="M0.5 15.5L15.5 0.5" stroke={fg} strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "planned":
      return (
        <svg {...common}>
          <rect
            x="3.5"
            y="3.5"
            width="9"
            height="9"
            rx="1.5"
            fill="none"
            stroke={fg}
            strokeOpacity="0.6"
            strokeWidth="1.5"
          />
        </svg>
      );
    case "active":
    case "checking":
      return (
        <svg {...common}>
          <circle
            cx="8"
            cy="8"
            r="6.25"
            fill="none"
            stroke={tone === "ink" ? SIGNAL : INK}
            strokeWidth="1.5"
          />
          <circle cx="8" cy="8" r="2.6" fill={tone === "ink" ? SIGNAL : INK} />
        </svg>
      );
    case "handoff":
      return (
        <svg {...common}>
          <rect
            x="1"
            y="1"
            width="14"
            height="14"
            rx="2"
            fill={SIGNAL}
            stroke={INK}
            strokeWidth="1"
          />
          <path
            d="M5.5 10.5l5-5M6.5 5.5h4v4"
            fill="none"
            stroke={INK}
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "unexercised":
      return (
        <svg {...common}>
          <rect
            x="1.75"
            y="1.75"
            width="12.5"
            height="12.5"
            rx="2"
            fill="none"
            stroke={fg}
            strokeWidth="1.5"
            strokeDasharray="2.6 2"
          />
          <circle cx="8" cy="8" r="1.9" fill={fg} />
        </svg>
      );
    case "unknown":
      return (
        <svg {...common}>
          <rect
            x="1.75"
            y="1.75"
            width="12.5"
            height="12.5"
            rx="2"
            fill="none"
            stroke={fg}
            strokeOpacity="0.75"
            strokeWidth="1.5"
            strokeDasharray="2.6 2"
          />
        </svg>
      );
  }
}

/** Mark + caps label, the way a controller writes it on a strip. */
export function MarkLabel({
  kind,
  tone = "ink",
  fresh,
}: {
  kind: MarkKind;
  tone?: "ink" | "paper";
  fresh?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <Mark kind={kind} tone={tone} fresh={fresh} title="" />
      <span key={kind} className="t-swap">
        {MARK_LABEL[kind]}
      </span>
    </span>
  );
}
