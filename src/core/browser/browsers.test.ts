import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectBrowsers } from "./browsers";

/** A fake Applications folder holding the given app bundles' executables. */
function appRoot(...executables: string[]) {
  const root = mkdtempSync(join(tmpdir(), "bb-apps-"));
  for (const exe of executables) {
    mkdirSync(dirname(join(root, exe)), { recursive: true });
    writeFileSync(join(root, exe), "");
  }
  return root;
}

describe("detectBrowsers", () => {
  it("finds installed browsers by bundle path, in a stable order", () => {
    const root = appRoot(
      "Dia.app/Contents/MacOS/Dia",
      "Brave Browser.app/Contents/MacOS/Brave Browser",
    );
    expect(detectBrowsers([root])).toEqual([
      {
        id: "brave",
        name: "Brave",
        executable: join(root, "Brave Browser.app/Contents/MacOS/Brave Browser"),
        engine: "chromium",
      },
      {
        id: "dia",
        name: "Dia",
        executable: join(root, "Dia.app/Contents/MacOS/Dia"),
        engine: "chromium",
      },
    ]);
  });

  it("knows Chrome, Edge and Firefox bundles too", () => {
    const root = appRoot(
      "Google Chrome.app/Contents/MacOS/Google Chrome",
      "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "Firefox.app/Contents/MacOS/firefox",
    );
    expect(detectBrowsers([root]).map((b) => [b.id, b.name, b.engine])).toEqual([
      ["chrome", "Chrome", "chromium"],
      ["edge", "Edge", "chromium"],
      ["firefox", "Firefox", "firefox"],
    ]);
  });

  it("takes the first root that has a browser, and ignores app bundles without the executable", () => {
    const system = appRoot("Brave Browser.app/Contents/MacOS/Brave Browser");
    const user = appRoot(
      "Brave Browser.app/Contents/MacOS/Brave Browser",
      "Dia.app/Contents/Info.plist",
    );
    const found = detectBrowsers([join(system, "missing"), system, user]);
    expect(found.map((b) => b.executable)).toEqual([
      join(system, "Brave Browser.app/Contents/MacOS/Brave Browser"),
    ]);
  });
});
