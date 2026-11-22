import type { Action, Step } from "./board";
import type { Config } from "./config";
import { diff } from "./diff";
import { type Consoles, type Stopped, withHandoff } from "./handoff";
import { plan } from "./plan";
import {
  type GoogleConsole,
  type Lists,
  ReauthRequired,
  sameList,
  sameLists,
} from "./recipes/google/console";
import type { Planned } from "./state";

export type ApplyIO = {
  show(read: Lists, next: Lists): void;
  confirm(changes: number): Promise<boolean>;
  saved(saved: Lists, asPlanned: boolean): void;
  emit(action: Action): void;
};

export type ApplyOutcome =
  | { result: "changed"; read: Lists }
  | { result: "declined" }
  | { result: "refused"; error: Error }
  | { result: "applied"; saved: Lists }
  | { result: "landed"; saved: Lists }
  | { result: "failed"; error: Error }
  | Stopped;

const KEYS = ["redirectUris", "jsOrigins"] as const;
export const LIST_TITLE: Record<keyof Lists, string> = {
  redirectUris: "Authorized redirect URIs",
  jsOrigins: "Authorized JavaScript origins",
};

export function changes(read: Lists, next: Lists) {
  const per = (k: keyof Lists) => ({
    add: next[k].filter((u) => !read[k].includes(u)),
    remove: read[k].filter((u) => !next[k].includes(u)),
  });
  const lists = { redirectUris: per("redirectUris"), jsOrigins: per("jsOrigins") };
  const count = (c: "add" | "remove") => KEYS.reduce((n, k) => n + lists[k][c].length, 0);
  return { ...lists, adds: count("add"), removes: count("remove") };
}

export function ownedAfter(owned: Lists, read: Lists, next: Lists, saved: Lists): Lists {
  const c = changes(read, next);
  const list = (k: keyof Lists) => {
    const gone = c[k].remove.filter((u) => !saved[k].includes(u));
    const added = c[k].add.filter((u) => saved[k].includes(u));
    return [...new Set([...owned[k].filter((u) => !gone.includes(u)), ...added])];
  };
  return { redirectUris: list("redirectUris"), jsOrigins: list("jsOrigins") };
}

/** Treating exactly the planned removals as owned makes the diff reproduce bb plan's steps. */
export function plannedSteps(config: Config, planned: Planned): Step[] {
  const c = changes(planned.read, planned.next);
  const removals = { redirectUris: c.redirectUris.remove, jsOrigins: c.jsOrigins.remove };
  return plan(
    config,
    planned.values,
    diff(planned.read, planned.desired, removals, { adopt: false }),
  );
}

const show = (urls: string[]) => (urls.length ? urls.join(", ") : "(empty)");

export function mismatch(saved: Lists, next: Lists) {
  const lists = KEYS.filter((k) => !sameList(saved[k], next[k])).map(
    (k) => `${LIST_TITLE[k]} are ${show(saved[k])} (planned: ${show(next[k])})`,
  );
  return `Saved, but Google shows a different list: ${lists.join("; ")}.`;
}

/**
 * A Save Google confirmed but busbar couldn't read back: its adds count as there, its
 * removals not yet as gone. Ownership from this never claims more than was proven.
 */
function knownAfterSave(read: Lists, next: Lists): Lists {
  const both = (k: keyof Lists) => [...new Set([...read[k], ...next[k]])];
  return { redirectUris: both("redirectUris"), jsOrigins: both("jsOrigins") };
}

export async function applyPlan(
  c: Consoles,
  planned: Planned,
  steps: Step[],
  io: ApplyIO,
): Promise<ApplyOutcome> {
  let confirmed = false;
  let unread = false;
  const settled = (result: "applied" | "landed", saved: Lists): ApplyOutcome => {
    for (const s of steps) io.emit({ type: "settle", id: s.id });
    io.emit({ type: "apply-done" });
    return { result, saved };
  };
  const readBack = (saved: Lists): ApplyOutcome => {
    const asPlanned = sameLists(saved, planned.next);
    io.saved(saved, asPlanned);
    if (!asPlanned) return fail(new Error(mismatch(saved, planned.next)));
    return settled("applied", saved);
  };
  const fail = (error: Error): ApplyOutcome => {
    for (const s of steps) io.emit({ type: "fail", id: s.id, note: error.message });
    return { result: "failed", error };
  };

  const attempt = async (gc: GoogleConsole, round: number): Promise<ApplyOutcome> => {
    const read = await gc.read();
    if (unread) return readBack(read);
    if (round > 0) io.emit({ type: "plan" });
    if (!sameLists(read, planned.read)) {
      if (!sameLists(read, planned.next)) return { result: "changed", read };
      io.saved(read, true);
      io.emit({ type: "start" });
      return settled("landed", read);
    }
    if (!confirmed) {
      io.show(read, planned.next);
      const n = changes(read, planned.next);
      try {
        if (!(await io.confirm(n.adds + n.removes))) return { result: "declined" };
      } catch (e) {
        return { result: "refused", error: e as Error };
      }
      confirmed = true;
    }
    io.emit({ type: "start" });
    for (const s of steps) io.emit({ type: "activate", id: s.id });
    try {
      return readBack((await gc.write(planned.next)).saved);
    } catch (e) {
      if (e instanceof ReauthRequired && e.afterSave) {
        unread = true;
        io.saved(knownAfterSave(read, planned.next), false);
      }
      throw e;
    }
  };

  try {
    return await withHandoff(c, steps, io.emit, attempt);
  } catch (e) {
    return fail(e as Error);
  }
}
