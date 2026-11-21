import { EyeOffIcon } from "@pikaicons/core-free";
import { PikaIcon } from "~/components/icons";
import { MARK_LABEL, Mark } from "~/components/mark";
import { type BoardState, type Scene, type ValueId, valueMark } from "~/lib/board";

/** Every value busbar holds, where it lives, and whether that's proven. Secrets show as fingerprints. */
export function Ledger({
  scene,
  board,
  onFocus,
}: {
  scene: Scene;
  board: BoardState;
  onFocus: (v: ValueId) => void;
}) {
  const { destinations: DESTINATIONS, values: VALUES } = scene;
  return (
    <div className="overflow-x-auto">
      <table className="bb-ledger min-w-[760px]">
        <thead>
          <tr>
            <th scope="col">Value</th>
            <th scope="col">Kind</th>
            <th scope="col">Holds</th>
            <th scope="col">Registered in</th>
            <th scope="col">State</th>
          </tr>
        </thead>
        <tbody>
          {VALUES.map((v) => {
            const mark = valueMark(board, v);
            const selected = board.focus === v.id;
            return (
              <tr
                key={v.id}
                aria-selected={selected}
                tabIndex={0}
                onClick={() => onFocus(v.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onFocus(v.id);
                  }
                }}
              >
                <td>
                  <span className="font-semibold">{v.id}</span>
                  <span className="block text-[12.5px] text-mute">{v.origin}</span>
                </td>
                <td className="text-mute">{v.kind}</td>
                <td>
                  {v.secret ? (
                    <span className="inline-flex items-center gap-2 text-mute">
                      <PikaIcon icon={EyeOffIcon} size={14} strokeWidth={1.8} />
                      <span className="font-mono text-[12.5px] text-paper">{v.fingerprint}</span>
                    </span>
                  ) : (
                    <span className="font-mono text-[12.5px]">
                      {v.literal?.replace("https://", "")}
                    </span>
                  )}
                </td>
                <td>
                  <span className="flex flex-wrap gap-1.5">
                    {v.routes.map((d) => (
                      <span key={d} className="bb-chip">
                        {DESTINATIONS.find((x) => x.id === d)?.name}
                      </span>
                    ))}
                  </span>
                </td>
                <td>
                  <span className="inline-flex items-center gap-2 whitespace-nowrap">
                    <Mark kind={mark} />
                    <span key={mark} className="t-swap">
                      {MARK_LABEL[mark]}
                    </span>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
