import type { Action, Step } from "./board";
import type { Config } from "./config";
import { diff } from "./diff";
import { plan } from "./plan";
import { type GoogleConsole, type Lists, sameList, sameLists } from "./recipes/google/console";
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
  | { result: "applied"; saved: Lists }
  | { result: "failed"; error: Error };

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

export async function applyPlan(
  gc: GoogleConsole,
  planned: Planned,
  steps: Step[],
  io: ApplyIO,
): Promise<ApplyOutcome> {
  const fail = (error: Error): ApplyOutcome => {
    for (const s of steps) io.emit({ type: "fail", id: s.id, note: error.message });
    return { result: "failed", error };
  };
  let read: Lists;
  try {
    read = await gc.read();
  } catch (e) {
    return fail(e as Error);
  }
  if (!sameLists(read, planned.read)) return { result: "changed", read };

  io.show(read, planned.next);
  const c = changes(read, planned.next);
  if (!(await io.confirm(c.adds + c.removes))) return { result: "declined" };

  io.emit({ type: "start" });
  for (const s of steps) io.emit({ type: "activate", id: s.id });
  let saved: Lists;
  try {
    ({ saved } = await gc.write(planned.next));
  } catch (e) {
    return fail(e as Error);
  }
  const asPlanned = sameLists(saved, planned.next);
  io.saved(saved, asPlanned);
  if (!asPlanned) return fail(new Error(mismatch(saved, planned.next)));
  for (const s of steps) io.emit({ type: "settle", id: s.id });
  io.emit({ type: "apply-done" });
  return { result: "applied", saved };
}
