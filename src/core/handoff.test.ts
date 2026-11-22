import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type ApplyIO, applyPlan } from "./apply";
import type { Action, Step } from "./board";
import { FakeDriver, type FakeWorld, readWorld } from "./browser/fake";
import type { Consoles } from "./handoff";
import type { GoogleConsole, Lists } from "./recipes/google/console";
import { FakeGoogleConsole } from "./recipes/google/fake";
import type { Planned } from "./state";

const CB = "/api/auth/callback/google";
const LOCAL = "http://localhost:3000";
const OLD = "https://old.ngrok-free.app";
const NEW = "https://new.ngrok-free.app";
const CLIENT_URL =
  "https://console.cloud.google.com/auth/clients/1234-abc.apps.googleusercontent.com?project=my-sandbox-123";
const CHALLENGE = "https://accounts.google.com/v3/signin/challenge/pwd";
const PROFILE = "/bb-home/profiles/enquiry-to-paid/brave";

const read: Lists = { redirectUris: [`${LOCAL}${CB}`, `${OLD}${CB}`], jsOrigins: [OLD] };
const next: Lists = { redirectUris: [`${LOCAL}${CB}`, `${NEW}${CB}`], jsOrigins: [NEW] };
const planned: Planned = {
  values: { "tunnel.url": NEW },
  desired: { redirectUris: [`${NEW}${CB}`], jsOrigins: [NEW] },
  read,
  next,
};

const step = (id: string, from: string, to: string): Step => ({
  id,
  destination: "google",
  provider: "Google",
  field: "Authorized redirect URI",
  tier: "web",
  from,
  to,
  activeNote: "Editing the OAuth web client",
  verify: { mark: "verified", note: "Authorize accepted the redirect_uri" },
});
const steps = [
  step("google-redirect-1", `${OLD}${CB}`, `${NEW}${CB}`),
  step("google-origin-1", OLD, NEW),
];

function world(google: Partial<FakeWorld["google"]> = {}) {
  const file = join(mkdtempSync(join(tmpdir(), "bb-world-")), "world.json");
  const w: FakeWorld = {
    browsers: ["brave"],
    google: { session: "signed-in", client: structuredClone(read), ...google },
  };
  writeFileSync(file, JSON.stringify(w));
  return file;
}

/** The fake world's browser, with the user answering each handoff from `answers`. */
function consoles(file: string, answers: ("enter" | "eof")[]) {
  const driver = new FakeDriver(file, { untilEnter: async () => answers.shift() ?? "eof" });
  const [browser] = driver.detect();
  let gc: GoogleConsole | null = null;
  const said: string[] = [];
  const c: Consoles = {
    browser: browser.name,
    async open() {
      gc ??= new FakeGoogleConsole(
        file,
        await driver.attach(browser, PROFILE, { headless: true }),
        CLIENT_URL,
      );
      return gc;
    },
    async handOver(url, text) {
      await gc?.close();
      gc = null;
      said.push(text);
      const end = await driver.openPlain(browser, PROFILE, url);
      return end === "enter";
    },
  };
  return { c, said };
}

function recorder() {
  const events: string[] = [];
  const notes: string[] = [];
  const saved: [Lists, boolean][] = [];
  let confirms = 0;
  const io: ApplyIO = {
    show: () => {},
    confirm: async () => {
      confirms++;
      return true;
    },
    saved: (s, asPlanned) => saved.push([s, asPlanned]),
    emit: (a: Action) => {
      events.push("id" in a ? `${a.type} ${a.id}` : a.type);
      if (a.type === "handoff" && a.note) notes.push(a.note);
    },
  };
  return { io, events, notes, saved, confirms: () => confirms };
}

const saves = (file: string) => (readWorld(file).consoleCalls ?? []).filter((c) => c.op === "save");

