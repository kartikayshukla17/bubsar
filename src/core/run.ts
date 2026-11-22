import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  type Action,
  type BoardState,
  type Destination,
  initialBoard,
  reduce,
  type Value,
} from "./board";
import { type Config, refsIn } from "./config";
import { FLAGS } from "./plan";

/**
 * Run state, in the project's `.busbar/`. `run.json` is the latest snapshot; `events.jsonl`
 * holds the run's Actions in order. Both are public: secrets appear only as fingerprints.
 */
export type Run = {
  run: string;
  seq: number;
  project: string;
  destinations: Destination[];
  values: Value[];
  board: BoardState;
};
export type RunEvent = { run: string; seq: number; action: Action };

export const RUN_DIR = ".busbar";

const DESTINATIONS: Record<string, Omit<Destination, "id">> = {
  google: { name: "Google", where: "OAuth web client" },
};

/** What the board draws for this config: its destinations, and each value with its routes. */
export function describe(config: Config, resolved: Record<string, string>) {
  const google = config.destinations.google;
  const destinations: Destination[] = google ? [{ id: "google", ...DESTINATIONS.google }] : [];
  const values: Value[] = Object.keys(config.values).map((id) => ({
    id,
    kind: "URL",
    secret: false,
    literal: resolved[id],
    origin: FLAGS[id] ?? id,
    routes:
      google && [...google.redirect_uris, ...google.js_origins].some((t) => refsIn(t).includes(id))
        ? ["google"]
        : [],
    rest: "unknown",
  }));
  return { destinations, values };
}

/** Write a file so a reader never sees it half-written. */
export function writeAtomic(path: string, text: string) {
  writeFileSync(`${path}.tmp`, text);
  renameSync(`${path}.tmp`, path);
}

/** The project's `.busbar/`, created on first use. Returns its path. */
export function ensureRunDir(projectDir: string) {
  const dir = join(projectDir, RUN_DIR);
  mkdirSync(dir, { recursive: true });
  // Keeps run state out of git without the user editing their .gitignore.
  writeFileSync(join(dir, ".gitignore"), "*\n");
  return dir;
}

/**
 * Start a new run with its first Action. The snapshot is written before the event, so a
 * reader that sees a new run id in the stream can always fetch the matching snapshot.
 */
export function startRun(
  projectDir: string,
  base: Omit<Run, "run" | "seq" | "board">,
  first: Action,
): Run {
  const dir = ensureRunDir(projectDir);
  const run: Run = { ...base, run: randomUUID(), seq: 1, board: reduce(initialBoard(), first) };
  writeAtomic(join(dir, "run.json"), `${JSON.stringify(run, null, 2)}\n`);
  const event: RunEvent = { run: run.run, seq: 1, action: first };
  writeAtomic(join(dir, "events.jsonl"), `${JSON.stringify(event)}\n`);
  return run;
}

export function readRun(projectDir: string): Run | null {
  const file = join(projectDir, RUN_DIR, "run.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Run) : null;
}

export function appendEvent(projectDir: string, action: Action): Run {
  const run = readRun(projectDir);
  if (!run) throw new Error("no run to add to: .busbar/run.json is missing");
  const dir = ensureRunDir(projectDir);
  const next: Run = { ...run, seq: run.seq + 1, board: reduce(run.board, action) };
  writeAtomic(join(dir, "run.json"), `${JSON.stringify(next, null, 2)}\n`);
  const event: RunEvent = { run: next.run, seq: next.seq, action };
  appendFileSync(join(dir, "events.jsonl"), `${JSON.stringify(event)}\n`);
  return next;
}
