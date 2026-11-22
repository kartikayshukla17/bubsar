import { GlobeIcon } from "@pikaicons/core-free";
import { DESTINATION_ICON, PikaIcon } from "~/components/icons";
import { MARK_LABEL, Mark } from "~/components/mark";
import { ShaderBackground } from "~/components/ui/fluted-glass";
import {
  type BoardState,
  type Mark as MarkKind,
  routeMark,
  type Scene,
  type ValueId,
} from "~/lib/board";

const W = 600;
const H = 500;
const SRC_X = 214; // where a source's stub leaves its label
const DEST_X = 404; // where a route lands at a destination label
/** Each value's bus runs at its own x, 20 units apart. */
const busX = (index: number) => 238 + index * 20;

/** Let long env var names break at underscores instead of truncating. */
function breakable(name: string) {
  const parts = name.split("_");
  return parts.map((p, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: a fixed split of a static name; parts never reorder
    <span key={`${p}-${i}`}>
      {p}
      {i < parts.length - 1 ? (
        <>
          _<wbr />
        </>
      ) : null}
    </span>
  ));
}
const pct = (v: number, of: number) => `${(v / of) * 100}%`;

function strokeFor(mark: MarkKind, focused: boolean) {
  if (!focused)
    return { stroke: "rgb(255 255 255 / 0.16)", width: 1, dash: undefined, flow: false };
  switch (mark) {
    case "verified":
      return { stroke: "#c6f432", width: 2.5, dash: undefined, flow: false };
    case "applied":
      return { stroke: "#c6f432", width: 1.75, dash: undefined, flow: false };
    case "active":
    case "checking":
      return { stroke: "#c6f432", width: 2, dash: "6 6", flow: true };
    case "handoff":
      return { stroke: "#c6f432", width: 2, dash: "2 5", flow: false };
    case "drift":
      return { stroke: "rgb(255 255 255 / 0.85)", width: 1.5, dash: "10 5", flow: false };
    case "failed":
      return { stroke: "rgb(255 255 255 / 0.9)", width: 2, dash: "1.5 3.5", flow: false };
    case "rejected":
      return { stroke: "rgb(255 255 255 / 0.9)", width: 2, dash: "8 3 1.5 3", flow: false };
    default:
      return { stroke: "rgb(255 255 255 / 0.55)", width: 1.5, dash: "3 4", flow: false };
  }
}

/**
 * The sector: every value on the left, every place it must be registered on the right.
 * The focused value draws as a lit busbar with taps; everything unrelated dims.
 */
export function SectorMap({
  scene,
  board,
  onFocus,
  glass = true,
}: {
  scene: Scene;
  board: BoardState;
  onFocus: (value: ValueId) => void;
  glass?: boolean;
}) {
  const { destinations: DESTINATIONS, values: VALUES } = scene;
  const focused = VALUES.find((v) => v.id === board.focus) ?? VALUES[0];
  if (!focused) return null;
  const focusDests = new Set(focused.routes);

  // Draw unfocused routes first so the lit bus sits on top.
  const ordered = [...VALUES].sort((a) => (a.id === focused.id ? 1 : -1));

  return (
    <div className="bb-sector">
      {glass ? (
        <div className="bb-sector__glass">
          <ShaderBackground />
        </div>
      ) : null}
      <div className="bb-sector__plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          {ordered.map((value) => {
            const isFocus = value.id === focused.id;
            const bx = busX(VALUES.indexOf(value));
            const ys = [
              value.y,
              ...value.routes.map((d) => DESTINATIONS.find((x) => x.id === d)?.y ?? 0),
            ];
            const top = Math.min(...ys);
            const bottom = Math.max(...ys);
            return (
              <g key={value.id}>
                <path
                  className="bb-route"
                  d={`M${SRC_X} ${value.y} H${bx}`}
                  stroke={isFocus ? "#c6f432" : "rgb(255 255 255 / 0.16)"}
                  strokeWidth={isFocus ? 2.5 : 1}
                />
                <line
                  className="bb-route"
                  x1={bx}
                  x2={bx}
                  y1={top}
                  y2={bottom}
                  stroke={isFocus ? "#c6f432" : "rgb(255 255 255 / 0.12)"}
                  strokeWidth={isFocus ? 5 : 1}
                  strokeLinecap="round"
                />
                {value.routes.map((destId) => {
                  const dest = DESTINATIONS.find((x) => x.id === destId);
                  if (!dest) return null;
                  const st = strokeFor(routeMark(board, value, destId), isFocus);
                  return (
                    <g key={destId}>
                      <path
                        className={`bb-route ${st.flow ? "bb-route--flow" : ""}`}
                        d={`M${bx} ${dest.y} H${DEST_X}`}
                        stroke={st.stroke}
                        strokeWidth={st.width}
                        strokeDasharray={st.dash}
                      />
                      {isFocus ? (
                        <rect
                          x={bx - 4}
                          y={dest.y - 4}
                          width="8"
                          height="8"
                          rx="1.5"
                          fill="#c6f432"
                        />
                      ) : null}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>

        {VALUES.map((value) => {
          const isFocus = value.id === focused.id;
          return (
            <button
              key={value.id}
              type="button"
              className="bb-node bb-node--source"
              style={{
                top: pct(value.y, H),
                right: pct(W - SRC_X + 4, W),
                maxWidth: pct(SRC_X - 8, W),
              }}
              aria-pressed={isFocus}
              onClick={() => onFocus(value.id)}
            >
              <span className="flex min-w-0 flex-col items-end">
                <span className="bb-node__name bb-node__name--source">{breakable(value.id)}</span>
                <span className="bb-node__sub">{value.kind}</span>
              </span>
            </button>
          );
        })}

        {DESTINATIONS.map((dest) => {
          const linked = focusDests.has(dest.id);
          const mark = linked ? routeMark(board, focused, dest.id) : null;
          return (
            <div
              key={dest.id}
              className="bb-node"
              style={{ top: pct(dest.y, H), left: pct(DEST_X + 8, W) }}
              data-dimmed={linked ? undefined : "true"}
            >
              <span className="bb-node__icon grid h-7 w-7 flex-none place-items-center rounded-[5px] bg-ink-3 text-paper ring-1 ring-rule">
                <PikaIcon
                  icon={DESTINATION_ICON[dest.id] ?? GlobeIcon}
                  size={15}
                  strokeWidth={1.8}
                />
              </span>
              <span className="flex flex-col">
                <span className="bb-node__name">{dest.name}</span>
                <span className="bb-node__sub">{dest.where}</span>
              </span>
              {mark ? (
                <span className="ml-1" title={MARK_LABEL[mark]}>
                  <Mark kind={mark} />
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MarkLegend() {
  const kinds: MarkKind[] = [
    "verified",
    "applied",
    "drift",
    "handoff",
    "failed",
    "rejected",
    "unexercised",
    "unknown",
  ];
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-2 text-[12.5px] text-mute">
      {kinds.map((k) => (
        <li key={k} className="inline-flex items-center gap-2">
          <Mark kind={k} size={14} />
          {MARK_LABEL[k]}
        </li>
      ))}
    </ul>
  );
}
