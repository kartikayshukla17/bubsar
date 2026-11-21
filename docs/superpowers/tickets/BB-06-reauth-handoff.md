# BB-06: Re-auth mid-run becomes a "your turn" handoff

**Demo when done:** sign out of busbar's Google profile, or wait for Google's step-up prompt,
then run `bb apply`. Instead of failing, busbar says: "Google wants to confirm it's you.
I've opened Brave at the sign-in page. Finish there, then press Enter." The strip sits in the
**Your turn** bay with the handoff card. You confirm, press Enter, and busbar re-reads the
console and carries on.

**Depends on:** BB-04 (works with BB-03's plan too)
**Layers:** core (handoff detection + resume) · cli · run state · ui (handoff card, live) · browser

## Why this slice

"Hand over the click, don't guess" is a core principle, and re-auth is the most common place
a real run stalls. It also has to respect the login rule: the human-facing window carries
no automation, so Google treats it as a normal browser.

## Scope

- **Detect:** during any web-tier step, a navigation to `accounts.google.com` (sign-in,
  challenge, "Verify it's you") or a session-expired page.
- **Hand over:**
  1. Mark the step `handoff` (bay `turn`) and emit the event.
  2. Close the automated browser instance.
  3. Open a **plain, un-automated** window on the same profile at the exact deep link (the
     Google page, with a `continue` back to the client).
  4. Print one instruction naming the browser, the page and what to do, then wait for Enter.
     `Ctrl-C` leaves the step in `handoff` and exits 2.
- **Resume:** reattach automation, restart the step **from its read**, not mid-write, and
  re-check that nothing changed since plan (BB-04's rule). Then continue the run.
- **UI:** the existing handoff card shows the instruction and browser. It's read-only in v1,
  so the card says "Press Enter in your terminal when done".
- **Same path for a fully expired session:** "run `bb login google`" becomes a handoff instead
  of a failure.

## Acceptance criteria

- [ ] Manual: sign out inside busbar's profile → `bb apply` → handoff → sign in → Enter →
      apply completes and lands `applied`.
- [ ] The handoff window has no debugging connection (checked in a test by the launch args
      and the absence of a pipe or port).
- [ ] Resume never re-sends a partial write. A test with a fake recipe interrupts between
      add and save, then resumes, and confirms there's exactly one save.
- [ ] `Ctrl-C` during a handoff exits 2, leaves the strip in Your turn, and changes nothing in
      Google.
- [ ] The board shows the strip in the Your turn bay within 1s, and it moves on after resume.

## Out of scope

Handing off from the UI with a button (v1 UI is read-only). Irreducibly human gates for other
providers.

## Notes & risks

- Detect by URL host and path, not page text, since text is localized.
- Some Google challenges complete without a page change (a phone prompt). The Enter key is
  the source of truth, not a page event.
