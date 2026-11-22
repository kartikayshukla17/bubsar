import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Page } from "../src/core/browser/driver";
import { PuppeteerDriver } from "../src/core/browser/puppeteer";
import {
  clientUrl,
  PageGoogleConsole,
  ReauthRequired,
  SelectorMissing,
} from "../src/core/recipes/google/console";
import { SELECTORS } from "../src/core/recipes/google/selectors";
import { testBrowser as browser } from "./helpers/browser";
import { STAND_IN, type StandIn, standInConsole } from "./helpers/google-console";

// The Google recipe against the hand-built stand-in client page (test/fixtures/google-console),
// in installed Brave (helpers/browser.ts says why not Dia): headless, a throwaway profile, the
// mock keychain, and loopback-only networking. Nothing here reaches Google.

let standIn: StandIn;
let page: Page;

describe.skipIf(!browser)(
  `Google recipe vs the stand-in, on ${browser?.name ?? "no Brave"}`,
  () => {
    beforeAll(async () => {
      if (!browser) return;
      standIn = await standInConsole();
      page = await new PuppeteerDriver({ keychain: "mock", loopbackOnly: true }).attach(
        browser,
        mkdtempSync(join(tmpdir(), "bb-profile-")),
        { headless: true },
      );
    }, 30_000);
    afterAll(async () => {
      await page?.close();
      await standIn?.close();
    });
    beforeEach(() => {
      standIn.lists = {
        redirectUris: ["http://localhost:3000/cb"],
        jsOrigins: ["http://localhost:3000"],
      };
      standIn.set.reauth = null;
      standIn.set.rewrite = [];
      standIn.requests.length = 0;
    });

    it("selector contract: every recorded selector matches the client page", async () => {
      await page.goto(standIn.clientUrl);
      const missing = [];
      for (const [name, css] of Object.entries(SELECTORS))
        if (!(await page.exists(css, 2000))) missing.push(name);
      expect(missing).toEqual([]);
    });

    const recipe = () =>
      new PageGoogleConsole(page, {
        url: clientUrl(standIn.origin, STAND_IN.projectId, STAND_IN.clientId),
        accountsOrigin: standIn.accountsOrigin,
        timeoutMs: 1500,
      });

    it("reads both lists, in order, from the client's deep link", async () => {
      standIn.lists = {
        redirectUris: [
          "http://localhost:3000/api/auth/callback/google",
          "https://old.ngrok-free.app/cb",
        ],
        jsOrigins: ["http://localhost:3000", "https://old.ngrok-free.app"],
      };
      expect(await recipe().read()).toEqual(standIn.lists);
      expect(standIn.requests).toEqual([
        `/auth/clients/${STAND_IN.clientId}?project=${STAND_IN.projectId}`,
      ]);
    });

    it("reads an empty list as empty", async () => {
      standIn.lists = { redirectUris: [], jsOrigins: ["http://localhost:3000"] };
      expect(await recipe().read()).toEqual(standIn.lists);
    });

    it.each([
      [
        "a renamed section",
        'list("Authorized redirect URIs"',
        'list("Redirect URIs"',
        "redirectUris",
      ],
      [
        "renamed entry fields",
        'querySelector("input").setAttribute("aria-label", `URIs',
        'querySelector("input").setAttribute("aria-label", `URI',
        "redirectUriInputs",
      ],
    ] as const)("fails closed on %s, naming the selector", async (_, from, to, name) => {
      standIn.set.rewrite = [[from, to]];
      const err = await recipe()
        .read()
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SelectorMissing);
      expect((err as SelectorMissing).selector).toBe(name);
      expect((err as Error).message).toBe(
        `Google console layout changed: \`${name}\` not found. Nothing was changed.`,
      );
    });

    it.each([
      ["an HTTP redirect", "redirect"],
      ["a script redirect after the page loaded", "script"],
    ] as const)(
      "a bounce to sign-in by %s is ReauthRequired, not a layout change",
      async (_, how) => {
        standIn.set.reauth = how;
        const err = await recipe()
          .read()
          .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ReauthRequired);
        expect((err as ReauthRequired).url).toMatch(
          new RegExp(`^${standIn.accountsOrigin}/v3/signin/identifier\\?continue=`),
        );
        expect((err as Error).message).toBe("session expired; run `bb login google`");
      },
    );

    it("takes a PNG of the page for --debug", async () => {
      const r = recipe();
      await r.read();
      expect(Buffer.from((await r.screenshot()).subarray(1, 4)).toString()).toBe("PNG");
    });
  },
);
