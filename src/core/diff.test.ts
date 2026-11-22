import { describe, expect, it } from "vitest";
import { diff } from "./diff";

const NEW = "https://new.ngrok-free.app";
const OLD = "https://old.ngrok-free.app";
const CB = "/api/auth/callback/google";
const none = { redirectUris: [], jsOrigins: [] };

describe("diff: what busbar does to each entry", () => {
  it("adds a desired entry the console doesn't have", () => {
    const d = diff(none, { redirectUris: [`${NEW}${CB}`], jsOrigins: [NEW] }, none, {
      adopt: false,
    });
    expect(d.redirectUris.entries).toEqual([{ url: `${NEW}${CB}`, change: "add" }]);
    expect(d.jsOrigins.entries).toEqual([{ url: NEW, change: "add" }]);
    expect(d.redirectUris.next).toEqual([`${NEW}${CB}`]);
  });

  it("removes an entry busbar added that is no longer desired, and keeps one it didn't add", () => {
    const local = "http://localhost:3000";
    const d = diff(
      { redirectUris: [`${local}${CB}`, `${OLD}${CB}`], jsOrigins: [] },
      { redirectUris: [`${NEW}${CB}`], jsOrigins: [] },
      { redirectUris: [`${OLD}${CB}`], jsOrigins: [] },
      { adopt: false },
    );
    expect(d.redirectUris.entries).toEqual([
      { url: `${NEW}${CB}`, change: "add" },
      { url: `${OLD}${CB}`, change: "remove", why: "busbar added it" },
      { url: `${local}${CB}`, change: "keep", why: "not busbar's" },
    ]);
    expect(d.redirectUris.next).toEqual([`${local}${CB}`, `${NEW}${CB}`]);
  });

  it("keeps an entry that is already there and still desired, even when busbar owns it", () => {
    const d = diff(
      { redirectUris: [], jsOrigins: [NEW] },
      { redirectUris: [], jsOrigins: [NEW] },
      { redirectUris: [], jsOrigins: [NEW] },
      { adopt: false },
    );
    expect(d.jsOrigins).toEqual({
      entries: [{ url: NEW, change: "keep", why: "already there" }],
      next: [NEW],
    });
  });

  it.each([
    "https://x.ngrok-free.app",
    "https://x.ngrok.app",
    "https://x.ngrok.io",
    "https://two-words.trycloudflare.com",
    "https://x.loca.lt",
  ])("keeps %s, not busbar's but on a tunnel host, flagged likely stale", (stale) => {
    const d = diff(
      { redirectUris: [`${stale}${CB}`], jsOrigins: [stale] },
      { redirectUris: [], jsOrigins: [] },
      none,
      { adopt: false },
    );
    expect(d.redirectUris.entries).toEqual([
      { url: `${stale}${CB}`, change: "stale", why: "not busbar's" },
    ]);
    expect(d.jsOrigins.entries).toEqual([{ url: stale, change: "stale", why: "not busbar's" }]);
    expect(d.redirectUris.next).toEqual([`${stale}${CB}`]);
  });

  it.each([
    ["the bare tunnel domain", "https://ngrok-free.app"],
    ["a lookalike domain", "https://x.notngrok.io"],
    ["localhost", "http://localhost:3000"],
    ["a value that isn't a URL", "not a url"],
  ])("doesn't flag %s as a tunnel", (_, url) => {
    const d = diff({ redirectUris: [url], jsOrigins: [] }, none, none, { adopt: false });
    expect(d.redirectUris.entries).toEqual([{ url, change: "keep", why: "not busbar's" }]);
  });

  it("with --adopt, removes a likely-stale entry, and still keeps entries that aren't tunnels", () => {
    const local = "http://localhost:3000";
    const stale = "https://x.ngrok-free.app";
    const d = diff(
      { redirectUris: [], jsOrigins: [local, stale, NEW] },
      { redirectUris: [], jsOrigins: [NEW] },
      none,
      { adopt: true },
    );
    expect(d.jsOrigins).toEqual({
      entries: [
        { url: stale, change: "remove", why: "adopted" },
        { url: local, change: "keep", why: "not busbar's" },
        { url: NEW, change: "keep", why: "already there" },
      ],
      next: [local, NEW],
    });
  });
});
