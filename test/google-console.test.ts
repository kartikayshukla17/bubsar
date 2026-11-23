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
  SaveRejected,
  SelectorMissing,
} from "../src/core/recipes/google/console";
import { AFTER_SAVE, SELECTORS, type SelectorName } from "../src/core/recipes/google/selectors";
import { skippedBrowsers, testBrowsers } from "./helpers/browser";
import { STAND_IN, type StandIn, standInConsole } from "./helpers/google-console";

// The Google recipe against the hand-built stand-in client page (test/fixtures/google-console),
// in installed Brave and Firefox (helpers/browser.ts says why not Dia): headless, a throwaway
// profile, the mock keychain, and loopback-only networking. Nothing here reaches Google.

let standIn: StandIn;
let page: Page;

for (const why of skippedBrowsers) it.skip(why, () => {});

describe.skipIf(testBrowsers.length === 0)("Google recipe vs the stand-in", () => {
  describe.each(testBrowsers)("on $name", (browser) => {
    beforeAll(async () => {
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
      standIn.set.saveError = null;
      standIn.set.storeAs = null;
      standIn.set.saveDelayMs = 0;
      standIn.set.banner = null;
      standIn.set.savingText = null;
      standIn.set.route = null;
      standIn.requests.length = 0;
      standIn.saves.length = 0;
    });

    it("selector contract: every recorded selector matches the client page", async () => {
      await page.goto(standIn.clientUrl);
      const missing = [];
      for (const [name, css] of Object.entries(SELECTORS))
        if (!AFTER_SAVE.includes(name as SelectorName) && !(await page.exists(css, 2000)))
          missing.push(name);
      expect(missing).toEqual([]);
    });

    /** How the stand-in labels each entry's text field: `URIs N`. */
    const INPUT_LABEL = 'querySelector("input").setAttribute("aria-label", `URIs';

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
        [['list("Authorized redirect URIs"', 'list("Redirect URIs"']],
        "redirectUris",
      ],
      ["renamed entry fields", [[INPUT_LABEL, INPUT_LABEL.slice(0, -1)]], "redirectUriInputs"],
      [
        "entry fields and delete buttons both renamed",
        [
          [INPUT_LABEL, INPUT_LABEL.slice(0, -1)],
          ["`Delete URIs", "`Remove URIs"],
        ],
        "redirectUriInputs",
      ],
      [
        "a section that rendered without its Add URI button",
        [['"aria-label": "Add URI"', '"aria-label": "New URI"']],
        "redirectUriAdd",
      ],
    ] as const)("fails closed on %s, naming the selector", async (_, rewrite, name) => {
      standIn.set.rewrite = rewrite.map(([from, to]) => [from, to]);
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
        expect((err as ReauthRequired).afterSave).toBe(false);
      },
    );

    describe("write", () => {
      const CB = "/api/auth/callback/google";
      const LOCAL = "http://localhost:3000";
      const OLD = "https://old.ngrok-free.app";
      const NEW = "https://new.ngrok-free.app";
      const PAGE = `/auth/clients/${STAND_IN.clientId}?project=${STAND_IN.projectId}`;
      const SAVE = `/auth/clients/${STAND_IN.clientId}/save?project=${STAND_IN.projectId}`;
      const before = { redirectUris: [`${LOCAL}${CB}`, `${OLD}${CB}`], jsOrigins: [OLD] };
      const next = { redirectUris: [`${LOCAL}${CB}`, `${NEW}${CB}`], jsOrigins: [NEW] };

      it("adds the new entries, deletes the dropped ones, saves once, and reads back after a reload", async () => {
        standIn.lists = structuredClone(before);
        const r = recipe();
        expect(await r.read()).toEqual(before);
        expect(await r.write(next)).toEqual({ saved: next });
        expect(standIn.saves).toEqual([next]);
        expect(standIn.requests).toEqual([PAGE, SAVE, PAGE]);
      });

      it("reports what Google stored, not what busbar typed", async () => {
        standIn.lists = structuredClone(before);
        standIn.set.storeAs = { redirectUris: [`${LOCAL}${CB}`], jsOrigins: [NEW] };
        const r = recipe();
        await r.read();
        expect(await r.write(next)).toEqual({ saved: standIn.set.storeAs });
      });

      it("a reload between read and write aborts before any edit: no Save", async () => {
        standIn.lists = structuredClone(before);
        const r = recipe();
        await r.read();
        await page.goto(standIn.clientUrl);
        await expect(r.write(next)).rejects.toThrow(
          "The client page reloaded after busbar read it, so busbar didn't press Save. Nothing was changed.",
        );
        expect(standIn.saves).toEqual([]);
        expect(standIn.requests).toEqual([PAGE, PAGE]);
      });

      const OTHER = {
        redirectUris: ["https://other.example/api/auth/callback/google"],
        jsOrigins: ["https://other.example"],
      };

      it("an in-app route change to another client after the read: refuses before any click, no Save", async () => {
        standIn.lists = structuredClone(before);
        standIn.set.route = {
          path: `/auth/clients/111111111111-other.apps.googleusercontent.com?project=${STAND_IN.projectId}`,
          lists: OTHER,
        };
        const r = recipe();
        await r.read();
        await page.click("#bb-route");
        await expect(r.write(next)).rejects.toThrow(
          "The client page moved to another address after busbar read it, so busbar didn't press Save. Nothing was changed.",
        );
        expect(await page.values(SELECTORS.redirectUriInputs)).toEqual(OTHER.redirectUris);
        expect(await page.values(SELECTORS.jsOriginInputs)).toEqual(OTHER.jsOrigins);
        expect(standIn.saves).toEqual([]);
        expect(standIn.requests).toEqual([PAGE]);
      });

      it("lists that changed on the page after the read, at the same address: refuses before any click, no Save", async () => {
        standIn.lists = structuredClone(before);
        standIn.set.route = { path: PAGE, lists: OTHER };
        const r = recipe();
        await r.read();
        await page.click("#bb-route");
        await expect(r.write(next)).rejects.toThrow(
          "The client's lists on the page changed after busbar read them, so busbar didn't press Save. Nothing was changed.",
        );
        expect(await page.values(SELECTORS.redirectUriInputs)).toEqual(OTHER.redirectUris);
        expect(await page.values(SELECTORS.jsOriginInputs)).toEqual(OTHER.jsOrigins);
        expect(standIn.saves).toEqual([]);
        expect(standIn.requests).toEqual([PAGE]);
      });

      it("edits that didn't take on the page: no Save", async () => {
        standIn.lists = structuredClone(before);
        standIn.set.rewrite = [["onclick: () => remove(li)", "onclick: () => {}"]];
        const r = recipe();
        await r.read();
        await expect(r.write(next)).rejects.toThrow(
          "busbar's edits didn't show on the client page as planned, so it didn't press Save. Nothing was changed.",
        );
        expect(standIn.saves).toEqual([]);
      });

      it("a Save with no confirmation fails without claiming anything was saved", async () => {
        standIn.lists = structuredClone(before);
        standIn.set.rewrite = [['id="toast" role="status"', 'id="toast"']];
        const r = recipe();
        await r.read();
        await expect(r.write(next)).rejects.toThrow(
          "busbar pressed Save, but Google showed neither a confirmation nor an error. busbar can't tell what was saved: run `bb plan` to read the client again.",
        );
      });

      it("a read-back that can't be read after a confirmed Save never says nothing changed", async () => {
        standIn.lists = structuredClone(before);
        const r = recipe();
        await r.read();
        standIn.set.rewrite = [['list("Authorized redirect URIs"', 'list("Redirect URIs"']];
        await expect(r.write(next)).rejects.toThrow(
          "Google confirmed the Save, but busbar couldn't read the client back (Google console layout changed: `redirectUris` not found). Run `bb plan` to see what it holds.",
        );
        expect(standIn.saves).toEqual([next]);
      });

      it("a sign-in bounce at the read-back after a confirmed Save says the Save went through", async () => {
        standIn.lists = structuredClone(before);
        const r = recipe();
        await r.read();
        standIn.set.reauth = "redirect";
        const err = await r.write(next).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ReauthRequired);
        expect((err as ReauthRequired).afterSave).toBe(true);
        expect((err as ReauthRequired).url).toMatch(
          new RegExp(`^${standIn.accountsOrigin}/v3/signin/identifier\\?continue=`),
        );
        expect((err as Error).message).toBe(
          "Google confirmed the Save, then sent busbar's profile to sign-in before busbar could read the client back.",
        );
        expect(standIn.saves).toEqual([next]);
      });

      it.each([
        [
          "a status banner already on the page",
          { status: "Changes may take a few minutes to take effect" },
        ],
        ["an alert banner already on the page", { alert: "This client is used by 2 apps" }],
      ])("waits for Google's answer to this Save, not %s", async (_, banner) => {
        standIn.lists = structuredClone(before);
        standIn.set.banner = banner;
        standIn.set.saveDelayMs = 400;
        const r = recipe();
        await r.read();
        expect(await r.write(next)).toEqual({ saved: next });
        expect(standIn.requests).toEqual([PAGE, SAVE, PAGE]);
      });

      it("waits past a Saving… status for the final confirmation", async () => {
        standIn.lists = structuredClone(before);
        standIn.set.savingText = "Saving…";
        standIn.set.saveDelayMs = 400;
        const r = recipe();
        await r.read();
        expect(await r.write(next)).toEqual({ saved: next });
        expect(standIn.requests).toEqual([PAGE, SAVE, PAGE]);
      });

      it("a Save Google refuses is SaveRejected, in Google's own words", async () => {
        standIn.lists = structuredClone(before);
        standIn.set.saveError =
          "Invalid Redirect: must end with a public top-level domain (such as .com or .org).";
        const r = recipe();
        await r.read();
        const err = await r.write(next).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(SaveRejected);
        expect((err as SaveRejected).googleText).toBe(standIn.set.saveError);
        expect((err as Error).message).toBe(
          "Google didn't save the client: Invalid Redirect: must end with a public top-level domain (such as .com or .org).",
        );
        expect(standIn.lists).toEqual(before);
      });
    });

    it("Page.fill replaces an entry so the page's framework sees the new text, not the old", async () => {
      standIn.lists = { redirectUris: ["http://localhost:3000/cb"], jsOrigins: [] };
      standIn.saves.length = 0;
      await page.goto(standIn.clientUrl);
      expect(await page.exists(SELECTORS.redirectUriInputs, 2000)).toBe(true);
      await page.fill(SELECTORS.redirectUriInputs, 0, "http://localhost:4000/cb");
      await page.click('form[aria-label="OAuth client"] button[type="submit"]');
      expect(await page.exists("#toast:not(:empty)", 5000)).toBe(true);
      expect(standIn.saves).toEqual([
        { redirectUris: ["http://localhost:4000/cb"], jsOrigins: [] },
      ]);
    });

    it("takes a PNG of the page for --debug", async () => {
      const r = recipe();
      await r.read();
      expect(Buffer.from((await r.screenshot()).subarray(1, 4)).toString()).toBe("PNG");
    });
  });
});
