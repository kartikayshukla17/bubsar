import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { type AddressInfo, connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { automationLaunchOptions } from "../src/core/browser/args";
import { PuppeteerDriver } from "../src/core/browser/puppeteer";
import { skippedBrowsers, testBrowsers } from "./helpers/browser";

// Installed Brave and Firefox (see helpers/browser.ts for why not Dia), headless, on a
// throwaway profile, with the mock keychain so macOS never asks for Keychain access, and
// loopback-only networking so neither the test nor the browser's own background traffic
// leaves this machine.

const PAGE = `<!doctype html><title>stand-in</title>
<ul id="list"><li><input name="uri" value="https://a.example/cb"></li><li><input name="uri" value="https://b.example/cb"></li></ul>
<button id="add" onclick="document.querySelector('#toast').textContent = 'Saved ' + [...document.querySelectorAll('[name=uri]')].map(i => i.value).join(',')">Add</button>
<p id="toast"></p>`;

let origin = "";
const server = createServer((_, res) =>
  res.writeHead(200, { "content-type": "text/html" }).end(PAGE),
);
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
});

const driver = new PuppeteerDriver({ keychain: "mock", loopbackOnly: true });

for (const why of skippedBrowsers) it.skip(why, () => {});

describe.skipIf(testBrowsers.length === 0)("PuppeteerDriver", () => {
  describe.each(testBrowsers)("on $name", (browser) => {
    it("attaches headless to a temp profile and drives a local page", async () => {
      const profile = mkdtempSync(join(tmpdir(), "bb-profile-"));
      const page = await driver.attach(browser, profile, { headless: true });
      try {
        await page.goto(`${origin}/client`);
        expect(await page.url()).toBe(`${origin}/client`);
        expect(await page.exists("[name=uri]", 2000)).toBe(true);
        expect(await page.exists("#missing", 100)).toBe(false);
        expect(await page.values("[name=uri]")).toEqual([
          "https://a.example/cb",
          "https://b.example/cb",
        ]);

        await page.fill("[name=uri]", 1, "https://c.example/cb");
        await page.click("#add");
        expect(await page.text("#toast")).toBe("Saved https://a.example/cb,https://c.example/cb");
        expect(await page.text("#missing")).toBeNull();
      } finally {
        await page.close();
      }
      if (browser.engine === "chromium") {
        expect(existsSync(join(profile, "Default"))).toBe(true);
        expect(readdirSync(profile)).not.toContain("SingletonLock");
      } else {
        expect(existsSync(join(profile, "compatibility.ini"))).toBe(true);
      }
    }, 30_000);

    it("kill() ends the automated browser at once: its page can't load anything after", async () => {
      const page = await driver.attach(browser, mkdtempSync(join(tmpdir(), "bb-profile-")), {
        headless: true,
      });
      try {
        await page.goto(`${origin}/client`);
        page.kill();
        await expect(page.goto(`${origin}/again`)).rejects.toThrow();
      } finally {
        await page.close().catch(() => {});
      }
    }, 30_000);

    it.skipIf(browser.engine !== "firefox")(
      "BiDi listens on loopback only, and nothing listens once the step has closed",
      async () => {
        const { default: puppeteer } = await import("puppeteer-core");
        const profile = mkdtempSync(join(tmpdir(), "bb-profile-"));
        const b = await puppeteer.launch(
          automationLaunchOptions(browser, profile, {
            headless: true,
            keychain: "mock",
            loopbackOnly: true,
          }),
        );
        let endpoint: URL;
        let pid: number;
        try {
          endpoint = new URL(b.wsEndpoint());
          pid = b.process()?.pid ?? 0;
          expect(["127.0.0.1", "localhost", "[::1]"]).toContain(endpoint.hostname);
          expect(pid).toBeGreaterThan(0);
        } finally {
          await b.close();
        }
        expect(() => process.kill(pid, 0)).toThrow();
        const host = endpoint.hostname.replace(/^\[|\]$/g, "");
        const refused = await new Promise<string>((done) => {
          const socket = connect(Number(endpoint.port), host);
          socket.once("connect", () => {
            socket.destroy();
            done("connected");
          });
          socket.once("error", (e: NodeJS.ErrnoException) => done(e.code ?? e.message));
        });
        expect(refused).toBe("ECONNREFUSED");
      },
      30_000,
    );

    it.skipIf(browser.engine !== "firefox")(
      "leaves the profile's prefs as they were: no Puppeteer user.js, prefs.js untouched",
      async () => {
        const profile = mkdtempSync(join(tmpdir(), "bb-profile-"));
        const before = 'user_pref("browser.startup.page", 3);\n';
        writeFileSync(join(profile, "prefs.js"), before);
        const page = await driver.attach(browser, profile, { headless: true });
        try {
          await page.goto(`${origin}/client`);
        } finally {
          await page.close();
        }
        const left = readdirSync(profile);
        expect(left).not.toContain("user.js");
        expect(left.filter((f) => f.endsWith(".puppeteer"))).toEqual([]);
        expect(readFileSync(join(profile, "prefs.js"), "utf8")).toBe(before);
      },
      30_000,
    );
  });
});
