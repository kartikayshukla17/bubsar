import { FileIcon, PlayCircleIcon, ShieldCheckIcon } from "@pikaicons/core-free";
import type { ReactNode } from "react";
import { Bay } from "~/components/bay";
import { BusbarMark, PikaIcon } from "~/components/icons";
import { MARK_LABEL, Mark } from "~/components/mark";
import { MarkLegend, SectorMap } from "~/components/sector-map";
import { Strip } from "~/components/strip";
import { ShaderBackground } from "~/components/ui/fluted-glass";
import { type Mark as MarkKind, reduce, type Step, type StripState } from "~/lib/board";
import { DEMO_SCENE, demoBoard, NEW_TUNNEL, OLD_TUNNEL, STEPS } from "~/lib/demo";
import type { Route } from "./+types/kit";

export function meta(_: Route.MetaArgs) {
  return [{ title: "busbar · component kit" }];
}

const ALL_MARKS: MarkKind[] = [
  "drift",
  "planned",
  "active",
  "handoff",
  "applied",
  "failed",
  "checking",
  "verified",
  "unexercised",
  "unknown",
];

function Row({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="grid gap-5 border-t border-rule py-10 lg:grid-cols-[260px_1fr]">
      <div>
        <h2 className="font-display text-[19px] font-semibold tracking-[-0.015em]">{title}</h2>
        <p className="mt-1.5 max-w-[34ch] text-[13px] text-mute">{note}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** What `bb plan` emits once it has read the Google console: replace, add, remove. */
const google = (id: string, from: string, to: string, note?: string): Step => ({
  id,
  destination: "google",
  provider: "Google",
  field: "Authorized redirect URI",
  tier: "web",
  from,
  to,
  note,
  activeNote: "Editing your OAuth web client in your sandbox browser",
  verify: { mark: "verified", note: "Google accepted the redirect_uri" },
});
const CB = "/api/auth/callback/google";
const READ_STEPS = [
  google("google-redirect-1", `${OLD_TUNNEL}${CB}`, `${NEW_TUNNEL}${CB}`),
  google("google-redirect-2", "", `${NEW_TUNNEL}/auth/callback`),
  google(
    "google-redirect-remove-1",
    `${OLD_TUNNEL}/auth/callback`,
    "",
    "Likely stale, kept: https://x.ngrok-free.app/api/auth/callback/google",
  ),
];
const planned: StripState = { bay: "plan", mark: "planned", fresh: false };

const st = (mark: MarkKind, note?: string): StripState => ({
  bay: "cleared",
  mark,
  fresh: false,
  note,
});

const SAVE_REJECTED =
  "Google didn't save the client: Invalid Redirect: must end with a public top-level domain (such as .com or .org).";
const failedBoard = [
  { type: "plan" } as const,
  { type: "start" } as const,
  { type: "activate", id: "google" } as const,
  { type: "fail", id: "google", note: SAVE_REJECTED } as const,
].reduce(reduce, demoBoard);

export default function Kit() {
  return (
    <main className="mx-auto max-w-[1280px] px-4 pb-24 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-6 pb-10 pt-12">
        <div>
          <div className="flex items-center gap-3">
            <BusbarMark size={30} />
            <h1 className="font-display text-[44px] font-semibold leading-none tracking-[-0.035em]">
              busbar kit
            </h1>
          </div>
          <p className="mt-4 max-w-[60ch] text-mute">
            The strip-board components behind <span className="text-paper">bb ui</span>, the landing
            page and the demo video. Ink 70, paper 20, signal 10. State is always a mark, never only
            a colour.
          </p>
        </div>
        <a href="/" className="bb-btn">
          Open the board
        </a>
      </header>

      <Row
        title="Palette"
        note="User-pinned. Signal never sets text on paper: it fails contrast there."
      >
        <div className="grid grid-cols-[7fr_2fr_1fr] overflow-hidden rounded-[7px] border border-rule">
          <div className="h-28 bg-ink p-3 text-[12.5px]">
            <span className="font-semibold">Ink</span>
            <span className="block font-mono text-mute">#0B0B0C · 70%</span>
          </div>
          <div className="h-28 bg-paper p-3 text-[12.5px] text-ink">
            <span className="font-semibold">Paper</span>
            <span className="block font-mono text-graphite">#FFFFFF · 20%</span>
          </div>
          <div className="h-28 bg-signal p-3 text-[12.5px] text-ink">
            <span className="font-semibold">Signal</span>
            <span className="block font-mono">#C6F432</span>
          </div>
        </div>
      </Row>

      <Row
        title="Type"
        note="Bricolage Grotesque for names and counts. Figtree for everything you read."
      >
        <div className="grid gap-4">
          <p className="font-display text-[56px] font-semibold leading-[0.95] tracking-[-0.04em]">
            One value. Five consoles.
          </p>
          <p className="max-w-[62ch] text-[15px] leading-relaxed text-mute">
            Figtree carries the working text: strip fields, notes, the ledger. On a strip every line
            is 13px, and rank comes from weight, case and reversal instead of size.
          </p>
        </div>
      </Row>

      <Row
        title="Marks"
        note="Stamp, strike, open box, ring. Readable in greyscale and on both surfaces."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <ul className="grid gap-3 rounded-[7px] border border-rule bg-ink-2 p-4">
            {ALL_MARKS.map((k) => (
              <li key={k} className="flex items-center gap-3 text-[13px]">
                <Mark kind={k} size={18} />
                {MARK_LABEL[k]}
              </li>
            ))}
          </ul>
          <ul className="grid gap-3 rounded-[7px] bg-paper p-4 text-ink">
            {ALL_MARKS.map((k) => (
              <li key={k} className="flex items-center gap-3 text-[13px] font-semibold">
                <Mark kind={k} tone="paper" size={18} />
                {MARK_LABEL[k]}
              </li>
            ))}
          </ul>
        </div>
      </Row>

      <Row
        title="Strips"
        note="One write each. The ink holder is the executor tier: CLI, API or your sandbox browser (WEB)."
      >
        <div className="bb-kit-rack grid gap-[6px]">
          <Strip
            step={STEPS[0]}
            index={1}
            total={STEPS.length}
            state={{ bay: "plan", mark: "drift", fresh: false }}
          />
          <Strip
            step={STEPS[1]}
            index={2}
            total={STEPS.length}
            state={{ bay: "plan", mark: "planned", fresh: false }}
          />
          <Strip
            step={STEPS[2]}
            index={3}
            total={STEPS.length}
            state={st("active", STEPS[2].activeNote)}
          />
          <Strip step={STEPS[0]} index={1} total={STEPS.length} state={st("applied")} />
          <Strip
            step={STEPS[1]}
            index={2}
            total={STEPS.length}
            state={st("verified", STEPS[1].verify.note)}
          />
          <Strip
            step={STEPS[4]}
            index={5}
            total={STEPS.length}
            state={st("unexercised", STEPS[4].verify.note)}
          />
          <div className="pl-[14px] pt-2">
            <Strip
              step={STEPS[3]}
              index={4}
              total={STEPS.length}
              state={{ bay: "turn", mark: "handoff", fresh: false }}
              cocked
            />
          </div>
          <Strip step={STEPS[2]} index={3} total={STEPS.length} state={st("applied")} dimmed />
        </div>
      </Row>

      <Row
        title="Planned from the console"
        note="After bb plan reads Google: a replace shows what it was, an add is a new entry, a remove strikes the old one. Entries busbar leaves alone ride along as a note."
      >
        <div className="bb-kit-rack grid gap-[6px]">
          {READ_STEPS.map((step, i) => (
            <Strip
              key={step.id}
              step={step}
              index={i + 1}
              total={READ_STEPS.length}
              state={planned}
            />
          ))}
        </div>
      </Row>

      <Row
        title="Failed"
        note="bb apply stopped: the strip stays where it stopped and says why, in the provider's own words when it gave any. Never green, never Applied."
      >
        <div className="grid gap-4">
          <div className="bb-kit-rack grid gap-[6px]">
            <Strip
              step={READ_STEPS[0]}
              index={1}
              total={READ_STEPS.length}
              state={{ bay: "active", mark: "failed", fresh: false, note: SAVE_REJECTED }}
            />
            <Strip
              step={READ_STEPS[1]}
              index={2}
              total={READ_STEPS.length}
              state={{
                bay: "active",
                mark: "failed",
                fresh: false,
                note: "Saved, but Google shows a different list: Authorized redirect URIs are http://localhost:3000/api/auth/callback/google (planned: http://localhost:3000/api/auth/callback/google, https://7f3a-49-36-112-4.ngrok-free.app/auth/callback).",
              }}
            />
          </div>
          <div className="max-w-[640px]">
            <SectorMap
              scene={DEMO_SCENE}
              board={{ ...failedBoard, focus: "tunnel.url" }}
              onFocus={() => {}}
              glass={false}
            />
          </div>
        </div>
      </Row>

      <Row
        title="Bays"
        note="Racks with rails at the slot pitch. Strips fill whole slots; the count is right-aligned."
      >
        <div className="grid gap-3 md:grid-cols-2">
          <Bay
            name="Plan"
            count={0}
            empty="Press Plan to see every write before anything changes."
          />
          <Bay name="Cleared" count={2} empty="No writes yet.">
            <Strip step={STEPS[0]} index={1} total={STEPS.length} state={st("verified")} />
            <Strip step={STEPS[2]} index={3} total={STEPS.length} state={st("applied")} />
          </Bay>
        </div>
      </Row>

      <Row title="Actions" note="Signal marks the one next move. Everything else stays ink.">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="bb-btn bb-btn--primary">
            <PikaIcon icon={FileIcon} size={15} strokeWidth={1.8} />
            Plan
          </button>
          <button type="button" className="bb-btn">
            <PikaIcon icon={PlayCircleIcon} size={15} strokeWidth={1.8} />
            Apply
          </button>
          <button type="button" className="bb-btn" disabled>
            <PikaIcon icon={ShieldCheckIcon} size={15} strokeWidth={1.8} />
            Verify
          </button>
          <button type="button" className="bb-btn bb-btn--ghost">
            Discard plan
          </button>
          <span className="inline-flex gap-2 rounded-[6px] bg-paper p-2">
            <button type="button" className="bb-btn bb-btn--ink">
              On paper
            </button>
            <button type="button" className="bb-btn bb-btn--paper">
              Secondary
            </button>
          </span>
        </div>
      </Row>

      <Row
        title="Sector"
        note="Values left, registrations right. The traced value lights as a busbar; the rest dims."
      >
        <div className="max-w-[640px]">
          <SectorMap scene={DEMO_SCENE} board={demoBoard} onFocus={() => {}} />
          <div className="mt-3">
            <MarkLegend />
          </div>
        </div>
      </Row>

      <Row
        title="Fluted glass"
        note="The one material. Behind the sector only, still under reduced motion. Paper Shaders, Apache-2.0."
      >
        <div className="relative h-56 overflow-hidden rounded-[7px] border border-rule">
          <ShaderBackground />
        </div>
      </Row>
    </main>
  );
}
