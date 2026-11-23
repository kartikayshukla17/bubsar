import { describe, expect, it } from "vitest";
import { automationLaunchOptions, plainLaunchArgs, quitByPid } from "./args";
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

describe("the handoff window (BB-06) is the same plain process, at Google's own page", () => {
  it("carries no debugging pipe or port and no automation flag, only the profile and the page", () => {
    const challenge =
      "https://accounts.google.com/v3/signin/challenge/pwd?continue=https%3A%2F%2Fconsole.cloud.google.com%2Fauth%2Fclients%2F1234-abc.apps.googleusercontent.com%3Fproject%3Dmy-sandbox-123";
    const args = plainLaunchArgs(brave, PROFILE, challenge);
    expect(args).toEqual([
      `--user-data-dir=${PROFILE}`,
      "--no-first-run",
      "--no-default-browser-check",
      challenge,
    ]);
    expect(args.join(" ")).not.toMatch(/remote-debugging|automation|headless|mock-keychain/);
  });
});

const firefox: InstalledBrowser = {
  id: "firefox",
  name: "Firefox",
  executable: "/Applications/Firefox.app/Contents/MacOS/firefox",
  engine: "firefox",
};
const FF_PROFILE = "/tmp/bb-home/profiles/enquiry-to-paid/firefox";

describe("Firefox's plain window (sign-in and handoff) is an ordinary Firefox on busbar's profile", () => {
  it("is -profile <dir> -no-remote <url>, with no remote agent, no Marionette and no automation prefs", () => {
    const challenge =
      "https://accounts.google.com/v3/signin/challenge/pwd?continue=https%3A%2F%2Fconsole.cloud.google.com%2F";
    const args = plainLaunchArgs(firefox, FF_PROFILE, challenge);
    expect(args).toEqual(["-profile", FF_PROFILE, "-no-remote", challenge]);
    expect(args.join(" ")).not.toMatch(/remote-debugging|marionette|headless|user_pref|prefs/i);
  });
});

describe("quitByPid: the plain Firefox window is asked to quit, by its own pid only", () => {
  it("asks AppKit to terminate exactly that process, and names no app or bundle id", () => {
    const [cmd, args] = quitByPid(4242);
    expect(cmd).toBe("/usr/bin/osascript");
    expect(args).toEqual([
      "-l",
      "JavaScript",
      "-e",
      "ObjC.import('AppKit'); $.NSRunningApplication.runningApplicationWithProcessIdentifier(4242).terminate",
    ]);
    expect(args.join(" ")).not.toMatch(
      /firefox|org\.mozilla|Application\(|tell application|bundleIdentifier|killall/i,
    );
  });

  it("refuses anything but a positive whole pid, so nothing else reaches the script", () => {
    for (const pid of [0, -1, 1.5, Number.NaN])
      expect(() => quitByPid(pid)).toThrow(`not a process id: ${pid}`);
  });
});

describe("automationLaunchOptions for Firefox", () => {
  it("talks WebDriver BiDi on an ephemeral port that Firefox binds to localhost, and lets no other host or web origin connect", () => {
    const o = automationLaunchOptions(firefox, FF_PROFILE, { headless: true, keychain: "real" });
    expect(o.browser).toBe("firefox");
    expect(o.protocol).toBe("webDriverBiDi");
    expect(o.executablePath).toBe(firefox.executable);
    expect(o.userDataDir).toBe(FF_PROFILE);
    expect(o.headless).toBe(true);
    expect(o.pipe).toBeUndefined();
    expect(o.debuggingPort).toBeUndefined();
    expect(o.args).toEqual(["--remote-debugging-port=0"]);
    expect(o.ignoreDefaultArgs).toBeUndefined();
    expect(JSON.stringify(o)).not.toMatch(/remote-allow-hosts|remote-allow-origins|marionette/);
  });

  it("is the same whatever the keychain setting: Firefox has no Keychain to mock", () => {
    expect(
      automationLaunchOptions(firefox, FF_PROFILE, { headless: false, keychain: "mock" }),
    ).toEqual(automationLaunchOptions(firefox, FF_PROFILE, { headless: false, keychain: "real" }));
  });

  it("loopbackOnly (tests) turns off Firefox's own background networking; production sets no prefs", () => {
    const o = automationLaunchOptions(firefox, FF_PROFILE, {
      headless: true,
      keychain: "mock",
      loopbackOnly: true,
    });
    expect(o.extraPrefsFirefox).toMatchObject({
      "network.proxy.type": 1,
      "network.proxy.http": "127.0.0.1",
      "network.proxy.http_port": 9,
      "network.proxy.ssl": "127.0.0.1",
      "network.proxy.ssl_port": 9,
      "network.proxy.socks": "127.0.0.1",
      "network.proxy.socks_port": 9,
      "network.dns.native-is-localhost": true,
      "network.trr.mode": 5,
      "network.captive-portal-service.enabled": false,
      "network.connectivity-service.enabled": false,
      "toolkit.telemetry.enabled": false,
      "app.normandy.enabled": false,
      "dom.push.enabled": false,
      "app.update.auto": false,
      "security.OCSP.enabled": 0,
    });
    const real = automationLaunchOptions(firefox, FF_PROFILE, { headless: true, keychain: "real" });
    expect(real.extraPrefsFirefox).toBeUndefined();
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
