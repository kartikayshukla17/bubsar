import type { CSSProperties } from "react";
import { PikaIcon, TIER } from "~/components/icons";
import { MarkLabel } from "~/components/mark";
import type { Step, StripState } from "~/lib/board";
import { short } from "~/lib/demo";

/**
 * A flight strip: one write busbar will make. Printed white stock in an ink holder.
 * Everything on it is 13px; rank comes from weight, case and reversal.
 */
export function Strip({
  step,
  index,
  total,
  state,
  dimmed = false,
  cocked = false,
  className = "",
}: {
  step: Step;
  /** 1-based position in the run, and the run's length */
  index: number;
  total: number;
  state: StripState;
  dimmed?: boolean;
  cocked?: boolean;
  className?: string;
}) {
  const tier = TIER[step.tier];
  const turn = state.mark === "handoff";
  const busy = state.mark === "active" || state.mark === "checking";

  const second = state.note ? (
    <span
      key={state.note}
      className={`t-swap ${busy ? "t-shimmer t-shimmer--paper" : "bb-strip__sub"}`}
    >
      {state.note}
    </span>
  ) : state.mark === "drift" || state.mark === "planned" ? (
    step.from === null ? (
      <span className="bb-strip__sub">Current entry not read yet</span>
    ) : (
      <span className="bb-strip__was">was {short(step.from)}</span>
    )
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
        <span className="bb-strip__value">{short(step.to)}</span>
        {second}
      </div>
      <div className="bb-strip__step">
        {String(index).padStart(2, "0")}
        <span className="bb-strip__sub">/{String(total).padStart(2, "0")}</span>
      </div>
      <div className={`bb-strip__mark ${turn ? "bb-strip__mark--turn" : ""}`}>
        <MarkLabel kind={state.mark} tone="paper" fresh={state.fresh} />
      </div>
    </article>
  );
}
