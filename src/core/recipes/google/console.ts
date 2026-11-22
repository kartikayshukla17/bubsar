import type { Page } from "../../browser/driver";
import { LISTS, SELECTORS, type SelectorName } from "./selectors";

/** The OAuth web client's two lists, as the console shows them, in order. */
export type Lists = { redirectUris: string[]; jsOrigins: string[] };

/** The Google recipe. Everything above it (plan, apply) goes through this. */
export interface GoogleConsole {
  /** Load the client page and read both lists. */
  read(): Promise<Lists>;
  /** Edit, Save, wait for Google's confirmation, read back. (BB-04) */
  write(next: Lists): Promise<{ saved: Lists }>;
  /** PNG of the page as it is now, for `--debug` on failure. */
  screenshot(): Promise<Uint8Array>;
  /** Closes the automated browser, which unlocks the profile. */
  close(): Promise<void>;
}

/** An expected element didn't appear in time. busbar never guesses past it. */
export class SelectorMissing extends Error {
  constructor(readonly selector: SelectorName) {
    super(`Google console layout changed: \`${selector}\` not found. Nothing was changed.`);
    this.name = "SelectorMissing";
  }
}

/** Google sent the profile to sign-in. Judged by the URL's host, never by page text. */
export class ReauthRequired extends Error {
  constructor(readonly url: string) {
    super("session expired; run `bb login google`");
    this.name = "ReauthRequired";
  }
}

/** Google refused the Save, in its own words. (BB-04) */
export class SaveRejected extends Error {
  constructor(readonly googleText: string) {
    super(`Google didn't save the client: ${googleText}`);
    this.name = "SaveRejected";
  }
}

export const ACCOUNTS_ORIGIN = "https://accounts.google.com";

/** The OAuth client's page: `${origin}/auth/clients/<client_id>?project=<project_id>`. */
export function clientUrl(origin: string, projectId: string, clientId: string) {
  return `${origin}/auth/clients/${encodeURIComponent(clientId)}?project=${encodeURIComponent(projectId)}`;
}

/** Whether `url` is Google sign-in: any page on the accounts host. */
export function isReauth(url: string, accountsOrigin = ACCOUNTS_ORIGIN) {
  try {
    return new URL(url).host === new URL(accountsOrigin).host;
  } catch {
    return false;
  }
}

/**
 * The recipe on a real page, through the recorded selectors. Fails closed: a missing
 * element is `SelectorMissing(name)`, a bounce to sign-in is `ReauthRequired`.
 */
export class PageGoogleConsole implements GoogleConsole {
  readonly #timeoutMs: number;
  readonly #accounts: string;

  constructor(
    private readonly page: Page,
    private readonly o: {
      url: string;
      /** Tests point this at a loopback stand-in. */
      accountsOrigin?: string;
      /** How long the console gets to show each expected element. */
      timeoutMs?: number;
    },
  ) {
    this.#timeoutMs = o.timeoutMs ?? 20_000;
    this.#accounts = o.accountsOrigin ?? ACCOUNTS_ORIGIN;
  }

  async read(): Promise<Lists> {
    await this.page.goto(this.o.url);
    await this.notSignIn();
    await this.need("clientForm");
    return {
      redirectUris: await this.list(LISTS.redirectUris),
      jsOrigins: await this.list(LISTS.jsOrigins),
    };
  }

  async write(): Promise<{ saved: Lists }> {
    throw new Error("writing the Google console isn't built yet (BB-04)");
  }

  screenshot() {
    return this.page.screenshot();
  }

  close() {
    return this.page.close();
  }

  private async notSignIn() {
    const url = await this.page.url();
    if (isReauth(url, this.#accounts)) throw new ReauthRequired(url);
  }

  /** Wait for an element. Missing: first check for a late bounce to sign-in, then fail. */
  private async need(name: SelectorName) {
    if (await this.page.exists(SELECTORS[name], this.#timeoutMs)) return;
    await this.notSignIn();
    throw new SelectorMissing(name);
  }

  /**
   * One list's entries, failing closed on drift. The section and its Add URI button must be
   * there (an empty list still has the button). Every input in the section must be an entry
   * the entry selector finds, and every entry needs its delete button; if a count disagrees,
   * a selector no longer finds what it should, so the read fails instead of returning a list
   * that's quietly short.
   */
  private async list(l: (typeof LISTS)[keyof typeof LISTS]) {
    await this.need(l.section);
    await this.need(l.add);
    const values = await this.page.values(SELECTORS[l.inputs]);
    const fields = (await this.page.values(SELECTORS[l.fields])).length;
    if (values.length !== fields) throw new SelectorMissing(l.inputs);
    const deletes = (await this.page.values(SELECTORS[l.deletes])).length;
    if (deletes !== values.length) throw new SelectorMissing(l.deletes);
    return values;
  }
}
