import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type BrowserId = "brave" | "dia" | "chrome" | "edge" | "firefox";
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
];

/** Browsers installed where busbar is built, so its tests and real-world checks run on them. */
const TESTED: BrowserId[] = ["brave", "dia"];

/** "Chrome (untested on this machine)" for a browser busbar hasn't been run against. */
export function label(b: { id: BrowserId; name: string }) {
  return TESTED.includes(b.id) ? b.name : `${b.name} (untested on this machine)`;
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
