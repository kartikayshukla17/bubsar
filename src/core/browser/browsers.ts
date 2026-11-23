import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type BrowserId =
  | "brave"
  | "dia"
  | "chrome"
  | "edge"
  | "firefox"
  | "firefox-dev"
  | "firefox-nightly";
export type InstalledBrowser = {
  id: BrowserId;
  name: string;
  executable: string;
  engine: "chromium" | "firefox";
};

/** Every browser busbar knows, in the order it lists them, by its macOS bundle path. */
export const KNOWN: {
  id: BrowserId;
  name: string;
  bundle: string;
  engine: "chromium" | "firefox";
}[] = [
  {
    id: "brave",
    name: "Brave",
    bundle: "Brave Browser.app/Contents/MacOS/Brave Browser",
    engine: "chromium",
  },
  { id: "dia", name: "Dia", bundle: "Dia.app/Contents/MacOS/Dia", engine: "chromium" },
  {
    id: "chrome",
    name: "Chrome",
    bundle: "Google Chrome.app/Contents/MacOS/Google Chrome",
    engine: "chromium",
  },
  {
    id: "edge",
    name: "Edge",
    bundle: "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    engine: "chromium",
  },
  {
    id: "firefox",
    name: "Firefox",
    bundle: "Firefox.app/Contents/MacOS/firefox",
    engine: "firefox",
  },
  {
    id: "firefox-dev",
    name: "Firefox Developer Edition",
    bundle: "Firefox Developer Edition.app/Contents/MacOS/firefox",
    engine: "firefox",
  },
  {
    id: "firefox-nightly",
    name: "Firefox Nightly",
    bundle: "Firefox Nightly.app/Contents/MacOS/firefox",
    engine: "firefox",
  },
];

/**
 * What busbar's own browser tests proved on the machine it's built on. Brave runs every
 * seam-2 test. Firefox ran the recipe and driver tests once, but not the later BiDi-close and
 * prefs-restore tests (its bundle is quarantined here). Dia never ran: it leaks network past
 * every launch flag, so tests don't launch it.
 */
const TESTED: Partial<Record<BrowserId, string>> = {
  brave: "",
  firefox: " (partly tested on this machine)",
};

export function label(b: { id: BrowserId; name: string }) {
  return `${b.name}${TESTED[b.id] ?? " (untested on this machine)"}`;
}

/** Where to look for apps: `BB_APPLICATIONS` (colon-separated), else the two usual folders. */
export function applicationRoots(env = process.env) {
  const raw = env.BB_APPLICATIONS ?? "/Applications:~/Applications";
  return raw.split(":").map((r) => (r.startsWith("~/") ? join(homedir(), r.slice(2)) : r));
}

/** Installed browsers, found by bundle path. The first root holding a browser wins. */
export function detectBrowsers(roots: string[]): InstalledBrowser[] {
  return KNOWN.flatMap(({ bundle, ...b }) => {
    for (const root of roots) {
      const executable = join(root, bundle);
      if (existsSync(executable) && statSync(executable).isFile()) return [{ ...b, executable }];
    }
    return [];
  });
}
