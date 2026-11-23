import { describe, expect, it } from "vitest";
import type { InstalledBrowser } from "../../src/core/browser/browsers";
import { pickTestBrowsers } from "./browser";

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
