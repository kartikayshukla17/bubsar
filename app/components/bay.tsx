import type { ReactNode } from "react";

/** A strip bay: a named rack with a running count, rails at the slot pitch. */
export function Bay({
  name,
  hint,
  count,
  empty,
  children,
}: {
  name: string;
  hint?: string;
  count: number;
  empty: string;
  children?: ReactNode;
}) {
  return (
    <section className="bb-bay" aria-label={`${name}: ${count}`}>
      <header className="bb-bay__head">
        <h3 className="bb-bay__name">
          {name}
          {hint ? <span className="bb-bay__hint">{hint}</span> : null}
        </h3>
        <span key={count} className="bb-bay__count t-swap" data-zero={count === 0 ? "true" : undefined}>
          {count}
        </span>
      </header>
      <div className="bb-rack">{count === 0 ? <div className="bb-slot-empty">{empty}</div> : children}</div>
    </section>
  );
}
