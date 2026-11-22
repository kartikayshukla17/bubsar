import type { Action, Step } from "./board";
import { type GoogleConsole, ReauthRequired } from "./recipes/google/console";

/** busbar's automated browser on the Google profile, and the way to hand it to you. */
export interface Consoles {
  readonly browser: string;
  /** The console on the automated browser, attaching when none is open. */
  open(): Promise<GoogleConsole>;
  /**
   * Close the automated browser, open the plain window at `url`, print `instruction`, and
   * wait. True when the user carries on (Enter, or quitting that window); false when they
   * stop (Ctrl-C, or stdin closed).
   */
  handOver(url: string, instruction: string): Promise<boolean>;
}

export type Stopped = { result: "stopped"; reauth: ReauthRequired };

/** The page, without its query: Google's sign-in URLs carry opaque state nobody needs to read. */
const pageOf = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return "Google sign-in";
  }
};

/** What the board shows (`note`) and what the terminal adds (`prompt`). */
export function handoffText(browser: string, e: ReauthRequired) {
  const opened = `busbar opened ${browser} on its profile at ${pageOf(e.url)}.`;
  return e.afterSave
    ? {
        note: `Google confirmed the Save, then asked you to sign in again before busbar could read the client back. ${opened}`,
        prompt:
          "Finish there, then press Enter here and busbar reads the client back. Ctrl-C stops here; the Save stands.",
      }
    : {
        note: `Google wants you to sign in again. ${opened}`,
        prompt:
          "Finish there, then press Enter here and busbar reads the client again. Ctrl-C stops here; nothing changes in Google.",
      };
}

/**
 * Run `attempt` on the console. When Google sends the profile to sign-in, every step goes
 * to Your turn, the browser goes to you, and on your Enter `attempt` runs again from the
 * start on a fresh attach (`round` counts the handoffs so far). Other errors pass through.
 */
export async function withHandoff<T>(
  c: Consoles,
  steps: Step[],
  emit: (a: Action) => void,
  attempt: (gc: GoogleConsole, round: number) => Promise<T>,
): Promise<T | Stopped> {
  for (let round = 0; ; round++) {
    try {
      return await attempt(await c.open(), round);
    } catch (e) {
      if (!(e instanceof ReauthRequired)) throw e;
      const { note, prompt } = handoffText(c.browser, e);
      for (const s of steps) emit({ type: "handoff", id: s.id, note });
      if (!(await c.handOver(e.url, `${note}\n${prompt}`))) return { result: "stopped", reauth: e };
    }
  }
}
