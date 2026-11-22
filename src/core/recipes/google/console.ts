import type { Page } from "../../browser/driver";
import { LISTS, SAVE_IN_PROGRESS, SELECTORS, type SelectorName } from "./selectors";

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

export const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((u, i) => u === b[i]);

export const sameLists = (a: Lists, b: Lists) =>
  sameList(a.redirectUris, b.redirectUris) && sameList(a.jsOrigins, b.jsOrigins);

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
  #readIn: string | null = null;

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
    const lists = {
      redirectUris: await this.list(LISTS.redirectUris),
      jsOrigins: await this.list(LISTS.jsOrigins),
    };
    this.#readIn = await this.page.loadId();
    return lists;
  }

  async write(next: Lists): Promise<{ saved: Lists }> {
    await this.sameLoad();
    for (const key of ["redirectUris", "jsOrigins"] as const) {
      const l = LISTS[key];
      const now = await this.page.values(SELECTORS[l.inputs]);
      const drop = now.flatMap((url, i) => (next[key].includes(url) ? [] : [i]));
      for (const i of drop.reverse()) await this.page.click(SELECTORS[l.deletes], i);
      const kept = now.length - drop.length;
      for (const [j, url] of next[key].filter((u) => !now.includes(u)).entries()) {
        await this.page.click(SELECTORS[l.add]);
        await this.page.fill(SELECTORS[l.inputs], kept + j, url);
      }
    }
    await this.sameLoad();
    const shown = {
      redirectUris: await this.list(LISTS.redirectUris),
      jsOrigins: await this.list(LISTS.jsOrigins),
    };
    if (!sameLists(shown, next))
      throw new Error(
        "busbar's edits didn't show on the client page as planned, so it didn't press Save. Nothing was changed.",
      );
    const answer = await this.answerTo(() => this.page.click(SELECTORS.saveButton));
    if (answer.refused !== undefined) throw new SaveRejected(answer.refused);
    if (!answer.saved)
      throw new Error(
        "busbar pressed Save, but Google showed neither a confirmation nor an error. busbar can't tell what was saved: run `bb plan` to read the client again.",
      );
    try {
      return { saved: await this.read() };
    } catch (e) {
      if (!(e instanceof SelectorMissing)) throw e;
      throw new Error(
        `Google confirmed the Save, but busbar couldn't read the client back (Google console layout changed: \`${e.selector}\` not found). Run \`bb plan\` to see what it holds.`,
      );
    }
  }

  screenshot() {
    return this.page.screenshot();
  }

  close() {
    return this.page.close();
  }

  private async sameLoad() {
    if (this.#readIn === null) throw new Error("write() needs read() first, in the same page load");
    await this.notSignIn();
    if ((await this.page.loadId()) !== this.#readIn)
      throw new Error(
        "The client page reloaded after busbar read it, so busbar didn't press Save. Nothing was changed.",
      );
  }

  private async answerTo(press: () => Promise<void>) {
    const texts = (css: string) => this.page.values(css);
    const before = {
      status: await texts(SELECTORS.savedToast),
      alert: await texts(SELECTORS.saveError),
    };
    await press();
    const until = Date.now() + this.#timeoutMs;
    while (Date.now() < until) {
      const refused = (await texts(SELECTORS.saveError)).find((t) => !before.alert.includes(t));
      if (refused !== undefined) return { refused };
      const saved = (await texts(SELECTORS.savedToast)).find(
        (t) => !before.status.includes(t) && !SAVE_IN_PROGRESS.test(t),
      );
      if (saved !== undefined) return { saved };
      await new Promise((r) => setTimeout(r, 100));
    }
    return {};
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
