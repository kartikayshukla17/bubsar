// The UI's view of the run model. Everything shared with the CLI lives in src/core; this
// file adds only what the board draws: sector-map rows and route/value marks.

import type { BoardState, Destination, DestinationId, Mark, Value } from "../../src/core/board";

export * from "../../src/core/board";

/** `y` is the sector-map row, 0–500 viewBox units. Layout only; never part of run state. */
export type DestinationRow = Destination & { y: number };
export type ValueRow = Value & { y: number };

const WORST_FIRST: Mark[] = [
  "failed",
  "rejected",
  "drift",
  "handoff",
  "active",
  "checking",
  "planned",
  "unknown",
  "unexercised",
  "applied",
  "verified",
];

const worst = (marks: Mark[]): Mark => WORST_FIRST.find((m) => marks.includes(m)) ?? "unknown";

/** State of the route value → destination, as the sector map draws it: the worst of its strips there. */
export function routeMark(s: BoardState, value: Value, dest: DestinationId): Mark {
  if (value.id === "tunnel.url")
    return worst(s.steps.filter((x) => x.destination === dest).map((x) => s.strips[x.id].mark));
  if (value.id === "WHATSAPP_VERIFY_TOKEN" && dest === "meta") {
    const m = s.strips.meta.mark;
    return m === "drift" || m === "planned" ? "verified" : m;
  }
  return value.rest;
}

export function valueMark(s: BoardState, value: Value): Mark {
  return worst(value.routes.map((d) => routeMark(s, value, d)));
}

/** Everything the board draws besides the strips: whose run, what it wires, how to drive it. */
export type Scene = {
  project: string;
  destinations: DestinationRow[];
  values: ValueRow[];
  /** the command shown in the flight bar */
  command: string;
  /** live mirrors .busbar/ through bb ui; demo is the synthetic kit run */
  live: boolean;
};

/** Centre rows on the sector map at the kit's pitch (64 per destination, 80 per value). */
export function layout(destinations: Destination[], values: Value[]) {
  const rows = <T>(xs: T[], pitch: number) =>
    xs.map((x, i) => ({ ...x, y: 250 + (i - (xs.length - 1) / 2) * pitch }));
  return { destinations: rows(destinations, 64), values: rows(values, 80) };
}
