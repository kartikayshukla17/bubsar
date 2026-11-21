import { describe, expect, it } from "vitest";
import { boardAt, type Moment } from "~/lib/demo";

// Guard for `?at=` replays (screenshots, stageshow, the video). The snapshot was taken
// from the UI kit as shipped, before the model moved into src/core. Only what the board
// draws is pinned: phase, cursor, focus and each strip's bay/mark/note.
const moments: Moment[] = ["drift", "planned", "handoff", "applied", "verified"];

describe("demo replay", () => {
  it.each(moments)("?at=%s draws the same board as the shipped kit", (at) => {
    const { phase, cursor, focus, strips } = boardAt(at);
    expect({ phase, cursor, focus, strips }).toMatchSnapshot();
  });
});
