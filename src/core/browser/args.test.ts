import { describe, expect, it } from "vitest";
import { automationLaunchOptions, plainLaunchArgs } from "./args";
import type { InstalledBrowser } from "./browsers";

const brave: InstalledBrowser = {
  id: "brave",
  name: "Brave",
  executable: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  engine: "chromium",
};
const PROFILE = "/tmp/bb-home/profiles/enquiry-to-paid/brave";
const URL =
  "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fconsole.cloud.google.com%2F";

describe("plainLaunchArgs: the window you sign into carries no automation", () => {
  it("opens the URL on busbar's profile and nothing else", () => {
    const args = plainLaunchArgs(brave, PROFILE, URL);
    expect(args).toContain(`--user-data-dir=${PROFILE}`);
    expect(args.at(-1)).toBe(URL);
    for (const flag of args) {
      expect(flag).not.toMatch(
        /^--(?:remote-debugging-|use-mock-keychain|password-store|enable-automation|headless)/,
      );
    }
  });
});

describe("automationLaunchOptions", () => {
  it("talks over a pipe, never a port, on busbar's profile", () => {
    const o = automationLaunchOptions(brave, PROFILE, { headless: true, keychain: "real" });
    expect(o.pipe).toBe(true);
    expect(o.executablePath).toBe(brave.executable);
    expect(o.userDataDir).toBe(PROFILE);
    expect(o.headless).toBe(true);
    expect(o.debuggingPort).toBeUndefined();
    expect(o.args ?? []).not.toContainEqual(expect.stringMatching(/^--remote-debugging-port/));
  });

  it("keychain real drops Puppeteer's mock keychain and basic password store", () => {
    const o = automationLaunchOptions(brave, PROFILE, { headless: false, keychain: "real" });
    expect(o.ignoreDefaultArgs).toEqual(
      expect.arrayContaining(["--use-mock-keychain", "--password-store=basic"]),
    );
    expect(o.headless).toBe(false);
  });

  it("keychain mock keeps them, so tests never raise a Keychain prompt", () => {
    const o = automationLaunchOptions(brave, PROFILE, { headless: true, keychain: "mock" });
    const ignored = Array.isArray(o.ignoreDefaultArgs) ? o.ignoreDefaultArgs : [];
    expect(ignored).not.toContain("--use-mock-keychain");
    expect(ignored).not.toContain("--password-store=basic");
  });

  it("loopbackOnly (tests) keeps the browser off the network, its own background traffic included", () => {
    const o = automationLaunchOptions(brave, PROFILE, {
      headless: true,
      keychain: "mock",
      loopbackOnly: true,
    });
    expect(o.args).toEqual([
      // everything but loopback goes to a dead proxy, and no host name resolves
      "--proxy-server=http://127.0.0.1:9",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
      // DNS-over-HTTPS can target an IP literal (8.8.8.8), which resolver rules don't cover
      "--disable-features=DnsOverHttps",
      // the browser's own background traffic
      "--disable-component-update",
      "--disable-domain-reliability",
      "--no-pings",
    ]);
    const real = automationLaunchOptions(brave, PROFILE, { headless: true, keychain: "real" });
    expect(real.args ?? []).toEqual([]);
  });
});
