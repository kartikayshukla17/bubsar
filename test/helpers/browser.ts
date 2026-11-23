import { spawnSync } from "node:child_process";
import { detectBrowsers, type InstalledBrowser } from "../../src/core/browser/browsers";

const appBundle = (b: InstalledBrowser) =>
  b.executable.slice(0, b.executable.indexOf(".app/") + ".app".length);

/**
 * The installed browsers seam-2 tests may launch. Brave always: with `loopbackOnly`, an lsof
 * probe showed it on loopback only. Dia never: its own app networking ignores Chromium's
 * proxy and resolver flags (BB-02 report). Firefox only with `BB_TEST_FIREFOX=1`, and never
 * while its bundle is quarantined: the first exec of a quarantined app made Gatekeeper launch
 * a second, headed Firefox on a default profile, online (BB-08 report).
 */
export function pickTestBrowsers(
  installed: InstalledBrowser[],
  env: Record<string, string | undefined>,
  quarantined: (app: string) => boolean,
): { browsers: InstalledBrowser[]; skipped: string[] } {
  const browsers = installed.filter((b) => b.id === "brave");
  const skipped: string[] = [];
  const firefox = installed.find((b) => b.id === "firefox");
  if (firefox) {
    const app = appBundle(firefox);
    if (env.BB_TEST_FIREFOX !== "1")
      skipped.push("Firefox skipped: set BB_TEST_FIREFOX=1 to run seam 2 on it");
    else if (quarantined(app))
      skipped.push(
        `Firefox skipped: ${app} is quarantined (com.apple.quarantine), so a test launch could be its first and start Gatekeeper's own Firefox. Open it once by hand and clear the flag (xattr -d com.apple.quarantine ${app}), then set BB_TEST_FIREFOX=1.`,
      );
    else browsers.push(firefox);
  }
  return { browsers, skipped };
}

type Run = (
  cmd: string,
  args: string[],
) => { status: number | null; stderr: string; error?: Error };

const xattr: Run = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" });

/** Fails closed: only xattr's own "No such xattr" answer means the flag is absent. */
export function isQuarantined(app: string, run: Run = xattr) {
  const r = run("/usr/bin/xattr", ["-p", "com.apple.quarantine", app]);
  return !(r.status === 1 && !r.error && /No such xattr/.test(r.stderr ?? ""));
}

export const { browsers: testBrowsers, skipped: skippedBrowsers } = pickTestBrowsers(
  detectBrowsers(["/Applications"]),
  process.env,
  isQuarantined,
);
