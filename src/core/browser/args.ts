import type { LaunchOptions } from "puppeteer-core";
import type { InstalledBrowser } from "./browsers";

/**
 * The un-automated window: what you sign into, and what handoffs open. A plain process on
 * busbar's profile, so Google sees an ordinary browser: no debugging pipe or port, no
 * automation flag, the browser's own Keychain encryption.
 */
export function plainLaunchArgs(browser: InstalledBrowser, profileDir: string, url: string) {
  if (browser.engine !== "chromium") throw new Error(`busbar doesn't drive ${browser.name} yet.`);
  return [`--user-data-dir=${profileDir}`, "--no-first-run", "--no-default-browser-check", url];
}

/**
 * puppeteer-core options for an automated session on busbar's profile. Chromium talks over
 * `--remote-debugging-pipe`, never a port another process could reach.
 *
 * `keychain: "real"` (production) drops Puppeteer's mock-keychain and basic-password-store
 * defaults, so the profile stays encrypted with the browser's own Keychain key, the same as
 * your everyday browser. `"mock"` exists only so tests never raise a Keychain prompt.
 *
 * `loopbackOnly` (tests only) routes everything but 127.0.0.1 to a dead proxy and stops
 * DNS, so a test browser can't reach Google or anything else, even through the browser's
 * own background traffic (Brave's DNS-over-HTTPS, updaters).
 */
export function automationLaunchOptions(
  browser: InstalledBrowser,
  profileDir: string,
  o: { headless: boolean; keychain: "real" | "mock"; loopbackOnly?: boolean },
): LaunchOptions {
  return {
    executablePath: browser.executable,
    userDataDir: profileDir,
    pipe: true,
    headless: o.headless,
    defaultViewport: null,
    ignoreDefaultArgs:
      o.keychain === "real" ? ["--use-mock-keychain", "--password-store=basic"] : [],
    args: o.loopbackOnly
      ? [
          "--proxy-server=http://127.0.0.1:9",
          "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
        ]
      : [],
  };
}
