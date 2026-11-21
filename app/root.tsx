import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/figtree";
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

import type { Route } from "./+types/root";
import "./app.css";

// Direction contract (impeccable). Kept as an HTML comment in the emitted markup.
const CONTRACT = `<!--
THESIS: Every value is a flight strip in a rack; busbar works the board and hands you the one strip it can't clear. Refuses the node-graph dashboard with neon status dots.
OWN-WORLD: Ink #0B0B0C bay (70%), white strip stock (20%), signal lime #C6F432 (10%) for the lit bus, primary action, stamps and the your-turn tab. Ink tier holders, 13px one-size strips, marks not hues, fluted-glass behind the sector only. Bricolage Grotesque + Figtree, Pika icons.
STORY: The dev sees which registrations drifted, plans, applies, takes the one handed-over click, and verifies until the marks are proven.
FIRST VIEWPORT: Flight bar with the bb command and Plan/Apply/Verify; left, sector map with tunnel.url lit as a busbar tapping five providers; right, Plan/Active/Your turn/Cleared bays with counts.
FORM: ATC flight progress strip board, grounded candidate 3 of 7, seed 5e3cd81d.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
-->`;

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0b0b0c" />
        <Meta />
        <Links />
      </head>
      <body>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static design contract comment */}
        <div hidden dangerouslySetInnerHTML={{ __html: CONTRACT }} />
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function HydrateFallback() {
  return <div className="min-h-screen bg-ink" />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Something broke";
  let details = "busbar hit an unexpected error. Your providers were not touched.";
  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "No such page" : "Error";
    details = error.status === 404 ? "bb ui serves the board at / and the component kit at /kit." : error.statusText || details;
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
  }
  return (
    <main className="mx-auto max-w-[68ch] px-6 py-24">
      <h1 className="font-display text-[32px] font-semibold tracking-[-0.02em]">{message}</h1>
      <p className="mt-3 text-mute">{details}</p>
      <a href="/" className="mt-6 inline-block text-signal underline">
        Back to the board
      </a>
    </main>
  );
}
