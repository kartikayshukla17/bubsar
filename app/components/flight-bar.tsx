import {
  CopyCopiedIcon,
  CopyIcon,
  FileIcon,
  PlayCircleIcon,
  ShieldCheckIcon,
} from "@pikaicons/core-free";
import { useState } from "react";
import { BusbarMark, PikaIcon } from "~/components/icons";
import type { Phase, Scene } from "~/lib/board";

export function FlightBar({
  scene,
  phase,
  onPlan,
  onApply,
  onVerify,
  onDiscard,
}: {
  scene: Scene;
  phase: Phase;
  onPlan: () => void;
  onApply: () => void;
  onVerify: () => void;
  onDiscard: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const busy = phase === "applying" || phase === "verifying" || phase === "handoff";
  const COMMAND = scene.command;

  return (
    <header className="sticky top-0 z-20 -mx-4 border-b border-rule bg-ink/90 px-4 backdrop-blur-md sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 py-3">
        <a href="/" className="flex items-center gap-2.5 no-underline" aria-label="busbar board">
          <BusbarMark />
          <span className="font-display text-[19px] font-semibold tracking-[-0.02em]">busbar</span>
        </a>

        <div className="flex items-center gap-2 text-[13px]">
          <span className="font-semibold">{scene.project}</span>
          {scene.live ? null : (
            <span className="rounded-[4px] border border-rule-strong px-1.5 py-px text-[12px] text-mute">
              dev
            </span>
          )}
          {scene.live ? (
            <span
              className="rounded-[4px] border border-signal px-1.5 py-px text-[12px] font-semibold text-signal"
              title="Mirrors .busbar/ in this project. Read-only: the CLI makes every change."
            >
              Live
            </span>
          ) : (
            <span
              className="rounded-[4px] bg-paper px-1.5 py-px text-[12px] font-semibold text-ink"
              title="Synthetic run of the enquiry-to-paid stack. Nothing leaves this page."
            >
              Demo data
            </span>
          )}
        </div>

        <div className="order-last flex min-w-0 basis-full items-center gap-2 rounded-[5px] border border-rule bg-ink-2 py-1 pl-3 pr-1 lg:order-none lg:basis-auto lg:flex-1">
          <span className="font-mono text-[12.5px] text-signal" aria-hidden="true">
            $
          </span>
          <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-paper">
            {COMMAND}
          </code>
          <button
            type="button"
            className="bb-btn bb-btn--ghost h-7 px-2"
            aria-label={copied ? "Command copied" : "Copy command"}
            onClick={() => {
              navigator.clipboard.writeText(COMMAND).catch(() => {});
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            }}
          >
            <PikaIcon icon={copied ? CopyCopiedIcon : CopyIcon} size={15} strokeWidth={1.8} />
          </button>
        </div>

        {scene.live ? (
          <p className="ml-auto text-[12.5px] text-mute">
            Read-only. Run the command in your terminal.
          </p>
        ) : (
          <div className="ml-auto flex items-center gap-2">
            {phase === "planned" ? (
              <button type="button" className="bb-btn bb-btn--ghost" onClick={onDiscard}>
                Discard plan
              </button>
            ) : null}
            <button
              type="button"
              className={`bb-btn ${phase === "drift" ? "bb-btn--primary" : ""}`}
              disabled={phase !== "drift"}
              onClick={onPlan}
            >
              <PikaIcon icon={FileIcon} size={15} strokeWidth={1.8} />
              Plan
            </button>
            <button
              type="button"
              className={`bb-btn ${phase === "planned" ? "bb-btn--primary" : ""}`}
              disabled={phase !== "planned"}
              onClick={onApply}
            >
              <PikaIcon icon={PlayCircleIcon} size={15} strokeWidth={1.8} />
              Apply
            </button>
            <button
              type="button"
              className={`bb-btn ${phase === "applied" ? "bb-btn--primary" : ""}`}
              disabled={phase !== "applied" || busy}
              onClick={onVerify}
            >
              <PikaIcon icon={ShieldCheckIcon} size={15} strokeWidth={1.8} />
              Verify
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
