import type { Step } from "./board";
import type { Config } from "./config";
import type { Diff } from "./diff";
import type { Lists } from "./recipes/google/console";

/** The CLI flag that supplies each `source = "arg"` value. */
export const FLAGS: Record<string, string> = { "tunnel.url": "--tunnel" };

/** A tunnel is an https origin: scheme and host, no path. A pasted trailing slash is dropped. */
function origin(id: string, raw: string): string {
  const bad = (why: string) =>
    new Error(
      `${FLAGS[id] ?? id} ${raw}: expected an https origin like https://abcd.ngrok-free.app, but ${why}`,
    );
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw bad("it isn't a URL");
  }
  if (url.protocol !== "https:") throw bad("it isn't https");
  if (url.pathname !== "/") throw bad(`it has a path (${url.pathname})`);
  if (url.search) throw bad(`it has a query (${url.search})`);
  if (url.hash) throw bad(`it has a fragment (${url.hash})`);
  return url.origin;
}

/** Every declared value, checked and normalized. Throws naming the flag that's missing or bad. */
export function resolveValues(
  config: Config,
  values: Record<string, string>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const id of Object.keys(config.values)) {
    const raw = values[id];
    if (raw === undefined) throw new Error(`${id} has no value: pass ${FLAGS[id] ?? id} <url>`);
    resolved[id] = origin(id, raw);
  }
  return resolved;
}

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{([^{}]+)\}/g, (_, id: string) => values[id]);

/** The entries busbar.toml wants in the OAuth client, templates filled in, in declared order. */
export function desiredLists(config: Config, values: Record<string, string>): Lists {
  const resolved = resolveValues(config, values);
  const google = config.destinations.google;
  return {
    redirectUris: (google?.redirect_uris ?? []).map((t) => fill(t, resolved)),
    jsOrigins: (google?.js_origins ?? []).map((t) => fill(t, resolved)),
  };
}

type Kind = "redirect" | "origin";

const step = (kind: Kind, id: string, from: string | null, to: string): Step => ({
  id,
  destination: "google",
  provider: "Google",
  field: kind === "redirect" ? "Authorized redirect URI" : "Authorized JavaScript origin",
  tier: "web",
  from,
  to,
  activeNote: "Editing your OAuth web client in your sandbox browser",
  verify:
    to === ""
      ? { mark: "unexercised", note: "Entry removed. Nothing to check" }
      : kind === "redirect"
        ? { mark: "verified", note: "Google accepted the redirect_uri" }
        : { mark: "unexercised", note: "Origin listed. Sign-in not exercised" },
});

/**
 * One list's strips. Adds keep their place in the desired list (`google-redirect-2` is the
 * second declared redirect URI); each add replaces the next removal, in list order; removals
 * left over get their own strips (`google-redirect-remove-1`, …). Entries already there need
 * no strip. Returns the list's likely-stale entries too, for the strip notes.
 */
function listSteps(kind: Kind, desired: string[], d: Diff[keyof Diff]) {
  const of = (c: string) => d.entries.filter((e) => e.change === c).map((e) => e.url);
  const removes = of("remove");
  const steps = of("add").map((to, i) =>
    step(kind, `google-${kind}-${desired.indexOf(to) + 1}`, removes[i] ?? "", to),
  );
  for (const [i, from] of removes.slice(steps.length).entries())
    steps.push(step(kind, `google-${kind}-remove-${i + 1}`, from, ""));
  return { steps, stale: of("stale") };
}

/**
 * Likely-stale entries ride on their list's first strip as its note, or on the run's first
 * strip when their list has none, so the board shows them whenever it shows anything.
 */
function noteStale(lists: { steps: Step[]; stale: string[] }[]): Step[] {
  const steps = lists.flatMap((l) => l.steps);
  const notes = new Map<Step, string[]>();
  for (const { steps: own, stale } of lists) {
    const on = own[0] ?? steps[0];
    if (on && stale.length) notes.set(on, [...(notes.get(on) ?? []), ...stale]);
  }
  for (const [s, urls] of notes) s.note = `Likely stale, kept: ${urls.join(", ")}`;
  return steps;
}

/**
 * The writes busbar would make, in order. Without `read`, nothing has been read from Google
 * yet, so every step is a write of the declared entry with `from` null. With `read` (the diff
 * against what the console shows), only real changes become steps.
 */
export function plan(config: Config, values: Record<string, string>, read?: Diff): Step[] {
  const desired = desiredLists(config, values);
  if (!config.destinations.google) return [];
  if (read)
    return noteStale([
      listSteps("redirect", desired.redirectUris, read.redirectUris),
      listSteps("origin", desired.jsOrigins, read.jsOrigins),
    ]);
  return [
    ...desired.redirectUris.map((to, i) => step("redirect", `google-redirect-${i + 1}`, null, to)),
    ...desired.jsOrigins.map((to, i) => step("origin", `google-origin-${i + 1}`, null, to)),
  ];
}