describe("applyPlan hands a sign-in to you, then resumes from the read (BB-06)", () => {
  it("a sign-in demand between the edits and Save: one handoff, then exactly one Save", async () => {
    const file = world({ fail: { reauth: "save" } });
    const { c, said } = consoles(file, ["enter"]);
    const r = recorder();

    const out = await applyPlan(c, planned, steps, r.io);

    expect(out).toEqual({ result: "applied", saved: next });
    expect(saves(file)).toEqual([{ op: "save", url: CLIENT_URL, lists: next }]);
    expect(readWorld(file).google.client).toEqual(next);
    expect(readWorld(file).openPlainCalls).toEqual([
      { browser: "brave", profileDir: PROFILE, url: CHALLENGE },
    ]);
    expect(r.confirms()).toBe(1);
    expect(r.saved).toEqual([[next, true]]);
    expect(r.events).toEqual([
      "start",
      "activate google-redirect-1",
      "activate google-origin-1",
      "handoff google-redirect-1",
      "handoff google-origin-1",
      "plan",
      "start",
      "activate google-redirect-1",
      "activate google-origin-1",
      "settle google-redirect-1",
      "settle google-origin-1",
      "apply-done",
    ]);
    const note =
      "Google wants you to sign in again. busbar opened Brave on its profile at accounts.google.com/v3/signin/challenge/pwd.";
    expect(r.notes).toEqual([note, note]);
    expect(said).toEqual([
      `${note}\nFinish there, then press Enter here and busbar reads the client again. Ctrl-C stops here; nothing changes in Google.`,
    ]);
  });

  it("bounces again only when scripted twice: two handoffs, still exactly one Save", async () => {
    const file = world({ fail: { reauth: ["save", "save"] } });
    const { c } = consoles(file, ["enter", "enter"]);
    const r = recorder();

    expect(await applyPlan(c, planned, steps, r.io)).toEqual({ result: "applied", saved: next });
    expect(saves(file)).toHaveLength(1);
    expect(readWorld(file).openPlainCalls).toHaveLength(2);
    expect(r.events.filter((e) => e === "handoff google-redirect-1")).toHaveLength(2);
    expect(r.confirms()).toBe(1);
  });

  it("stopping at the handoff (stdin closed) leaves the strips in Your turn and saves nothing", async () => {
    const file = world({ fail: { reauth: "save" } });
    const { c } = consoles(file, []);
    const r = recorder();

    const out = await applyPlan(c, planned, steps, r.io);

    expect(out.result).toBe("stopped");
    expect(saves(file)).toEqual([]);
    expect(readWorld(file).google.client).toEqual(read);
    expect(r.saved).toEqual([]);
    expect(r.events.slice(-2)).toEqual(["handoff google-redirect-1", "handoff google-origin-1"]);
  });

  describe("a sign-in bounce at the read-back, after Google confirmed the Save", () => {
    const known = {
      redirectUris: [`${LOCAL}${CB}`, `${OLD}${CB}`, `${NEW}${CB}`],
      jsOrigins: [OLD, NEW],
    };
    const note =
      "Google confirmed the Save, then asked you to sign in again before busbar could read the client back. busbar opened Brave on its profile at accounts.google.com/v3/signin/challenge/pwd.";

    it("records what's known before handing over, then reads back on resume: one Save, applied", async () => {
      const file = world({ fail: { reauth: "readback" } });
      const { c } = consoles(file, ["enter"]);
      const r = recorder();

      expect(await applyPlan(c, planned, steps, r.io)).toEqual({ result: "applied", saved: next });
      expect(saves(file)).toHaveLength(1);
      expect(r.saved).toEqual([
        [known, false],
        [next, true],
      ]);
      expect(r.notes).toEqual([note, note]);
      expect(r.events).toEqual([
        "start",
        "activate google-redirect-1",
        "activate google-origin-1",
        "handoff google-redirect-1",
        "handoff google-origin-1",
        "settle google-redirect-1",
        "settle google-origin-1",
        "apply-done",
      ]);
    });

    it("a second bounce at the resumed read still says the Save went through, and the stop says so", async () => {
      const file = world({ fail: { reauth: ["readback", "read"] } });
      const { c, said } = consoles(file, ["enter"]);
      const r = recorder();

      const out = await applyPlan(c, planned, steps, r.io);

      expect(out).toMatchObject({ result: "stopped", reauth: { afterSave: true } });
      expect(saves(file)).toHaveLength(1);
      expect(r.notes).toEqual([note, note, note, note]);
      expect(said).toHaveLength(2);
      for (const text of said) expect(text).toContain("Ctrl-C stops here; the Save stands.");
      expect(r.saved).toEqual([[known, false]]);
    });

    it("stopping there keeps what's known on record and never re-sends the Save", async () => {
      const file = world({ fail: { reauth: "readback" } });
      const { c } = consoles(file, []);
      const r = recorder();

      const out = await applyPlan(c, planned, steps, r.io);

      expect(out).toMatchObject({ result: "stopped", reauth: { afterSave: true } });
      expect(saves(file)).toHaveLength(1);
      expect(r.saved).toEqual([[known, false]]);
    });
  });

  it("a read that already shows the planned lists: an earlier Save landed, so it records ownership and writes nothing", async () => {
    const file = world({ client: structuredClone(next) });
    const { c } = consoles(file, []);
    const r = recorder();

    expect(await applyPlan(c, planned, steps, r.io)).toEqual({ result: "landed", saved: next });
    expect(saves(file)).toEqual([]);
    expect(r.confirms()).toBe(0);
    expect(r.saved).toEqual([[next, true]]);
    expect(r.events).toEqual([
      "start",
      "settle google-redirect-1",
      "settle google-origin-1",
      "apply-done",
    ]);
  });
});
