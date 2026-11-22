import { spawn } from "node:child_process";
import type { Browser, ElementHandle, Page as PuppeteerTab } from "puppeteer-core";
import { automationLaunchOptions, plainLaunchArgs } from "./args";
import { applicationRoots, detectBrowsers, type InstalledBrowser } from "./browsers";
import type { BrowserDriver, Page, PlainEnd } from "./driver";
import { untilEnter } from "./enter";

/** How long a plain window gets to shut down cleanly before it's killed. */
const QUIT_GRACE_MS = 10_000;

/**
 * Real browsers: plain processes for sign-in, puppeteer-core over a pipe for automation.
 * Production passes `{ keychain: "real" }`; tests add `"mock"` and `loopbackOnly`.
 */
export class PuppeteerDriver implements BrowserDriver {
  constructor(private readonly o: { keychain: "real" | "mock"; loopbackOnly?: boolean }) {}

  detect() {
    return detectBrowsers(applicationRoots());
  }

  async openPlain(
    browser: InstalledBrowser,
    profileDir: string,
    url: string,
    o: { signal?: AbortSignal } = {},
  ): Promise<PlainEnd> {
    const child = spawn(browser.executable, plainLaunchArgs(browser, profileDir, url), {
      stdio: "ignore",
    });
    const exited = new Promise<"closed">((done) => child.once("exit", () => done("closed")));
    const failed = new Promise<never>((_, reject) =>
      child.once("error", (e) => reject(new Error(`couldn't start ${browser.name}: ${e.message}`))),
    );
    const stop = new AbortController();
    const signal = o.signal ? AbortSignal.any([o.signal, stop.signal]) : stop.signal;
    try {
      // macOS keeps an app running after its last window closes, so Enter is the usual way
      // out. Quitting the browser (Cmd-Q) ends the wait too.
      const end = await Promise.race([untilEnter(signal), exited, failed]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM"); // Chromium shuts down cleanly on SIGTERM and frees the profile.
        const force = setTimeout(() => child.kill("SIGKILL"), QUIT_GRACE_MS);
        await exited;
        clearTimeout(force);
      }
      // Ctrl-C in the terminal reaches the browser too, and its exit mustn't read as Cmd-Q.
      return o.signal?.aborted ? "stopped" : end;
    } finally {
      stop.abort();
    }
  }

  async attach(browser: InstalledBrowser, profileDir: string, o: { headless: boolean }) {
    // Loaded here so commands that never automate a browser don't pay for it.
    const { default: puppeteer } = await import("puppeteer-core");
    const b = await puppeteer.launch(
      automationLaunchOptions(browser, profileDir, { ...this.o, headless: o.headless }),
    );
    try {
      const [tab = await b.newPage()] = await b.pages();
      // Headed checks stay out of the way: the window goes straight to the Dock.
      if (!o.headless) await b.setWindowBounds(await tab.windowId(), { windowState: "minimized" });
      return new PuppeteerPage(b, tab);
    } catch (e) {
      await b.close();
      throw e;
    }
  }
}

class PuppeteerPage implements Page {
  constructor(
    private readonly browser: Browser,
    private readonly tab: PuppeteerTab,
  ) {}

  async goto(url: string) {
    await this.tab.goto(url, { waitUntil: "load" });
  }

  async url() {
    return this.tab.url();
  }

  async exists(css: string, timeoutMs: number) {
    try {
      await this.tab.waitForSelector(css, { timeout: timeoutMs });
      return true;
    } catch (e) {
      if ((e as Error).name === "TimeoutError") return false;
      throw e;
    }
  }

  values(css: string) {
    return this.tab.$$eval(css, (els) =>
      els.map((e) =>
        e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement
          ? e.value
          : (e.textContent ?? "").trim(),
      ),
    );
  }

  async click(css: string, nth = 0) {
    await (await this.nth(css, nth)).click();
  }

  // Real key events for the clear too: a framework tracking the field through input events
  // never sees a `.value` set from script, and keeps the old text.
  async fill(css: string, nth: number, value: string) {
    const el = await this.nth(css, nth);
    await el.focus();
    await el.evaluate((e) => (e as HTMLInputElement).select());
    await this.tab.keyboard.press("Backspace");
    await el.type(value);
  }

  async text(css: string) {
    const el = await this.tab.$(css);
    return el ? el.evaluate((e) => (e.textContent ?? "").trim()) : null;
  }

  loadId() {
    return this.tab.evaluate(() => {
      const w = window as { __busbarLoad?: string };
      w.__busbarLoad ??= `${performance.timeOrigin}-${Math.random()}`;
      return w.__busbarLoad;
    });
  }

  screenshot() {
    return this.tab.screenshot({ type: "png" });
  }

  async close() {
    await this.browser.close();
  }

  private async nth(css: string, nth: number): Promise<ElementHandle> {
    const el = (await this.tab.$$(css))[nth];
    if (!el) throw new Error(`no match ${nth} for ${css}`);
    return el;
  }
}
