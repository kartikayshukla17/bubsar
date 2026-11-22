import type { ApplyOutcome } from "./apply";
import type { Step } from "./board";
import type { Ending } from "./exit";
import type { Stopped } from "./handoff";
import { type Lists, sameLists } from "./recipes/google/console";
import type { Check, GoogleState, Planned } from "./state";
import type { VerifyOutcome } from "./verify/verify";

export type RewireIO = {
  plan(): Promise<{ planned: Planned; steps: Step[] } | Stopped>;
  apply(planned: Planned, steps: Step[]): Promise<ApplyOutcome>;
  verify(steps: Step[]): Promise<VerifyOutcome>;
};

type NotApplied = Exclude<ApplyOutcome, { result: "applied" | "landed" | "stopped" }>;

export type RewireOutcome =
  | { result: "wired" }
  | { result: "stopped"; at: "plan" | "apply"; stopped: Stopped }
  | { result: "failed"; apply: NotApplied }
  | { result: "checked"; verify: VerifyOutcome };

export async function rewire(io: RewireIO): Promise<RewireOutcome> {
  const planning = await io.plan();
  if ("result" in planning) return { result: "stopped", at: "plan", stopped: planning };
  if (!planning.steps.length) return { result: "wired" };
  const applied = await io.apply(planning.planned, planning.steps);
  switch (applied.result) {
    case "applied":
    case "landed":
      return { result: "checked", verify: await io.verify(planning.steps) };
    case "stopped":
      return { result: "stopped", at: "apply", stopped: applied };
    default:
      return { result: "failed", apply: applied };
  }
}

export function rewireEnding(o: Exclude<RewireOutcome, { result: "wired" }>): Ending {
  switch (o.result) {
    case "stopped":
      return { ended: "stopped" };
    case "failed":
      return { ended: "failed" };
    case "checked":
      return { ended: "finished", required: o.verify.required };
  }
}

/**
 * True when state.json alone settles it: the last plan was for these values and this
 * busbar.toml, nothing was left to change, and busbar's last read or read-back of the client
 * held every entry busbar.toml wants. It says nothing about the client since that read.
 */
export function alreadyWired(g: GoogleState, values: Record<string, string>, desired: Lists) {
  const p = g.planned;
  if (!p?.values || !p.desired) return false;
  const keys = Object.keys(values);
  const sameValues =
    keys.length === Object.keys(p.values).length && keys.every((k) => p.values[k] === values[k]);
  const held = (k: keyof Lists) => desired[k].every((u) => p.read[k].includes(u));
  return (
    sameValues &&
    sameLists(p.desired, desired) &&
    sameLists(p.read, p.next) &&
    held("redirectUris") &&
    held("jsOrigins")
  );
}

export function latestChecks(checks: Check[], uris: string[]) {
  return uris.map((uri) => ({
    uri,
    result: checks.filter((c) => c.uri === uri).at(-1)?.result ?? null,
  }));
}
