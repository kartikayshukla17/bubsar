import {
  createReadStream,
  existsSync,
  readFileSync,
  statSync,
  unwatchFile,
  watchFile,
} from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, resolve, sep } from "node:path";
import { KNOWN } from "../core/browser/browsers";
import { RUN_DIR } from "../core/run";
import { type Local, readLocal } from "../core/session";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

/**
 * `bb ui`: a loopback-only server for the built SPA, the run snapshot (`GET /api/run`), the
 * run's events as they're appended (`GET /api/events`, SSE) and the provider sessions from
 * `local.json` (`GET /api/session`). Read-only: it never writes run state and never talks to
 * a provider.
 */
export function serve(
  projectDir: string,
  clientDir: string,
): Promise<{ url: URL; close: () => void }> {
  const runFile = join(projectDir, RUN_DIR, "run.json");
  const eventsFile = join(projectDir, RUN_DIR, "events.jsonl");
  const localFile = join(projectDir, RUN_DIR, "local.json");
  const clients = new Set<ServerResponse>();

  // Tail events.jsonl. A new run replaces the file, so a new inode or a shorter file
  // means read from the start. stat polling survives the file being replaced or absent.
  let ino = 0;
  let offset = 0;
  let partial = "";
  const sizeNow = () => {
    try {
      const st = statSync(eventsFile);
      ino = st.ino;
      offset = st.size;
    } catch {}
  };
  sizeNow();
  const onChange = () => {
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(eventsFile);
    } catch {
      return;
    }
    if (st.ino !== ino || st.size < offset) {
      ino = st.ino;
      offset = 0;
      partial = "";
    }
    if (st.size === offset) return;
    const start = offset;
    offset = st.size;
    const chunks: Buffer[] = [];
    createReadStream(eventsFile, { start, end: st.size - 1 })
      .on("data", (c) => chunks.push(c as Buffer))
      .on("end", () => {
        const lines = (partial + Buffer.concat(chunks).toString("utf8")).split("\n");
        partial = lines.pop() ?? "";
        for (const line of lines) if (line) for (const c of clients) c.write(`data: ${line}\n\n`);
      });
  };
  watchFile(eventsFile, { interval: 100 }, onChange);

  // login/status/logout rewrite local.json; the board's session chip follows.
  const onSession = () => {
    const data = JSON.stringify(session(projectDir));
    for (const c of clients) c.write(`event: session\ndata: ${data}\n\n`);
  };
  watchFile(localFile, { interval: 100 }, onSession);

  const server = createServer((req, res) => {
    const { port } = server.address() as AddressInfo;
    // Loopback bind stops other machines; the Host check stops a web page from reaching
    // this server through DNS rebinding.
    if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) {
      res.writeHead(403).end("bb ui only answers on 127.0.0.1\n");
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405).end();
      return;
    }
    const path = new URL(req.url ?? "/", "http://x").pathname;

    if (path === "/api/run") {
      if (!existsSync(runFile)) {
        res.writeHead(404, { "content-type": "application/json" }).end('{"error":"no run yet"}');
        return;
      }
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(readFileSync(runFile));
      return;
    }

    if (path === "/api/session") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(session(projectDir)));
      return;
    }

    if (path === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      res.write(": busbar\n\n");
      clients.add(res);
      const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
      req.on("close", () => {
        clearInterval(ping);
        clients.delete(res);
      });
      return;
    }

    // The SPA: real files, otherwise index.html for client-side routes.
    const root = resolve(clientDir);
    let file = resolve(root, `.${path}`);
    if (!file.startsWith(root + sep) || !existsSync(file) || statSync(file).isDirectory()) {
      file = join(root, "index.html");
    }
    if (!existsSync(file)) {
      res
        .writeHead(500, { "content-type": "text/plain" })
        .end("bb ui has no built board. Run npm run build.\n");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });

  return new Promise((done) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      done({
        url: new URL(`http://127.0.0.1:${port}/`),
        close: () => {
          unwatchFile(eventsFile, onChange);
          unwatchFile(localFile, onSession);
          for (const c of clients) c.end();
          server.close();
        },
      });
    });
  });
}

/** `local.json`'s sessions, plus each browser's display name for the board's chip. */
function session(projectDir: string) {
  let google: Local["google"];
  try {
    google = readLocal(projectDir).google;
  } catch {
    return {}; // unreadable local.json: show no session rather than take the board down
  }
  if (!google) return {};
  const browserName = KNOWN.find((k) => k.id === google.browser)?.name ?? google.browser;
  return { google: { ...google, browserName } };
}
