import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Lists } from "../recipes/google/console";
import type { Session } from "../session";
import { type BrowserId, type InstalledBrowser, KNOWN } from "./browsers";
import type { BrowserDriver, Page } from "./driver";

/**
 * The fake world (`BB_FAKE=<file>`): what CLI tests use instead of real browsers and real
 * Google. The JSON file is the single source of truth, and the fake writes what happened
 * back into it so tests can assert on it.
 */
export type FakeWorld = {
  /** Installed browsers. */
  browsers: BrowserId[];
  google: {
    /** The Google session inside busbar's profile. */
    session: Session;
    /** Whether the user signs in when a plain window opens. Default true. */
    userSignsIn?: boolean;
    /** The OAuth client's lists as the console shows them. Absent: both empty. */
    client?: Lists;
    /**
     * Scripted failures of the console page, for the fake Google recipe:
     * `missingSelector` (a name from selectors.ts) makes the read fail as layout drift;
     * `reauth: "read"` bounces the client page to sign-in although the session looked fine.
     */
    fail?: { missingSelector?: string; reauth?: "read" };
  };
  /** Written by the fake Google recipe: every console operation, in order. */
  consoleCalls?: { op: "read"; url: string }[];
  /** Written by the fake: every un-automated window opened. */
  openPlainCalls?: { browser: BrowserId; profileDir: string; url: string }[];
  /** Written by the fake: every automated attach. */
  attachCalls?: { browser: BrowserId; profileDir: string; headless: boolean }[];
};

export function readWorld(file: string): FakeWorld {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function updateWorld(file: string, change: (w: FakeWorld) => void) {
  const w = readWorld(file);
  change(w);
  writeFileSync(file, `${JSON.stringify(w, null, 2)}\n`);
}

const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";

/** Where the fake sends a signed-out profile. Never fetched: it's only a URL string. */
const ACCOUNTS = "https://accounts.google.com/v3/signin/identifier";

export class FakeDriver implements BrowserDriver {
  constructor(private readonly file: string) {}

  detect(): InstalledBrowser[] {
    const { browsers } = readWorld(this.file);
    return KNOWN.filter((k) => browsers.includes(k.id)).map(({ bundle, ...b }) => ({
      ...b,
      executable: join("/Applications", bundle),
    }));
  }

  async openPlain(browser: InstalledBrowser, profileDir: string, url: string) {
    updateWorld(this.file, (w) => {
      w.openPlainCalls = [...(w.openPlainCalls ?? []), { browser: browser.id, profileDir, url }];
      if (w.google.userSignsIn !== false) w.google.session = "signed-in";
    });
  }

  async attach(browser: InstalledBrowser, profileDir: string, o: { headless: boolean }) {
    updateWorld(this.file, (w) => {
      w.attachCalls = [
        ...(w.attachCalls ?? []),
        { browser: browser.id, profileDir, headless: o.headless },
      ];
    });
    return new FakePage(this.file);
  }
}

/** Answers navigation from `google.session`. The console's contents aren't modelled here. */
class FakePage implements Page {
  #url = "about:blank";
  constructor(private readonly file: string) {}

  async goto(url: string) {
    const signedIn = readWorld(this.file).google.session === "signed-in";
    this.#url = signedIn ? url : `${ACCOUNTS}?continue=${encodeURIComponent(url)}`;
  }
  async url() {
    return this.#url;
  }
  async close() {}
  /** A 1x1 PNG: the fake world has no pixels. */
  async screenshot() {
    return Uint8Array.from(Buffer.from(PIXEL, "base64"));
  }

  exists(): Promise<boolean> {
    return unmodelled("exists");
  }
  values(): Promise<string[]> {
    return unmodelled("values");
  }
  click(): Promise<void> {
    return unmodelled("click");
  }
  fill(): Promise<void> {
    return unmodelled("fill");
  }
  text(): Promise<string | null> {
    return unmodelled("text");
  }
}

function unmodelled(op: string): never {
  throw new Error(`fake world: Page.${op} isn't modelled; drive the console through a fake recipe`);
}
