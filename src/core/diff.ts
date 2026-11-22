import type { Lists } from "./recipes/google/console";

/**
 * Ownership and diff: what `bb plan` does to each entry of the OAuth client's lists. Pure.
 *
 * - desired, missing → add
 * - desired, present → keep ("already there"), no step
 * - not desired, busbar owns it (state.json) → remove
 * - not desired, not owned, on a tunnel host → kept, flagged likely stale; `--adopt` removes it
 * - not desired, not owned → keep, never touched
 */
export type Change = "add" | "remove" | "keep" | "stale";
export type Why = "busbar added it" | "adopted" | "already there" | "not busbar's";
export type Entry = { url: string; change: Change; why?: Why };
/** `next` is the list as it will be after the changes: current order, removals out, adds last. */
export type ListDiff = { entries: Entry[]; next: string[] };
export type Diff = Record<keyof Lists, ListDiff>;

/**
 * Hosts that hand out throwaway tunnel subdomains. An entry on one that busbar didn't add is
 * probably an old tunnel. Only subdomains count: the bare domain is the vendor's own site.
 */
export const TUNNEL_DOMAINS = [
  "ngrok-free.app",
  "ngrok-free.dev",
  "ngrok.app",
  "ngrok.dev",
  "ngrok.io",
  "trycloudflare.com",
  "loca.lt",
];

export function isTunnel(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return TUNNEL_DOMAINS.some((d) => host.endsWith(`.${d}`));
}

const ORDER: Change[] = ["add", "remove", "keep", "stale"];

function diffList(current: string[], desired: string[], owned: string[], adopt: boolean): ListDiff {
  const entries: Entry[] = [...new Set(desired)]
    .filter((u) => !current.includes(u))
    .map((url) => ({ url, change: "add" }));
  for (const url of current) {
    if (desired.includes(url)) entries.push({ url, change: "keep", why: "already there" });
    else if (owned.includes(url)) entries.push({ url, change: "remove", why: "busbar added it" });
    else if (!isTunnel(url)) entries.push({ url, change: "keep", why: "not busbar's" });
    else if (adopt) entries.push({ url, change: "remove", why: "adopted" });
    else entries.push({ url, change: "stale", why: "not busbar's" });
  }
  const urls = (c: Change) => entries.filter((e) => e.change === c).map((e) => e.url);
  const removed = urls("remove");
  return {
    entries: ORDER.flatMap((c) => entries.filter((e) => e.change === c)),
    next: [...current.filter((u) => !removed.includes(u)), ...urls("add")],
  };
}

export function diff(current: Lists, desired: Lists, owned: Lists, o: { adopt: boolean }): Diff {
  return {
    redirectUris: diffList(current.redirectUris, desired.redirectUris, owned.redirectUris, o.adopt),
    jsOrigins: diffList(current.jsOrigins, desired.jsOrigins, owned.jsOrigins, o.adopt),
  };
}

/** Both lists as they will be after the changes. */
export function nextLists(d: Diff): Lists {
  return { redirectUris: d.redirectUris.next, jsOrigins: d.jsOrigins.next };
}
