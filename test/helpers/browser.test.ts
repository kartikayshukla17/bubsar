import { describe, expect, it } from "vitest";
import type { InstalledBrowser } from "../../src/core/browser/browsers";
import { isQuarantined, pickTestBrowsers } from "./browser";

const brave: InstalledBrowser = {
  id: "brave",
  name: "Brave",
  executable: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  engine: "chromium",
};
const dia: InstalledBrowser = {
  id: "dia",
  name: "Dia",
  executable: "/Applications/Dia.app/Contents/MacOS/Dia",
  engine: "chromium",
};
const firefox: InstalledBrowser = {
  id: "firefox",
  name: "Firefox",
  executable: "/Applications/Firefox.app/Contents/MacOS/firefox",
  engine: "firefox",
};
const notQuarantined = () => false;

describe("pickTestBrowsers: which installed browsers seam 2 may launch", () => {
  it("Brave always, Dia never, and Firefox not without BB_TEST_FIREFOX=1", () => {
    expect(pickTestBrowsers([brave, dia, firefox], {}, notQuarantined)).toEqual({
      browsers: [brave],
      skipped: ["Firefox skipped: set BB_TEST_FIREFOX=1 to run seam 2 on it"],
    });
  });

  it("Firefox with BB_TEST_FIREFOX=1 when its bundle isn't quarantined", () => {
    const seen: string[] = [];
    const pick = pickTestBrowsers([brave, firefox], { BB_TEST_FIREFOX: "1" }, (app) => {
      seen.push(app);
      return false;
    });
    expect(pick).toEqual({ browsers: [brave, firefox], skipped: [] });
    expect(seen).toEqual(["/Applications/Firefox.app"]);
  });

  it("never a quarantined Firefox, even opted in, because its next launch could be Gatekeeper's first-launch path", () => {
    expect(pickTestBrowsers([firefox], { BB_TEST_FIREFOX: "1" }, () => true)).toEqual({
      browsers: [],
      skipped: [
        "Firefox skipped: /Applications/Firefox.app is quarantined (com.apple.quarantine), so a test launch could be its first and start Gatekeeper's own Firefox. Open it once by hand and clear the flag (xattr -d com.apple.quarantine /Applications/Firefox.app), then set BB_TEST_FIREFOX=1.",
      ],
    });
  });

  it("says nothing about Firefox when it isn't installed", () => {
    expect(pickTestBrowsers([brave], { BB_TEST_FIREFOX: "1" }, () => true)).toEqual({
      browsers: [brave],
      skipped: [],
    });
  });
});

describe("isQuarantined: the xattr read fails closed", () => {
  const APP = "/Applications/Firefox.app";
  const ran: [string, string[]][] = [];
  const answer =
    (r: { status: number | null; stderr?: string; error?: Error }) =>
    (cmd: string, args: string[]) => {
      ran.push([cmd, args]);
      return { stderr: "", ...r };
    };

  it("asks /usr/bin/xattr, not whatever xattr is on PATH", () => {
    ran.length = 0;
    isQuarantined(APP, answer({ status: 0 }));
    expect(ran).toEqual([["/usr/bin/xattr", ["-p", "com.apple.quarantine", APP]]]);
  });

  it('only "No such xattr" (exit 1) means not quarantined', () => {
    expect(
      isQuarantined(
        APP,
        answer({ status: 1, stderr: `xattr: ${APP}: No such xattr: com.apple.quarantine\n` }),
      ),
    ).toBe(false);
  });

  it.each([
    ["the flag is there (exit 0)", { status: 0 }],
    [
      "xattr couldn't be started",
      { status: null, error: new Error("spawnSync /usr/bin/xattr ENOENT") },
    ],
    ["xattr was killed (no status)", { status: null }],
    ["another exit status", { status: 2, stderr: "xattr: [Errno 13] Permission denied\n" }],
    [
      "exit 1 for another reason",
      { status: 1, stderr: `xattr: ${APP}: Operation not permitted\n` },
    ],
  ])("anything else counts as quarantined: %s", (_, r) => {
    expect(isQuarantined(APP, answer(r))).toBe(true);
  });
});
