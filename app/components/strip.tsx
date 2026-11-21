import type { CSSProperties } from "react";
import { MarkLabel } from "~/components/mark";
import { PikaIcon, TIER } from "~/components/icons";
import { NEW_TUNNEL, OLD_TUNNEL, STEPS, type Step, type StripState, short } from "~/lib/board";

function valueLine(step: Step, url: string) {
  if (step.destination === "agent-env" || step.destination === "google") return short(url);
  return `${short(url)}${step.path}`;
}

/**
 * A flight strip: one write busbar will make. Printed white stock in an ink holder.
 * Everything on it is 13px; rank comes from weight, case and reversal.
 */
export function Strip({
  step,
  state,
  dimmed = false,
  cocked = false,
  className = "",
}: {
  step: Step;
  state: StripState;
  dimmed?: boolean;
  cocked?: boolean;
  className?: string;
}) {
  const tier = TIER[step.tier];
  const index = STEPS.findIndex((s) => s.id === step.id) + 1;
  const turn = state.mark === "handoff";
  const busy = state.mark === "active" || state.mark === "checking";

  const second = state.note ? (
    <span key={state.note} className={`t-swap ${busy ? "t-shimmer t-shimmer--paper" : "bb-strip__sub"}`}>
      {state.note}
    </span>
  ) : state.mark === "drift" || state.mark === "planned" ? (
    <span className="bb-strip__was">was {valueLine(step, OLD_TUNNEL)}</span>
  ) : (
    <span className="bb-strip__sub">Written, not yet verified</span>
  );

  return (
    <article
      className={`bb-strip ${className}`}
      data-dimmed={dimmed ? "true" : undefined}
      data-cocked={cocked ? "true" : undefined}
      style={{ viewTransitionName: `strip-${step.id}` } as CSSProperties}
      aria-label={`${step.provider}, ${step.field}: ${state.mark}`}
    >
      <div className="bb-strip__holder" title={tier.label}>
        <PikaIcon icon={tier.icon} size={16} strokeWidth={1.8} />
        <span>{tier.code}</span>
      </div>
      <div className="bb-strip__callcell">
        <span className="bb-strip__call">{step.provider}</span>
        <span className="bb-strip__sub">{step.field}</span>
      </div>
      <div className="bb-strip__route">
        <span className="bb-strip__value">{valueLine(step, NEW_TUNNEL)}</span>
        {second}
      </div>
      <div className="bb-strip__step">
        {String(index).padStart(2, "0")}
        <span className="bb-strip__sub">/{String(STEPS.length).padStart(2, "0")}</span>
      </div>
      <div className={`bb-strip__mark ${turn ? "bb-strip__mark--turn" : ""}`}>
        <MarkLabel kind={state.mark} tone="paper" fresh={state.fresh} />
      </div>
    </article>
  );
}
