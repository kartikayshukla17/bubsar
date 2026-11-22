import { spawn } from "node:child_process";
import type { Browser, ElementHandle, Page as PuppeteerTab } from "puppeteer-core";
import { automationLaunchOptions, plainLaunchArgs } from "./args";
import { applicationRoots, detectBrowsers, type InstalledBrowser } from "./browsers";
import type { BrowserDriver, Page } from "./driver";

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

  openPlain(browser: InstalledBrowser, profileDir: string, url: string): Promise<void> {
    const child = spawn(browser.executable, plainLaunchArgs(browser, profileDir, url), {
      stdio: "ignore",
    });
    const exited = new Promise<void>((done) => child.once("exit", () => done()));
    return new Promise((resolve, reject) => {
      let settled = false;
      const onLine = (chunk: Buffer) => {
        if (chunk.includes(0x0a)) finish();
      };
      // macOS keeps an app running after its last window closes, so Enter is the usual way
      // out. Quitting the browser (Cmd-Q) ends the wait too.
      const finish = async () => {
        if (settled) return;
        settled = true;
        process.stdin.off("data", onLine);
        process.stdin.pause();
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGTERM"); // Chromium shuts down cleanly on SIGTERM and frees the profile.
          const force = setTimeout(() => child.kill("SIGKILL"), QUIT_GRACE_MS);
          await exited;
          clearTimeout(force);
        }
        resolve();
      };
      child.once("error", (e) => {
        settled = true;
        process.stdin.off("data", onLine);
        process.stdin.pause();
        reject(new Error(`couldn't start ${browser.name}: ${e.message}`));
      });
      child.once("exit", finish);
      process.stdin.on("data", onLine);
    });
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

  async fill(css: string, nth: number, value: string) {
    const el = await this.nth(css, nth);
    await el.evaluate((e) => {
      (e as HTMLInputElement).value = "";
    });
    await el.type(value);
  }

  async text(css: string) {
    const el = await this.tab.$(css);
    return el ? el.evaluate((e) => (e.textContent ?? "").trim()) : null;
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
