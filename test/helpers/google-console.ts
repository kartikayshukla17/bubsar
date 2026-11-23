import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Lists } from "../../src/core/recipes/google/console";

/** The page's state script, which the server fills with the client's lists and switches. */
const STATE_TAG = '<script id="bb-state" type="application/json">';
const PLACEHOLDER = '"BB_STATE"';
const PAGE = readFileSync(
  new URL("../fixtures/google-console/client.html", import.meta.url),
  "utf8",
);

/** The stand-in's fake client. Scrubbed by construction: there is no secret to leak. */
export const STAND_IN = {
  clientId: "000000000000-standin.apps.googleusercontent.com",
  projectId: "busbar-stand-in",
};

export type StandIn = {
  /** Replaces https://console.cloud.google.com (BB_GOOGLE_CONSOLE_ORIGIN). */
  origin: string;
  /** Plays accounts.google.com: a second loopback port, so it's a different host. */
  accountsOrigin: string;
  /** The client page's deep link: `${origin}/auth/clients/<client_id>?project=<project_id>`. */
  clientUrl: string;
  /** The client's lists as the server holds them. Mutable: change them between loads. */
  lists: Lists;
  /** Switches, read on every request. */
  set: {
    /** Delay before the SPA renders the form, in ms. */
    renderDelayMs: number;
    /** Simulate a sign-in bounce: an HTTP 302, or a script redirect after load. */
    reauth: "redirect" | "script" | null;
    /** Save answers 400 with this text, as Google shows a validation error. */
    saveError: string | null;
    storeAs: Lists | null;
    saveDelayMs: number;
    banner: { status?: string; alert?: string } | null;
    savingText: string | null;
    /** Renders a link (`#bb-route`) that changes route in-app to `path` and shows `lists`, as the console's SPA does. */
    route: { path: string; lists: Lists } | null;
    /** Text replacements over the served page: drift the DOM without editing the fixture. */
    rewrite: [string, string][];
  };
  /** Path + query of every request the console origin served, in order. */
  requests: string[];
  /** Every list pair a Save sent, in order. */
  saves: Lists[];
  close(): Promise<void>;
};

const listen = async (handler: (req: IncomingMessage, res: ServerResponse) => void) => {
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
};

const body = (req: IncomingMessage) =>
  new Promise<string>((done) => {
    let text = "";
    req.on("data", (c) => {
      text += c;
    });
    req.on("end", () => done(text));
  });

/**
 * Serve the stand-in OAuth client page on 127.0.0.1, with mutable lists, Add URI, per-entry
 * delete, Save with a saved toast, and switches for a save error or a sign-in bounce.
 */
export async function standInConsole(init: Partial<Lists> = {}): Promise<StandIn> {
  const accounts = await listen((_, res) => {
    res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><h1>Sign in</h1>");
  });
  const s = {
    lists: { redirectUris: [], jsOrigins: [], ...init },
    set: {
      renderDelayMs: 150,
      reauth: null,
      saveError: null,
      storeAs: null,
      saveDelayMs: 0,
      banner: null,
      savingText: null,
      route: null,
      rewrite: [],
    },
    requests: [],
    saves: [],
  } as Pick<StandIn, "lists" | "set" | "requests" | "saves">;
  const path = `/auth/clients/${STAND_IN.clientId}`;
  const query = `?project=${STAND_IN.projectId}`;

  const consoleSite = await listen(async (req, res) => {
    const url = req.url ?? "/";
    s.requests.push(url);
    const json = (status: number, v: unknown) =>
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(v));
    if (req.method === "POST" && url === `${path}/save${query}`) {
      const next = JSON.parse(await body(req)) as Lists;
      await new Promise((r) => setTimeout(r, s.set.saveDelayMs));
      if (s.set.saveError) return json(400, { error: s.set.saveError });
      s.lists = s.set.storeAs ?? next;
      s.saves.push(next);
      return json(200, { saved: next });
    }
    if (req.method !== "GET" || url !== `${path}${query}`)
      return res.writeHead(404, { "content-type": "text/html" }).end("<h1>Not found</h1>");
    if (s.set.reauth === "redirect")
      return res
        .writeHead(302, {
          location: `${accounts.origin}/v3/signin/identifier?continue=${encodeURIComponent(url)}`,
        })
        .end();
    const state = {
      clientId: STAND_IN.clientId,
      lists: s.lists,
      renderDelayMs: s.set.renderDelayMs,
      reauth: s.set.reauth,
      accountsOrigin: accounts.origin,
      banner: s.set.banner,
      savingText: s.set.savingText,
      route: s.set.route,
    };
    const data = JSON.stringify(state).replace(/</g, "\\u003c");
    let html = PAGE.replace(`${STATE_TAG}${PLACEHOLDER}`, () => `${STATE_TAG}${data}`);
    for (const [from, to] of s.set.rewrite) html = html.replaceAll(from, to);
    res.writeHead(200, { "content-type": "text/html" }).end(html);
  });

  return Object.assign(s, {
    origin: consoleSite.origin,
    accountsOrigin: accounts.origin,
    clientUrl: `${consoleSite.origin}${path}${query}`,
    close: async () => {
      consoleSite.server.closeAllConnections();
      accounts.server.closeAllConnections();
      await Promise.all(
        [consoleSite.server, accounts.server].map((x) => new Promise((r) => x.close(r))),
      );
    },
  });
}
