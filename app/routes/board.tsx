import { useEffect, useReducer, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Bay } from "~/components/bay";
import { FlightBar, type SessionChip } from "~/components/flight-bar";
import { Handoff } from "~/components/handoff";
import { Ledger } from "~/components/ledger";
import { MarkLegend, SectorMap } from "~/components/sector-map";
import { Strip } from "~/components/strip";
import {
  type Action,
  type BayId,
  type BoardState,
  initialBoard,
  layout,
  reduce,
  type Scene,
  stepTouches,
  type ValueId,
} from "~/lib/board";
import { boardAt, DEMO_SCENE, demoBoard, type Moment, OLD_TUNNEL, short } from "~/lib/demo";
import type { Run, RunEvent } from "../../src/core/run";
import type { Local } from "../../src/core/session";
import type { Route } from "./+types/board";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "busbar" },
    { name: "description", content: "Wire cloud providers together, and prove it worked." },
  ];
}

/** Strips change bays through the View Transitions API, so they travel instead of blinking. */
function travel(fn: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!doc.startViewTransition || reduce) return fn();
  doc.startViewTransition(() => flushSync(fn));
}

type Status = { text: string; live: boolean };

function demoStatus(s: BoardState): Status {
  const cleared = s.steps.filter((st) => s.strips[st.id].bay === "cleared").length;
  const busy = s.steps.find((st) => ["active", "checking"].includes(s.strips[st.id].mark));
  switch (s.phase) {
    case "drift":
      return {
        text: `tunnel.url rotated 4 min ago. 5 registrations still point at ${short(OLD_TUNNEL)}`,
        live: false,
      };
    case "planned":
      return {
        text: "Plan ready: 5 writes. 3 in your sandbox browser, 1 API call, 1 local file. Nothing has changed yet.",
        live: false,
      };
    case "applying":
      return {
        text: busy ? `${busy.provider}: ${busy.activeNote}` : `${cleared} of 5 written`,
        live: true,
      };
    case "handoff":
      return {
        text: "Paused on Meta. One strip needs you; Google is queued behind it.",
        live: false,
      };
    case "applied":
      return { text: "All 5 written. Nothing turns green until bb verify proves it.", live: false };
    case "verifying":
      return { text: busy ? `Verifying ${busy.provider}` : "Verifying", live: true };
    case "verified":
      return {
        text: "4 verified, 1 listed but not exercised. Run bb verify --signin to prove Google sign-in.",
        live: false,
      };
  }
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

function liveStatus(s: BoardState): Status {
  const n = s.steps.length;
  const busy = s.steps.find((st) => ["active", "checking"].includes(s.strips[st.id].mark));
  switch (s.phase) {
    case "drift":
      return { text: "No plan yet in this project.", live: false };
    case "planned": {
      const unread = s.steps.filter((st) => st.from === null).length;
      return {
        text: `Plan ready: ${plural(n, "write")}. Nothing has changed yet.${unread ? ` ${unread} current ${unread === 1 ? "entry is" : "entries are"} unknown: busbar hasn't read the console.` : ""}`,
        live: false,
      };
    }
    case "applying":
    case "verifying":
      return { text: busy ? `${busy.provider}: ${busy.activeNote}` : "Working", live: true };
    case "handoff":
      return { text: "Paused. One strip needs you.", live: false };
    case "applied":
      return {
        text: `${plural(n, "write")} made. Nothing turns green until bb verify proves it.`,
        live: false,
      };
    case "verified":
      return { text: "Verify finished.", live: false };
  }
}

function BoardView({
  scene,
  board,
  status,
  send,
  controls,
  emptyPlan,
  footer,
  session,
}: {
  scene: Scene;
  board: BoardState;
  session?: SessionChip | null;
  status: Status;
  send: (a: Action) => void;
  controls: {
    onPlan: () => void;
    onApply: () => void;
    onVerify: () => void;
    onDiscard: () => void;
  };
  emptyPlan: string;
  footer?: React.ReactNode;
}) {
  const focus = (value: ValueId) => send({ type: "focus", value });
  const inBay = (bay: BayId) => board.steps.filter((st) => board.strips[st.id]?.bay === bay);
  const total = board.steps.length;
  const position = (id: string) => board.steps.findIndex((s) => s.id === id) + 1;

  const renderStrips = (bay: BayId) =>
    inBay(bay).map((st) => (
      <Strip
        key={st.id}
        step={st}
        index={position(st.id)}
        total={total}
        state={board.strips[st.id]}
        dimmed={!stepTouches(st, board.focus)}
        cocked={bay === "turn"}
      />
    ));

  return (
    <div className="mx-auto max-w-[1480px] px-4 pb-20 sm:px-6">
      <FlightBar scene={scene} phase={board.phase} session={session} {...controls} />

      <p className="flex min-h-[44px] items-center gap-3 py-3 text-[13px]" aria-live="polite">
        <span
          className={`h-2 w-2 flex-none rounded-[2px] ${board.phase === "drift" ? "bg-paper" : "bg-signal"} ${status.live ? "bb-mark--active" : ""}`}
          aria-hidden="true"
        />
        <span key={status.text} className={`t-swap ${status.live ? "t-shimmer" : "text-mute"}`}>
          {status.text}
        </span>
        {footer}
      </p>

      <div className="grid gap-4 lg:grid-cols-[minmax(400px,5fr)_7fr]">
        <section aria-labelledby="sector-h" className="lg:sticky lg:top-[76px] lg:self-start">
          <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
            <h2 id="sector-h" className="font-display text-[15px] font-semibold tracking-[-0.01em]">
              Wiring
              <span className="ml-2.5 font-sans text-[13px] font-normal text-mute">
                {board.focus}
              </span>
            </h2>
            <span className="text-[12.5px] text-mute">Pick a value to trace it</span>
          </div>
          <SectorMap scene={scene} board={board} onFocus={focus} />
          <div className="mt-3 px-1">
            <MarkLegend />
          </div>
        </section>

        <section aria-label="Strip bays" className="grid content-start gap-3">
          <Bay
            name="Plan"
            count={inBay("plan").length}
            empty={board.phase === "drift" ? emptyPlan : "Nothing queued."}
          >
            {renderStrips("plan")}
          </Bay>
          <Bay name="Active" count={inBay("active").length} empty="Idle.">
            {renderStrips("active")}
          </Bay>
          <Bay
            name="Your turn"
            hint={inBay("turn").length ? "busbar stopped instead of guessing" : undefined}
            count={inBay("turn").length}
            empty="Nothing needs you."
          >
            {inBay("turn").map((st) => (
              <div key={st.id}>
                <Strip
                  step={st}
                  index={position(st.id)}
                  total={total}
                  state={board.strips[st.id]}
                  cocked
                  dimmed={!stepTouches(st, board.focus)}
                />
                {scene.live ? null : (
                  <Handoff
                    onDone={() => send({ type: "handoff-done", id: st.id })}
                    onSkip={() => send({ type: "handoff-done", id: st.id })}
                  />
                )}
              </div>
            ))}
          </Bay>
          <Bay name="Cleared" count={inBay("cleared").length} empty="No writes yet.">
            {renderStrips("cleared")}
          </Bay>
        </section>
      </div>

      <section aria-labelledby="ledger-h" className="mt-12">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="ledger-h" className="font-display text-[22px] font-semibold tracking-[-0.02em]">
            Values
          </h2>
          <p className="text-[13px] text-mute">
            Secrets appear as fingerprints. busbar never displays them, here or to the model.
          </p>
        </div>
        <Ledger scene={scene} board={board} onFocus={focus} />
      </section>
    </div>
  );
}

/** `?demo` and `?at=<moment>`: the synthetic kit run, for screenshots and the video. */
function DemoBoard() {
  const [board, dispatch] = useReducer(reduce, demoBoard, (init) => {
    const at = new URLSearchParams(window.location.search).get("at");
    const moments: Moment[] = ["drift", "planned", "handoff", "applied", "verified"];
    return at && (moments as string[]).includes(at) ? boardAt(at as Moment) : init;
  });
  const send = (a: Action) => travel(() => dispatch(a));
  const steps = board.steps;

  // Apply runner: one strip at a time, plan → active → cleared (or your turn).
  // biome-ignore lint/correctness/useExhaustiveDependencies: each board change schedules the next tick
  useEffect(() => {
    if (board.phase !== "applying") return;
    const step = steps[board.cursor];
    let t: number | undefined;
    if (!step) {
      t = window.setTimeout(() => dispatch({ type: "apply-done" }), 400);
    } else {
      const bay = board.strips[step.id].bay;
      if (bay === "plan") t = window.setTimeout(() => send({ type: "activate", id: step.id }), 450);
      else if (bay === "active")
        t = window.setTimeout(() => send({ type: "settle", id: step.id }), 1500);
    }
    return () => window.clearTimeout(t);
  }, [board]);

  // Verify runner: prove each cleared strip in order.
  // biome-ignore lint/correctness/useExhaustiveDependencies: each board change schedules the next tick
  useEffect(() => {
    if (board.phase !== "verifying") return;
    const checking = steps.find((st) => board.strips[st.id].mark === "checking");
    const next = steps.find((st) => board.strips[st.id].mark === "applied");
    let t: number | undefined;
    if (checking) t = window.setTimeout(() => dispatch({ type: "checked", id: checking.id }), 950);
    else if (next) t = window.setTimeout(() => dispatch({ type: "check", id: next.id }), 220);
    else t = window.setTimeout(() => dispatch({ type: "verify-done" }), 300);
    return () => window.clearTimeout(t);
  }, [board]);

  return (
    <BoardView
      scene={DEMO_SCENE}
      board={board}
      status={demoStatus(board)}
      send={send}
      emptyPlan="Press Plan to see every write before anything changes."
      controls={{
        onPlan: () => send({ type: "plan" }),
        onApply: () => dispatch({ type: "start" }),
        onVerify: () => dispatch({ type: "verify-start" }),
        onDiscard: () => send({ type: "discard" }),
      }}
      footer={
        board.phase === "verified" ? (
          <button
            type="button"
            className="ml-auto text-mute underline hover:text-paper"
            onClick={() => send({ type: "reset" })}
          >
            Replay demo
          </button>
        ) : null
      }
    />
  );
}

const PLAN_COMMAND = "bb plan --tunnel <url>";
const NO_CONTROLS = {
  onPlan: () => {},
  onApply: () => {},
  onVerify: () => {},
  onDiscard: () => {},
};

function sceneOf(run: Run | null): Scene {
  if (!run)
    return { project: "busbar", destinations: [], values: [], command: PLAN_COMMAND, live: true };
  const tunnel = run.values.find((v) => v.id === "tunnel.url")?.literal;
  return {
    project: run.project,
    ...layout(run.destinations, run.values),
    command: tunnel ? `bb plan --tunnel ${tunnel}` : PLAN_COMMAND,
    live: true,
  };
}

/** What `/api/session` serves: local.json's sessions plus each browser's display name. */
type Sessions = { google?: NonNullable<Local["google"]> & { browserName: string } };

/** The chip for Google: shown once the project wires Google or has logged in. */
function sessionChip(sessions: Sessions, wiresGoogle: boolean): SessionChip | null {
  const g = sessions.google;
  if (!g) {
    return wiresGoogle
      ? {
          text: "Google · not logged in",
          title: "Run bb login google in your terminal.",
          ok: false,
        }
      : null;
  }
  const signedIn = g.session === "signed-in";
  const at = new Date(g.checkedAt).toLocaleString();
  return {
    text: `Google · ${g.browserName} · ${signedIn ? "signed in" : "signed out"}`,
    title: signedIn
      ? `busbar's ${g.browserName} profile loaded the Cloud console at ${at}. Run bb status to re-check.`
      : `Google sent busbar's ${g.browserName} profile to sign-in at ${at}. Run bb login google.`,
    ok: signedIn,
  };
}

/**
 * The default view under `bb ui`: mirrors .busbar/ through the daemon. Loads the snapshot,
 * then reduces each streamed event. A gap, a new run, or a reconnect reloads the snapshot,
 * so the board never drifts from the run state on disk.
 */
function LiveBoard() {
  const [run, setRun] = useState<Run | null | undefined>(undefined);
  const [offline, setOffline] = useState(false);
  const [sessions, setSessions] = useState<Sessions>({});
  const current = useRef<Run | null>(null);

  useEffect(() => {
    let stopped = false;
    const show = (next: Run | null) => {
      current.current = next;
      travel(() => setRun(next));
    };
    const load = async () => {
      try {
        const res = await fetch("/api/run", { cache: "no-store" });
        if (stopped) return;
        if (res.status === 404) return show(null);
        if (res.ok) show((await res.json()) as Run);
      } catch {
        setOffline(true);
      }
    };
    const loadSessions = async () => {
      try {
        const res = await fetch("/api/session", { cache: "no-store" });
        if (!stopped && res.ok) setSessions((await res.json()) as Sessions);
      } catch {}
    };
    load();
    loadSessions();
    const events = new EventSource("/api/events");
    events.onopen = () => {
      setOffline(false);
      load(); // resync after a reconnect
      loadSessions();
    };
    // bb login / status / logout in another terminal.
    events.addEventListener("session", (m) => setSessions(JSON.parse(m.data) as Sessions));
    events.onerror = () => setOffline(true);
    events.onmessage = (m) => {
      const e = JSON.parse(m.data) as RunEvent;
      const cur = current.current;
      if (cur && e.run === cur.run && e.seq === cur.seq + 1) {
        show({ ...cur, seq: e.seq, board: reduce(cur.board, e.action) });
      } else {
        load();
      }
    };
    return () => {
      stopped = true;
      events.close();
    };
  }, []);

  const board = run?.board ?? initialBoard();
  const status: Status =
    run === undefined
      ? { text: "Reading .busbar/ …", live: true }
      : offline
        ? { text: "Lost bb ui. Is it still running in your terminal?", live: false }
        : liveStatus(board);

  return (
    <BoardView
      scene={sceneOf(run ?? null)}
      board={board}
      status={status}
      // Focus is the only thing a viewer changes, and it stays in this tab.
      send={(a) => {
        if (a.type === "focus" && current.current) {
          const next = { ...current.current, board: reduce(current.current.board, a) };
          current.current = next;
          setRun(next);
        }
      }}
      emptyPlan={`Run ${PLAN_COMMAND} to see every write before anything changes.`}
      controls={NO_CONTROLS}
      session={sessionChip(sessions, run?.destinations.some((d) => d.id === "google") ?? false)}
    />
  );
}

export default function Board() {
  const params = new URLSearchParams(window.location.search);
  return params.has("demo") || params.has("at") ? <DemoBoard /> : <LiveBoard />;
}
