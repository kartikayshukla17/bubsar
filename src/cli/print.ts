import type { Step } from "../core/board";
import type { Config } from "../core/config";

/** `bb plan` output. Plain text: every write, in order, with what it replaces. */
export function printPlan(config: Config, steps: Step[]): string {
  const width = Math.max(...steps.map((s) => s.field.length));
  const lines = [`busbar plan · ${config.project.name}`, ""];
  const google = config.destinations.google;
  if (google) lines.push(`Google · OAuth web client ${google.client_id} in ${google.project_id}`);
  steps.forEach((s, i) => {
    const n = String(i + 1).padStart(2, "0");
    lines.push(`  ${n}  ${s.field.padEnd(width)}  ${s.from ?? "unknown"} → ${s.to}`);
  });
  lines.push(
    "",
    `${steps.length} ${steps.length === 1 ? "write" : "writes"} planned. Nothing has changed yet.`,
    "Current entries show as unknown: busbar doesn't read the console yet.",
    "",
  );
  return lines.join("\n");
}
