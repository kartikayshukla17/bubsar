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
 * Test-only flags. Without them headless Brave, even with Puppeteer's
 * `--disable-background-networking`, was seen calling Google Public DNS over HTTPS and
 * Brave's own hosts. Proven loopback-only with an lsof probe (BB-02 report).
 */
const LOOPBACK_ONLY = [
  // everything but loopback goes to a dead proxy, and no host name resolves
  "--proxy-server=http://127.0.0.1:9",
  "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
  // DNS-over-HTTPS can target an IP literal (8.8.8.8), which resolver rules don't cover
  "--disable-features=DnsOverHttps",
  // the browser's own background traffic
  "--disable-component-update",
  "--disable-domain-reliability",
  "--no-pings",
];

/**
 * puppeteer-core options for an automated session on busbar's profile. Chromium talks over
 * `--remote-debugging-pipe`, never a port another process could reach.
 *
 * `keychain: "real"` (production) drops Puppeteer's mock-keychain and basic-password-store
 * defaults, so the profile stays encrypted with the browser's own Keychain key, the same as
 * your everyday browser. `"mock"` exists only so tests never raise a Keychain prompt.
 *
 * `loopbackOnly` (tests only) keeps a test browser off the network, its own background
 * traffic included. See LOOPBACK_ONLY.
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
    args: o.loopbackOnly ? [...LOOPBACK_ONLY] : [],
  };
}
