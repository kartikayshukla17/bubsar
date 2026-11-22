import type { Action, CheckMark, Step } from "../board";
import type { Lists } from "../recipes/google/console";
import type { Check, GoogleState, Planned } from "../state";
import { type AuthAnswer, classify, type Verdict } from "./classify";
import { type Clock, poll } from "./poll";

const ASKING = "Asking Google whether it accepts this redirect URI";
const WAITING = "waiting for Google to pick up the change";
const NOT_YET = "Not accepted yet. Re-run `bb verify` later.";
const ORIGIN_NOTE = "Origin listed. This check doesn't exercise it; sign-in through the app would.";
const REMOVED_NOTE = "Entry removed. Nothing to check";
const NOT_ON_CLIENT = "Not on the client as busbar last read it, so it wasn't checked.";

export type VerifyIO = {
  ask(uri: string): Promise<AuthAnswer>;
  clock: Clock;
  emit(action: Action): void;
  record(check: Check): void;
  waiting(uri: string, ms: number): void;
};

export type UriResult = {
  uri: string;
  result: Check["result"];
  status: number | null;
  why: string;
  mark: CheckMark;
  note: string;
};

export type VerifyOutcome = { redirects: UriResult[]; origins: string[]; code: 0 | 3 };

export function exitCode(results: Check["result"][]): 0 | 3 {
  return results.every((r) => r === "accepted") ? 0 : 3;
}

export function targets(planned: Planned, owned: GoogleState["owned"]): Lists {
  const on = (k: keyof Lists) =>
    [...new Set([...planned.desired[k], ...owned[k]])].filter((u) => planned.read[k].includes(u));
  return { redirectUris: on("redirectUris"), jsOrigins: on("jsOrigins") };
}

const isRemoval = (s: Step) => s.to === "";
const isRedirect = (s: Step) => s.id.startsWith("google-redirect-") && !isRemoval(s);
const isOrigin = (s: Step) => s.id.startsWith("google-origin-") && !isRemoval(s);

export function stepsMatch(steps: Step[], want: Lists): boolean {
  return steps.every(
    (s) =>
      isRemoval(s) ||
      (isRedirect(s) && want.redirectUris.includes(s.to)) ||
      (isOrigin(s) && want.jsOrigins.includes(s.to)),
  );
}

function concluded(uri: string, verdict: Verdict): { mark: CheckMark; note: string } {
  switch (verdict.result) {
    case "accepted":
      return { mark: "verified", note: `Google accepted ${uri} as a redirect URI` };
    case "rejected":
      return { mark: "rejected", note: NOT_YET };
    case "unknown":
      return {
        mark: "unknown",
        note: `Couldn't tell: ${verdict.why}. Not verified; re-run \`bb verify\`.`,
      };
  }
}

export async function verifyGoogle(
  want: Lists,
  steps: Step[],
  waitMs: number,
  io: VerifyIO,
): Promise<VerifyOutcome> {
  io.emit({ type: "verify-start" });
  const deadline = io.clock.now() + waitMs;
  const redirects: UriResult[] = [];
  const done = new Set<string>();

  for (const uri of want.redirectUris) {
    const step = steps.find((s) => isRedirect(s) && s.to === uri);
    if (step) io.emit({ type: "check", id: step.id, note: ASKING });
    let status: number | null = null;
    let waited = false;
    const { verdict } = await poll(
      async () => {
        const answer = await io.ask(uri);
        const v = classify(answer);
        status = answer.status;
        io.record({
          at: new Date(io.clock.now()).toISOString(),
          uri,
          result: v.result,
          status,
        });
        return v;
      },
      deadline,
      io.clock,
      (ms) => {
        if (step && !waited) io.emit({ type: "check", id: step.id, note: WAITING });
        waited = true;
        io.waiting(uri, ms);
      },
    );
    const { mark, note } = concluded(uri, verdict);
    redirects.push({ uri, result: verdict.result, status, why: verdict.why, mark, note });
    if (step) {
      io.emit({ type: "checked", id: step.id, mark, note });
      done.add(step.id);
    }
  }

  const unchecked: Check["result"][] = [];
  for (const s of steps) {
    if (done.has(s.id)) continue;
    if (isOrigin(s)) io.emit({ type: "checked", id: s.id, mark: "unexercised", note: ORIGIN_NOTE });
    else if (isRemoval(s))
      io.emit({ type: "checked", id: s.id, mark: "unexercised", note: REMOVED_NOTE });
    else {
      io.emit({ type: "checked", id: s.id, mark: "unknown", note: NOT_ON_CLIENT });
      unchecked.push("unknown");
    }
  }
  io.emit({ type: "verify-done" });
  return {
    redirects,
    origins: want.jsOrigins,
    code: exitCode([...redirects.map((r) => r.result), ...unchecked]),
  };
}
