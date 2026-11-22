import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Lists } from "./recipes/google/console";
import { ensureRunDir, RUN_DIR, writeAtomic } from "./run";

/** One functional check of a redirect URI (BB-05). */
export type Check = {
  at: string;
  uri: string;
  result: "accepted" | "rejected" | "unknown";
  status: number | null;
};

export type GoogleState = {
  /** Entries busbar added. Only these (and `--adopt`ed ones) are ever removed. */
  owned: Lists;
  /** The last plan that read the console: what it read, and the lists it leads to. */
  planned: { read: Lists; next: Lists } | null;
  checks: Check[];
};

/** `.busbar/state.json`: what busbar knows about the providers. Public, no secrets. */
export type State = { google?: GoogleState };

const FILE = "state.json";
const empty = (): Lists => ({ redirectUris: [], jsOrigins: [] });
const isList = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * Read `state.json` ({} when absent). Ownership decides what busbar may delete, so an
 * `owned` that isn't two lists of URLs is refused, never guessed at.
 */
export function readState(projectDir: string): State {
  const file = join(projectDir, RUN_DIR, FILE);
  if (!existsSync(file)) return {};
  const where = `${RUN_DIR}/${FILE}`;
  let state: State;
  try {
    state = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${where} isn't valid JSON (${(e as Error).message}). Fix or delete it.`);
  }
  const owned = state.google?.owned;
  if (owned && !(isList(owned.redirectUris) && isList(owned.jsOrigins)))
    throw new Error(
      `${where}: google.owned should hold two lists of URLs, redirectUris and jsOrigins. Fix it, or delete the file and busbar treats no entry as its own.`,
    );
  return state;
}

/** The Google section with defaults filled in. */
export function googleState(state: State): GoogleState {
  return {
    owned: state.google?.owned ?? empty(),
    planned: state.google?.planned ?? null,
    checks: state.google?.checks ?? [],
  };
}

export function writeState(projectDir: string, state: State) {
  writeAtomic(join(ensureRunDir(projectDir), FILE), `${JSON.stringify(state, null, 2)}\n`);
}
