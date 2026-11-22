import { readFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

export type Fixture = {
  expect: string;
  status: number;
  headers: Record<string, string>;
  body: string;
};

export function fixture(name: string): Fixture {
  const text = readFileSync(
    new URL(`../fixtures/google-auth/${name}.http`, import.meta.url),
    "utf8",
  );
  const lines = text.split("\n");
  const notes = lines.filter((l) => l.startsWith("#"));
  const rest = lines.slice(notes.length);
  const blank = rest.indexOf("");
  const status = Number(rest[0].split(" ")[1]);
  const headers = Object.fromEntries(
    rest.slice(1, blank).map((h) => {
      const i = h.indexOf(":");
      return [h.slice(0, i).trim().toLowerCase(), h.slice(i + 1).trim()];
    }),
  );
  const expect =
    notes
      .find((n) => n.startsWith("# Expect:"))
      ?.split(":")[1]
      .trim() ?? "";
  return { expect, status, headers, body: rest.slice(blank + 1).join("\n") };
}

export function answerOf(name: string) {
  const f = fixture(name);
  return { status: f.status, location: f.headers.location ?? null, body: f.body };
}

export type Seen = {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: IncomingHttpHeaders;
};

export type AuthStub = {
  url: string;
  origin: string;
  requests: Seen[];
  close(): Promise<void>;
};

export async function authStub(
  answer: (redirectUri: string, nth: number) => string | Omit<Fixture, "expect">,
): Promise<AuthStub> {
  const requests: Seen[] = [];
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://stub");
    const query = Object.fromEntries(u.searchParams);
    requests.push({ method: req.method ?? "", path: u.pathname, query, headers: req.headers });
    if (u.pathname !== "/o/oauth2/v2/auth") {
      res.writeHead(404).end();
      return;
    }
    const uri = query.redirect_uri ?? "";
    const nth = requests.filter((r) => r.query.redirect_uri === uri).length - 1;
    const picked = answer(uri, nth);
    const f = typeof picked === "string" ? fixture(picked) : picked;
    res.writeHead(f.status, f.headers).end(f.body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url: `${origin}/o/oauth2/v2/auth`,
    origin,
    requests,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

export async function deadAuthUrl() {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((r) => server.close(() => r()));
  return `http://127.0.0.1:${port}/o/oauth2/v2/auth`;
}
