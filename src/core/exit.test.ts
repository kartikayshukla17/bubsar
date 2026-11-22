import { describe, expect, it } from "vitest";
import { type Ending, exitCode } from "./exit";

describe("exit code", () => {
  it.each([
    [{ ended: "finished", required: [] }, 0],
    [{ ended: "finished", required: ["accepted", "accepted"] }, 0],
    [{ ended: "finished", required: ["accepted", "rejected"] }, 3],
    [{ ended: "finished", required: ["unknown"] }, 3],
    [{ ended: "failed" }, 1],
    [{ ended: "stopped" }, 2],
  ] as [Ending, number][])("%j → %i", (ending, code) => {
    expect(exitCode(ending)).toBe(code);
  });
});
