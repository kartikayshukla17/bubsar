import {
  CloudIcon,
  CodeIcon,
  CreditCardIcon,
  FileIcon,
  GlobeIcon,
  GoogleIcon,
  LinkChainHorizontalIcon,
  ServerIcon,
  WhatsappIcon,
} from "@pikaicons/core-free";
import { PikaIcon } from "@pikaicons/react";
import type { ComponentProps } from "react";
import type { DestinationId, Tier } from "~/lib/board";

export { PikaIcon };

type IconData = ComponentProps<typeof PikaIcon>["icon"];

export const DESTINATION_ICON: Partial<Record<DestinationId, IconData>> = {
  razorpay: CreditCardIcon,
  stripe: CreditCardIcon,
  meta: WhatsappIcon,
  google: GoogleIcon,
  "agent-env": FileIcon,
  render: ServerIcon,
  vercel: CloudIcon,
};

export const TIER: Record<Tier, { code: string; icon: IconData; label: string }> = {
  cli: { code: "CLI", icon: CodeIcon, label: "Local CLI or file write" },
  api: { code: "API", icon: LinkChainHorizontalIcon, label: "Provider API" },
  web: { code: "WEB", icon: GlobeIcon, label: "Sandbox browser, console-only step" },
};

/** The busbar mark: one bar, many taps. */
export function BusbarMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="4" width="20" height="5" rx="1.2" fill="#c6f432" />
      <rect x="4" y="9" width="2.4" height="11" rx="1" fill="#c6f432" />
      <rect x="10.8" y="9" width="2.4" height="7" rx="1" fill="#c6f432" />
      <rect x="17.6" y="9" width="2.4" height="11" rx="1" fill="#c6f432" />
    </svg>
  );
}
