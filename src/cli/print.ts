import { changes, LIST_TITLE } from "../core/apply";
import type { Step } from "../core/board";
import type { Config } from "../core/config";
import type { Change, Diff, Entry } from "../core/diff";
import type { Lists } from "../core/recipes/google/console";
import type { UriResult, VerifyOutcome } from "../core/verify/verify";

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
export function printDiff(
  config: Config,
  d: Diff,
  browserName: string,
  command: "plan" | "rewire" = "plan",
): string {
  const google = config.destinations.google;
  const lists: [string, Entry[]][] = [
    ["Authorized redirect URIs", d.redirectUris.entries],
    ["Authorized JavaScript origins", d.jsOrigins.entries],
  ];
  const all = lists.flatMap(([, e]) => e);
  const label = Math.max(...all.map((e) => LABEL[e.change].length));
  const url = Math.max(...all.map((e) => e.url.length));
  const lines = [`busbar ${command} · ${config.project.name}`, ""];
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

const appliedLine = (read: Lists, next: Lists) => {
  const c = changes(read, next);
  return `${plural(c.adds + c.removes, "change")} applied: ${c.adds} added, ${c.removes} removed. Not verified: nothing has checked that Google accepts the new redirect URI yet.`;
};

export function printApplied(read: Lists, next: Lists): string {
  return ["Saved. Google's lists read back exactly as planned.", appliedLine(read, next), ""].join(
    "\n",
  );
}

export function printLanded(read: Lists, next: Lists): string {
  return [
    "Google already holds exactly the planned lists: an earlier Save landed. busbar recorded its entries and wrote nothing.",
    appliedLine(read, next),
    "",
  ].join("\n");
}

export function printVerifyHead(config: Config): string {
  const google = config.destinations.google;
  const lines = [`busbar verify · ${config.project.name}`, ""];
  if (google) lines.push(`Google · OAuth web client ${google.client_id} in ${google.project_id}`);
  lines.push(
    "Asked Google's authorize endpoint directly, signed out: no browser, no session.",
    "",
    "",
  );
  return lines.join("\n");
}

const VERDICT_LABEL: Record<UriResult["result"], string> = {
  accepted: "verified",
  rejected: "not accepted",
  unknown: "unknown",
};
const COL = 15;

export function printVerified(out: VerifyOutcome): string {
  const pad = " ".repeat(COL + 2);
  const lines = [LIST_TITLE.redirectUris];
  for (const r of out.redirects) {
    lines.push(`  ${VERDICT_LABEL[r.result].padEnd(COL)}${r.uri}`);
    const status = r.status === null ? "" : ` (HTTP ${r.status})`;
    lines.push(`${pad}${r.why}${status}.${r.result === "rejected" ? " Not accepted yet." : ""}`);
  }
  if (out.origins.length) {
    lines.push("", LIST_TITLE.jsOrigins);
    for (const o of out.origins) lines.push(`  ${"not exercised".padEnd(COL)}${o}`);
    lines.push(`${pad}This check doesn't exercise origins; sign-in through the app would.`);
  }
  const count = (r: UriResult["result"]) => out.redirects.filter((x) => x.result === r).length;
  const said: string[] = [];
  if (out.code === 0)
    said.push(`Verified: Google accepts ${plural(count("accepted"), "redirect URI")}.`);
  if (count("rejected"))
    said.push(
      `Not accepted yet: ${plural(count("rejected"), "redirect URI")}. Google can take minutes or longer to pick up a change. Re-run \`bb verify\` later.`,
    );
  if (count("unknown"))
    said.push(
      `Not verified: busbar couldn't tell for ${plural(count("unknown"), "redirect URI")}. Re-run \`bb verify\`.`,
    );
  if (out.origins.length)
    said.push(`${plural(out.origins.length, "origin")} listed, not exercised.`);
  lines.push("", said.join(" "), "");
  return lines.join("\n");
}

const clock = (iso: string) => new Date(iso).toTimeString().slice(0, 5);

function rewiredVerdict(r: UriResult): string {
  switch (r.result) {
    case "accepted":
      return `verified (Google accepted it ${clock(r.at)})`;
    case "rejected":
      return `not accepted yet (${r.why} at ${clock(r.at)}). Re-run \`bb verify\` later.`;
    case "unknown":
      return `unknown, not verified (${r.why}). Re-run \`bb verify\`.`;
  }
}

function ownership(d: Diff): string | null {
  const all = [...d.redirectUris.entries, ...d.jsOrigins.entries];
  const removed = all.filter((e) => e.change === "remove").length;
  const kept = all.filter((e) => e.why === "not busbar's").length;
  const said: string[] = [];
  if (removed)
    said.push(`Removed ${plural(removed, "old entry", "old entries")} busbar had added.`);
  if (kept) {
    const what = removed ? String(kept) : plural(kept, "entry", "entries");
    said.push(`Kept ${what} that ${kept === 1 ? "isn't" : "aren't"} busbar's.`);
  }
  return said.length ? said.join(" ") : null;
}

export function printRewired(d: Diff, out: VerifyOutcome): string {
  const lines = [""];
  for (const r of out.redirects)
    lines.push(`Google · redirect URI ${r.uri} · ${rewiredVerdict(r)}`);
  for (const o of out.origins) lines.push(`Google · JS origin ${o} · listed, not exercised`);
  const owned = ownership(d);
  if (owned) lines.push(owned);
  lines.push("");
  return lines.join("\n");
}
