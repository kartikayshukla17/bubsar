import { useEffect, useReducer } from "react";
import { flushSync } from "react-dom";
import { Bay } from "~/components/bay";
import { FlightBar } from "~/components/flight-bar";
import { Handoff } from "~/components/handoff";
import { Ledger } from "~/components/ledger";
import { MarkLegend, SectorMap } from "~/components/sector-map";
import { Strip } from "~/components/strip";
import {
  type Action,
  type BayId,
  type BoardState,
  type Moment,
  OLD_TUNNEL,
  boardAt,
  STEPS,
  type ValueId,
  initialBoard,
  reduce,
  short,
  stepTouches,
} from "~/lib/board";
import type { Route } from "./+types/board";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "busbar · enquiry-to-paid" },
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

function statusLine(s: BoardState): { text: string; live: boolean } {
  const cleared = STEPS.filter((st) => s.strips[st.id].bay === "cleared").length;
  const busy = STEPS.find((st) => ["active", "checking"].includes(s.strips[st.id].mark));
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
      return { text: busy ? `${busy.provider}: ${busy.activeNote}` : `${cleared} of 5 written`, live: true };
    case "handoff":
      return { text: "Paused on Meta. One strip needs you; Google is queued behind it.", live: false };
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

export default function Board() {
  const [board, dispatch] = useReducer(reduce, initialBoard, (init) => {
    const at = new URLSearchParams(window.location.search).get("at");
    const moments: Moment[] = ["drift", "planned", "handoff", "applied", "verified"];
    return at && (moments as string[]).includes(at) ? boardAt(at as Moment) : init;
  });
  const send = (a: Action) => travel(() => dispatch(a));
  const focus = (value: ValueId) => dispatch({ type: "focus", value });

  // Apply runner: one strip at a time, plan → active → cleared (or your turn).
  useEffect(() => {
    if (board.phase !== "applying") return;
    const step = STEPS[board.cursor];
    let t: number | undefined;
    if (!step) {
      t = window.setTimeout(() => dispatch({ type: "apply-done" }), 400);
    } else {
      const bay = board.strips[step.id].bay;
      if (bay === "plan") t = window.setTimeout(() => send({ type: "activate", id: step.id }), 450);
      else if (bay === "active") t = window.setTimeout(() => send({ type: "settle", id: step.id }), 1500);
    }
    return () => window.clearTimeout(t);
  }, [board]);

  // Verify runner: prove each cleared strip in order.
  useEffect(() => {
    if (board.phase !== "verifying") return;
    const checking = STEPS.find((st) => board.strips[st.id].mark === "checking");
    const next = STEPS.find((st) => board.strips[st.id].mark === "applied");
    let t: number | undefined;
    if (checking) t = window.setTimeout(() => dispatch({ type: "checked", id: checking.id }), 950);
    else if (next) t = window.setTimeout(() => dispatch({ type: "check", id: next.id }), 220);
    else t = window.setTimeout(() => dispatch({ type: "verify-done" }), 300);
    return () => window.clearTimeout(t);
  }, [board]);

  const inBay = (bay: BayId) => STEPS.filter((st) => board.strips[st.id].bay === bay);
  const status = statusLine(board);

  const renderStrips = (bay: BayId) =>
    inBay(bay).map((st) => (
      <Strip
        key={st.id}
        step={st}
        state={board.strips[st.id]}
        dimmed={!stepTouches(st, board.focus)}
        cocked={bay === "turn"}
      />
    ));

  return (
    <div className="mx-auto max-w-[1480px] px-4 pb-20 sm:px-6">
      <FlightBar
        phase={board.phase}
        onPlan={() => send({ type: "plan" })}
        onApply={() => dispatch({ type: "start" })}
        onVerify={() => dispatch({ type: "verify-start" })}
        onDiscard={() => send({ type: "discard" })}
      />

      <p className="flex min-h-[44px] items-center gap-3 py-3 text-[13px]" aria-live="polite">
        <span
          className={`h-2 w-2 flex-none rounded-[2px] ${board.phase === "drift" ? "bg-paper" : "bg-signal"} ${status.live ? "bb-mark--active" : ""}`}
          aria-hidden="true"
        />
        <span key={status.text} className={`t-swap ${status.live ? "t-shimmer" : "text-mute"}`}>
          {status.text}
        </span>
        {board.phase === "verified" ? (
          <button type="button" className="ml-auto text-mute underline hover:text-paper" onClick={() => send({ type: "reset" })}>
            Replay demo
          </button>
        ) : null}
      </p>

      <div className="grid gap-4 lg:grid-cols-[minmax(400px,5fr)_7fr]">
        <section aria-labelledby="sector-h" className="lg:sticky lg:top-[76px] lg:self-start">
          <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
            <h2 id="sector-h" className="font-display text-[15px] font-semibold tracking-[-0.01em]">
              Wiring
              <span className="ml-2.5 font-sans text-[13px] font-normal text-mute">{board.focus}</span>
            </h2>
            <span className="text-[12.5px] text-mute">Pick a value to trace it</span>
          </div>
          <SectorMap board={board} onFocus={focus} />
          <div className="mt-3 px-1">
            <MarkLegend />
          </div>
        </section>

        <section aria-label="Strip bays" className="grid content-start gap-3">
          <Bay
            name="Plan"
            count={inBay("plan").length}
            empty={board.phase === "drift" ? "Press Plan to see every write before anything changes." : "Nothing queued."}
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
                <Strip step={st} state={board.strips[st.id]} cocked dimmed={!stepTouches(st, board.focus)} />
                <Handoff
                  onDone={() => send({ type: "handoff-done", id: st.id })}
                  onSkip={() => send({ type: "handoff-done", id: st.id })}
                />
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
          <p className="text-[13px] text-mute">Secrets appear as fingerprints. busbar never displays them, here or to the model.</p>
        </div>
        <Ledger board={board} onFocus={focus} />
      </section>
    </div>
  );
}
