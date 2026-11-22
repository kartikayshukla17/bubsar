import type { InstalledBrowser } from "./browsers";
import { FakeDriver } from "./fake";
import { PuppeteerDriver } from "./puppeteer";

/** One automated tab on busbar's profile. Everything above the driver goes through this. */
export interface Page {
  goto(url: string): Promise<void>;
  url(): Promise<string>;
  /** Whether `css` matches within `timeoutMs`. */
  exists(css: string, timeoutMs: number): Promise<boolean>;
  /** Input values (or trimmed text) of every match, in document order. */
  values(css: string): Promise<string[]>;
  click(css: string, nth?: number): Promise<void>;
  fill(css: string, nth: number, value: string): Promise<void>;
  /** Trimmed text of the first match, or null when nothing matches. */
  text(css: string): Promise<string | null>;
  loadId(): Promise<string>;
  /** PNG of the visible page. Only for `--debug`, which warns what it may show. */
  screenshot(): Promise<Uint8Array>;
  /** Closes the whole automated browser, which unlocks the profile. */
  close(): Promise<void>;
}

export type PlainEnd = "enter" | "closed" | "eof" | "stopped";

export interface BrowserDriver {
  detect(): InstalledBrowser[];
  /**
   * Un-automated window on the profile. Resolves when the user presses Enter in the
   * terminal, the browser process exits, stdin closes or `signal` fires; then makes sure
   * the process is gone so the profile is unlocked.
   */
  openPlain(
    browser: InstalledBrowser,
    profileDir: string,
    url: string,
    o?: { signal?: AbortSignal },
  ): Promise<PlainEnd>;
  attach(browser: InstalledBrowser, profileDir: string, o: { headless: boolean }): Promise<Page>;
}

/** The fake world when `BB_FAKE` names one (tests), otherwise real browsers. */
export function driverFromEnv(env = process.env): BrowserDriver {
  return env.BB_FAKE ? new FakeDriver(env.BB_FAKE) : new PuppeteerDriver({ keychain: "real" });
}
