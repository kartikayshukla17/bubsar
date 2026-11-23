import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Lists } from "../recipes/google/console";
import type { Session } from "../session";
import { type BrowserId, type InstalledBrowser, KNOWN } from "./browsers";
import type { BrowserDriver, Page, PlainEnd } from "./driver";
import { type EnterWait, untilEnter } from "./enter";

/**
 * The fake world (`BB_FAKE=<file>`): what CLI tests use instead of real browsers and real
 * Google. The JSON file is the single source of truth, and the fake writes what happened
 * back into it so tests can assert on it.
 */
export type FakeWorld = {
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
     * `reauth` bounces the client page to sign-in although the session looked fine, at the
     * read, between the edits and Save, or at the read-back after a confirmed Save. Each
     * plain window the user signs in at clears one, so a list scripts several in turn.
     */
    fail?: {
      missingSelector?: string;
      reauth?: ReauthAt | ReauthAt[];
      saveError?: string;
      savedAs?: Lists;
    };
  };
  /** Written by the fake Google recipe: every console operation, in order. */
  consoleCalls?: ({ op: "read"; url: string } | { op: "save"; url: string; lists: Lists })[];
  attachFails?: string;
  closeFails?: string;
  closeHangs?: boolean;
  kills?: number;
  openPlainCalls?: { browser: BrowserId; profileDir: string; url: string }[];
  attachCalls?: { browser: BrowserId; profileDir: string; headless: boolean }[];
};

export type ReauthAt = "read" | "save" | "readback";

export function scriptedReauth(w: FakeWorld): ReauthAt | undefined {
  const r = w.google.fail?.reauth;
  return Array.isArray(r) ? r[0] : r;
}

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
  constructor(
    private readonly file: string,
    private readonly o: { untilEnter?: (signal?: AbortSignal) => Promise<EnterWait> } = {},
  ) {}

  detect(): InstalledBrowser[] {
    const { browsers } = readWorld(this.file);
    return KNOWN.filter((k) => browsers.includes(k.id)).map(({ bundle, ...b }) => ({
      ...b,
      executable: join("/Applications", bundle),
    }));
  }

  async openPlain(
    browser: InstalledBrowser,
    profileDir: string,
    url: string,
    o: { signal?: AbortSignal } = {},
  ): Promise<PlainEnd> {
    updateWorld(this.file, (w) => {
      w.openPlainCalls = [...(w.openPlainCalls ?? []), { browser: browser.id, profileDir, url }];
      if (w.google.userSignsIn === false) return;
      w.google.session = "signed-in";
      const fail = w.google.fail;
      if (Array.isArray(fail?.reauth) && fail.reauth.length > 1) fail.reauth.shift();
      else delete fail?.reauth;
    });
    return (this.o.untilEnter ?? untilEnter)(o.signal);
  }

  async attach(browser: InstalledBrowser, profileDir: string, o: { headless: boolean }) {
    updateWorld(this.file, (w) => {
      w.attachCalls = [
        ...(w.attachCalls ?? []),
        { browser: browser.id, profileDir, headless: o.headless },
      ];
    });
    const { attachFails } = readWorld(this.file);
    if (attachFails) throw new Error(attachFails);
    return new FakePage(this.file);
  }
}

/** Answers navigation from `google.session`. The console's contents aren't modelled here. */
class FakePage implements Page {
  #url = "about:blank";
  #loads = 0;
  constructor(private readonly file: string) {}

  async goto(url: string) {
    const signedIn = readWorld(this.file).google.session === "signed-in";
    this.#url = signedIn ? url : `${ACCOUNTS}?continue=${encodeURIComponent(url)}`;
    this.#loads++;
  }
  async loadId() {
    return String(this.#loads);
  }
  async url() {
    return this.#url;
  }
  async close() {
    const { closeFails, closeHangs } = readWorld(this.file);
    if (closeHangs) await new Promise(() => {});
    if (closeFails) throw new Error(closeFails);
  }
  kill() {
    updateWorld(this.file, (w) => {
      w.kills = (w.kills ?? 0) + 1;
    });
  }
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
