import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PuppeteerDriver } from "../src/core/browser/puppeteer";
import { testBrowser as browser } from "./helpers/browser";

// Installed Brave (see helpers/browser.ts for why not Dia), headless, on a throwaway profile,
// with the mock keychain so macOS never asks for Keychain access, and loopback-only
// networking so neither the test nor the browser's own background traffic leaves this machine.

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

describe.skipIf(!browser)(`PuppeteerDriver on ${browser?.name ?? "no Brave installed"}`, () => {
  it("attaches headless to a temp profile and drives a local page", async () => {
    if (!browser) return;
    const profile = mkdtempSync(join(tmpdir(), "bb-profile-"));
    const page = await new PuppeteerDriver({ keychain: "mock", loopbackOnly: true }).attach(
      browser,
      profile,
      {
        headless: true,
      },
    );
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
    // The browser really ran on busbar's profile dir, not a Puppeteer temp one.
    expect(existsSync(join(profile, "Default"))).toBe(true);
    expect(readdirSync(profile)).not.toContain("SingletonLock");
  }, 30_000);
});
