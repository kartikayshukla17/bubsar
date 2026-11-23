import type { LaunchOptions } from "puppeteer-core";
import type { InstalledBrowser } from "./browsers";

/**
 * The un-automated window: what you sign into, and what handoffs open. A plain process on
 * busbar's profile, so Google sees an ordinary browser: no debugging pipe or port, no
 * automation flag, the browser's own Keychain encryption.
 */
export function plainLaunchArgs(browser: InstalledBrowser, profileDir: string, url: string) {
  if (browser.engine === "firefox") return ["-profile", profileDir, "-no-remote", url];
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
 * The same for Firefox, as prefs. Puppeteer's own test prefs already stub remote settings,
 * Safe Browsing and health reports; these cover the rest. Proven loopback-only with an lsof
 * probe (BB-08 report).
 */
const LOOPBACK_ONLY_FIREFOX = {
  "network.proxy.type": 1,
  "network.proxy.http": "127.0.0.1",
  "network.proxy.http_port": 9,
  "network.proxy.ssl": "127.0.0.1",
  "network.proxy.ssl_port": 9,
  "network.proxy.socks": "127.0.0.1",
  "network.proxy.socks_port": 9,
  "network.proxy.socks_remote_dns": true,
  "network.proxy.no_proxies_on": "",
  "network.dns.native-is-localhost": true,
  "network.trr.mode": 5,
  "doh-rollout.disable-heuristics": true,
  "network.dns.disablePrefetch": true,
  "network.prefetch-next": false,
  "network.predictor.enabled": false,
  "network.captive-portal-service.enabled": false,
  "network.connectivity-service.enabled": false,
  "toolkit.telemetry.enabled": false,
  "toolkit.telemetry.unified": false,
  "toolkit.telemetry.archive.enabled": false,
  "toolkit.telemetry.server": "",
  "datareporting.usage.uploadEnabled": false,
  "app.normandy.enabled": false,
  "app.shield.optoutstudies.enabled": false,
  "messaging-system.rsexperimentloader.enabled": false,
  "dom.push.enabled": false,
  "app.update.auto": false,
  "extensions.systemAddon.update.enabled": false,
  "extensions.blocklist.enabled": false,
  "browser.region.update.enabled": false,
  "browser.region.network.url": "",
  "browser.topsites.contile.enabled": false,
  "browser.newtabpage.activity-stream.feeds.telemetry": false,
  "browser.newtabpage.activity-stream.telemetry": false,
  "identity.fxaccounts.enabled": false,
  "security.OCSP.enabled": 0,
  "security.remote_settings.crlite_filters.enabled": false,
  "security.remote_settings.intermediates.enabled": false,
  "browser.places.speculativeConnect.enabled": false,
  "browser.urlbar.speculativeConnect.enabled": false,
  "media.gmp-gmpopenh264.enabled": false,
  "media.gmp-widevinecdm.enabled": false,
  "geo.enabled": false,
};

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
  if (browser.engine === "firefox")
    return {
      browser: "firefox",
      protocol: "webDriverBiDi",
      executablePath: browser.executable,
      userDataDir: profileDir,
      headless: o.headless,
      defaultViewport: null,
      args: ["--remote-debugging-port=0"],
      ...(o.loopbackOnly && { extraPrefsFirefox: { ...LOOPBACK_ONLY_FIREFOX } }),
    };
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

/**
 * A clean quit of one plain Firefox process, which dies on SIGTERM. Scoped to the pid:
 * quitting by app name or bundle id would also quit your everyday Firefox.
 */
export function quitByPid(pid: number): [string, string[]] {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`not a process id: ${pid}`);
  return [
    "/usr/bin/osascript",
    [
      "-l",
      "JavaScript",
      "-e",
      `ObjC.import('AppKit'); $.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid}).terminate`,
    ],
  ];
}
