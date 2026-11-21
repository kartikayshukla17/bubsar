// The run model shared by the CLI and `bb ui`. The reducer's Actions are the run's event
// protocol: the CLI appends them to .busbar/events.jsonl, `bb ui` streams them, and the SPA
// reduces them exactly as it does in demo mode. Adding fields is fine; renaming forks replays.

export type Tier = "cli" | "api" | "web";
export type BayId = "plan" | "active" | "turn" | "cleared";
export type Mark =
  | "drift"
  | "planned"
  | "active"
  | "handoff"
  | "applied"
  | "checking"
  | "verified"
  | "unexercised"
  | "unknown";

export type Phase =
  | "drift"
  | "planned"
  | "applying"
  | "handoff"
  | "applied"
  | "verifying"
  | "verified";

/** Declared in busbar.toml, so plain strings. The demo fixture narrows them. */
export type DestinationId = string;
export type ValueId = string;

export type Destination = {
  id: DestinationId;
  name: string;
  where: string;
};

export type Value = {
  id: ValueId;
  kind: "URL" | "Secret" | "Token";
  secret: boolean;
  /** only for public values; secrets carry a fingerprint instead */
  literal?: string;
  fingerprint?: string;
  origin: string;
  routes: DestinationId[];
  /** resting route state when this value is not part of the run */
  rest: Mark;
};

export type Step = {
  id: string;
  destination: DestinationId;
  provider: string;
  field: string;
  tier: Tier;
  /** the entry there now; null until busbar has read the provider */
  from: string | null;
  /** the entry busbar will write */
  to: string;
  /** extra values this step writes besides tunnel.url */
  alsoWrites?: ValueId[];
  handoff?: boolean;
  activeNote: string;
  verify: { mark: "verified" | "unexercised"; note: string };
};

export type StripState = { bay: BayId | null; mark: Mark; fresh: boolean; note?: string };

export type BoardState = {
  phase: Phase;
  steps: Step[];
  strips: Record<string, StripState>;
  cursor: number; // next step index to apply
  focus: ValueId;
};

export function initialBoard(steps: Step[] = [], focus: ValueId = "tunnel.url"): BoardState {
  return {
    phase: "drift",
    steps,
    strips: Object.fromEntries(
      steps.map((s) => [s.id, { bay: null, mark: "drift", fresh: false }]),
    ),
    cursor: 0,
    focus,
  };
}

export type Action =
  /** `steps` is what the CLI planned; without it the board re-plans the steps it holds */
  | { type: "plan"; steps?: Step[] }
  | { type: "discard" }
  | { type: "start" }
  | { type: "activate"; id: string }
  | { type: "settle"; id: string }
  | { type: "handoff-done"; id: string }
  | { type: "apply-done" }
  | { type: "verify-start" }
  | { type: "check"; id: string }
  | { type: "checked"; id: string }
  | { type: "verify-done" }
  | { type: "focus"; value: ValueId }
  | { type: "reset" };

const patch = (s: BoardState, id: string, next: Partial<StripState>): BoardState => ({
  ...s,
  strips: { ...s.strips, [id]: { ...s.strips[id], fresh: false, ...next } },
});

export function reduce(s: BoardState, a: Action): BoardState {
  const find = (id: string) => s.steps.find((x) => x.id === id);
  switch (a.type) {
    case "plan": {
      const steps = a.steps ?? s.steps;
      return {
        ...s,
        phase: "planned",
        steps,
        strips: Object.fromEntries(
          steps.map((st) => [st.id, { bay: "plan", mark: "planned", fresh: false }]),
        ),
      };
    }
    case "discard":
      return initialBoard(s.steps, s.focus);
    case "start":
      return { ...s, phase: "applying" };
    case "activate":
      return patch(s, a.id, { bay: "active", mark: "active", note: find(a.id)?.activeNote });
    case "settle": {
      const idx = s.steps.findIndex((x) => x.id === a.id);
      if (find(a.id)?.handoff) {
        return {
          ...patch(s, a.id, { bay: "turn", mark: "handoff", fresh: true }),
          phase: "handoff",
          cursor: idx + 1,
        };
      }
      return {
        ...patch(s, a.id, { bay: "cleared", mark: "applied", fresh: true, note: undefined }),
        cursor: idx + 1,
      };
    }
    case "handoff-done":
      return {
        ...patch(s, a.id, { bay: "cleared", mark: "applied", fresh: true, note: undefined }),
        phase: "applying",
      };
    case "apply-done":
      return { ...s, phase: "applied" };
    case "verify-start":
      return { ...s, phase: "verifying" };
    case "check":
      return patch(s, a.id, { mark: "checking" });
    case "checked": {
      const step = find(a.id);
      return patch(s, a.id, {
        mark: step?.verify.mark ?? "verified",
        fresh: true,
        note: step?.verify.note,
      });
    }
    case "verify-done":
      return { ...s, phase: "verified" };
    case "focus":
      return { ...s, focus: a.value };
    case "reset":
      return initialBoard(s.steps);
  }
}

export function stepTouches(step: Step, value: ValueId) {
  return value === "tunnel.url" || (step.alsoWrites ?? []).includes(value);
}
