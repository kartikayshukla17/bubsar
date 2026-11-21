import type { Step } from "./board";
import type { Config } from "./config";

/** The CLI flag that supplies each `source = "arg"` value. */
export const FLAGS: Record<string, string> = { "tunnel.url": "--tunnel" };

/** A tunnel is an https origin: scheme and host, no path. A pasted trailing slash is dropped. */
function origin(id: string, raw: string): string {
  const flag = FLAGS[id] ?? id;
  const bad = new Error(
    `${flag} ${raw}: expected an https origin like https://abcd.ngrok-free.app`,
  );
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw bad;
  }
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) throw bad;
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

/**
 * The writes busbar would make, in order. Pure: reads nothing, so every `from` is null
 * until a later slice reads the provider's current state.
 */
export function plan(config: Config, values: Record<string, string>): Step[] {
  const resolved = resolveValues(config, values);
  const google = config.destinations.google;
  if (!google) return [];
  const entry = (kind: "redirect" | "origin", template: string, i: number): Step => ({
    id: `google-${kind}-${i + 1}`,
    destination: "google",
    provider: "Google",
    field: kind === "redirect" ? "Authorized redirect URI" : "Authorized JavaScript origin",
    tier: "web",
    from: null,
    to: fill(template, resolved),
    activeNote: "Editing your OAuth web client in your sandbox browser",
    verify:
      kind === "redirect"
        ? { mark: "verified", note: "Google accepted the redirect_uri" }
        : { mark: "unexercised", note: "Origin listed. Sign-in not exercised" },
  });
  return [
    ...google.redirect_uris.map((t, i) => entry("redirect", t, i)),
    ...google.js_origins.map((t, i) => entry("origin", t, i)),
  ];
}
