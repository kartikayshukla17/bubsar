import type { Check } from "./state";

export type ExitCode = 0 | 1 | 2 | 3;

export type Ending =
  | { ended: "failed" }
  | { ended: "stopped" }
  | { ended: "finished"; required: Check["result"][] };

export function exitCode(e: Ending): ExitCode {
  switch (e.ended) {
    case "failed":
      return 1;
    case "stopped":
      return 2;
    case "finished":
      return e.required.every((r) => r === "accepted") ? 0 : 3;
  }
}
