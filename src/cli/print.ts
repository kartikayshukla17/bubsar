import { changes, LIST_TITLE } from "../core/apply";
import type { Step } from "../core/board";
import type { Config } from "../core/config";
import type { Change, Diff, Entry } from "../core/diff";
import type { Lists } from "../core/recipes/google/console";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** `bb plan` output before busbar can read Google: every declared write, current unknown. */
export function printPlan(config: Config, steps: Step[]): string {
  const width = Math.max(...steps.map((s) => s.field.length));
  const lines = [`busbar plan · ${config.project.name}`, ""];
  const google = config.destinations.google;
  if (google) lines.push(`Google · OAuth web client ${google.client_id} in ${google.project_id}`);
  steps.forEach((s, i) => {
    const n = String(i + 1).padStart(2, "0");
    lines.push(`  ${n}  ${s.field.padEnd(width)}  ${s.from ?? "unknown"} → ${s.to}`);
  });
  lines.push(
    "",
    `${plural(steps.length, "write")} planned. Nothing has changed yet.`,
    "Current entries show as unknown: busbar hasn't read the console. Run bb login google, then bb plan again.",
    "",
  );
  return lines.join("\n");
}

const LABEL: Record<Change, string> = {
  add: "add",
  remove: "remove",
  keep: "keep",
  stale: "likely stale",
};

const WHY: Record<NonNullable<Entry["why"]>, string> = {
  "busbar added it": "busbar added it",
  adopted: "adopted with --adopt",
  "already there": "already there",
  "not busbar's": "not busbar's",
};

/**
 * `bb plan` output after reading the console: per list, every entry with what happens to
 * it and why. URLs are public and shown in full.
 */
export function printDiff(config: Config, d: Diff, browserName: string): string {
  const google = config.destinations.google;
  const lists: [string, Entry[]][] = [
    ["Authorized redirect URIs", d.redirectUris.entries],
    ["Authorized JavaScript origins", d.jsOrigins.entries],
  ];
  const all = lists.flatMap(([, e]) => e);
  const label = Math.max(...all.map((e) => LABEL[e.change].length));
  const url = Math.max(...all.map((e) => e.url.length));
  const lines = [`busbar plan · ${config.project.name}`, ""];
  if (google) lines.push(`Google · OAuth web client ${google.client_id} in ${google.project_id}`);
  lines.push(`Read just now from the Cloud console in busbar's ${browserName} profile.`);
  for (const [title, entries] of lists) {
    lines.push("", title);
    if (!entries.length) lines.push("  (empty)");
    for (const e of entries)
      lines.push(
        `  ${LABEL[e.change].padEnd(label)}  ${e.url.padEnd(url)}  ${e.why ? WHY[e.why] : ""}`.trimEnd(),
      );
  }
  const count = (c: Change) => all.filter((e) => e.change === c).length;
  const [adds, removes, stale] = [count("add"), count("remove"), count("stale")];
  lines.push("");
  if (adds + removes === 0)
    lines.push("Nothing to change: the client already has what busbar.toml declares.");
  else
    lines.push(
      `${plural(adds + removes, "change")} planned: ${adds} to add, ${removes} to remove. Nothing has changed yet.`,
    );
  if (stale)
    lines.push(
      `${plural(stale, "likely stale entry", "likely stale entries")} kept: on a tunnel host, but busbar didn't add ${stale === 1 ? "it" : "them"}. bb plan --adopt hands ${stale === 1 ? "it" : "them"} to busbar to remove.`,
    );
  lines.push("");
  return lines.join("\n");
}

export function printApply(config: Config, read: Lists, next: Lists, browserName: string): string {
  const google = config.destinations.google;
  const c = changes(read, next);
  const lines = [`busbar apply · ${config.project.name}`, ""];
  if (google) lines.push(`Google · OAuth web client ${google.client_id} in ${google.project_id}`);
  lines.push(`Read again just now in busbar's ${browserName} profile: unchanged since bb plan.`);
  for (const k of ["redirectUris", "jsOrigins"] as const) {
    lines.push("", LIST_TITLE[k]);
    if (!c[k].add.length && !c[k].remove.length) lines.push("  no changes");
    for (const url of c[k].add) lines.push(`  add     ${url}`);
    for (const url of c[k].remove) lines.push(`  remove  ${url}`);
  }
  lines.push("", "");
  return lines.join("\n");
}

export function printApplied(read: Lists, next: Lists): string {
  const c = changes(read, next);
  return [
    "Saved. Google's lists read back exactly as planned.",
    `${plural(c.adds + c.removes, "change")} applied: ${c.adds} added, ${c.removes} removed. Not verified: nothing has checked that Google accepts the new redirect URI yet.`,
    "",
  ].join("\n");
}
