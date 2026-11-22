import type { Page } from "../../browser/driver";
import { readWorld, updateWorld } from "../../browser/fake";
import {
  type GoogleConsole,
  isReauth,
  type Lists,
  ReauthRequired,
  SelectorMissing,
} from "./console";
import { SELECTORS, type SelectorName } from "./selectors";

/**
 * The Google recipe on the fake world (BB_FAKE). Navigation goes through the fake page, so
 * a signed-out session bounces to sign-in exactly as it would for the real recipe; the
 * client's lists and scripted failures come from `world.google`.
 */
export class FakeGoogleConsole implements GoogleConsole {
  constructor(
    private readonly file: string,
    private readonly page: Page,
    private readonly url: string,
  ) {}

  async read(): Promise<Lists> {
    updateWorld(this.file, (w) => {
      w.consoleCalls = [...(w.consoleCalls ?? []), { op: "read", url: this.url }];
    });
    await this.page.goto(this.url);
    const now = await this.page.url();
    const { google } = readWorld(this.file);
    if (isReauth(now)) throw new ReauthRequired(now);
    if (google.fail?.reauth === "read")
      throw new ReauthRequired("https://accounts.google.com/v3/signin/challenge/pwd");
    const missing = google.fail?.missingSelector;
    if (missing !== undefined) {
      if (!(missing in SELECTORS))
        throw new Error(
          `fake world: google.fail.missingSelector "${missing}" isn't in selectors.ts`,
        );
      throw new SelectorMissing(missing as SelectorName);
    }
    const client = google.client ?? { redirectUris: [], jsOrigins: [] };
    return { redirectUris: [...client.redirectUris], jsOrigins: [...client.jsOrigins] };
  }

  async write(): Promise<{ saved: Lists }> {
    throw new Error("fake world: writing the Google console isn't modelled yet (BB-04)");
  }

  screenshot() {
    return this.page.screenshot();
  }

  close() {
    return this.page.close();
  }
}
