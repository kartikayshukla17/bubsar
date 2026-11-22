# BB-04: `bb apply` rewires the OAuth client

**Demo when done:** `bb apply` shows the plan, asks `Apply 2 changes to Google? [y/N]`, then
edits the OAuth client in your signed-in profile: it adds the new URI, removes the old one,
saves, and reads the lists back. On the board, the Google strip moves Plan → Active → Cleared
and lands as **applied**, not verified.

**Depends on:** BB-03
**Layers:** core (Google recipe: write path) · cli · run state · ui (`failed` mark) · browser

## Why this slice

This is the first time busbar touches a provider. It lands with its safety rails on: a fresh
plan at apply time, an explicit confirm, a read-back, and an honest `applied`.

## Scope

- **Fresh plan at apply time:** `bb apply` re-reads the console. If the current state differs
  from the last `bb plan`, it stops: "Google changed since you planned. Run `bb plan` again."
- **Confirm gate:** an interactive `y/N` listing every add and remove. `--yes` skips it, for
  scripts, but the plan is still printed first. No TTY and no `--yes` means refuse.
- **Write path:** through recorded selectors: add each new entry, remove each owned stale
  entry, press Save, wait for Google's saved confirmation.
- **Read-back:** re-read both lists after saving. Mark `applied` only if they match the plan
  exactly. Otherwise mark `failed`: "Saved, but Google shows a different list: …".
- **Ownership:** on success, record added entries as owned and drop removed ones from
  `.busbar/state.json`.
- **Idempotent:** a second `bb apply` with nothing to do prints "Nothing to apply" and opens
  no browser.
- **Events:** emit `start` → `activate` → `settle` → `apply-done` so the board animates as
  in the kit.
- **UI:** add a `failed` mark to the kit (strip, ledger, sector-map route), styled to the
  Flight Strip system. Add it to `/kit`.

## Acceptance criteria

- [ ] Against the sandbox client: apply changes both lists, and the console shows exactly the
      planned state.
- [ ] Editing the console between `plan` and `apply` makes apply refuse with the "changed
      since you planned" message, having written nothing.
- [ ] Answering `N` (or no TTY without `--yes`) writes nothing.
- [ ] A forced Save failure (e.g., inject an invalid URI in a test build) ends as `failed`
      with Google's own error text, never `applied`.
- [x] The second apply is a no-op and launches no browser.
- [x] The strip never shows `verified` after apply. Only BB-05 can produce that.
- [x] `/kit` shows the new `failed` mark next to the others.

## Out of scope

Verification (BB-05), re-auth mid-apply (BB-06; until then a redirect fails the step
cleanly).

## Notes & risks

- If Google asks to confirm the save in a dialog, treat it as part of the recorded flow,
  not a surprise.
- Never press Save on a page whose lists busbar didn't just read. A navigation or reload
  between read and write aborts the step.

## Done (2026-11-22)

`bb apply [--yes]` acts on the plan `bb plan` recorded. It re-reads the console, refuses if
anything moved, prints every add and remove, asks, edits the client, presses Save once,
reloads, and marks the strips `applied` only when the read-back equals the plan exactly.
Everything here ran against the stand-in page in headless Brave and the fake world. None
of it has touched the real console.

Ticked: the no-op second apply, no `verified` after apply, and `/kit`. The first four boxes
are proven on the stand-in and the fake world, and stay open until the real-world checks
below pass.

### Tests added

- Seam 1, `src/core/board.test.ts`: `fail` marks the strip `failed` with its note, leaves it
  in the bay it stopped in, sets phase `failed`, and leaves other strips alone.
- Seam 2, `test/google-console.test.ts` (Brave, stand-in):
  - `Page.fill` replaces an entry so the page's framework model sees it. The stand-in's
    entry inputs now update their model only from input events. The old `fill` saved
    `…4000/cbhttp://localhost:3000/cb`.
  - write adds and deletes, saves once, and reads back after a reload (request log:
    page, save, page).
  - The read-back reports what Google stored, not what busbar typed (mutation-proven).
  - A reload between read and write aborts before any edit, with no Save.
  - Edits that don't show on the page: no Save.
  - No confirmation after Save: fails, and doesn't claim anything was saved.
  - A read-back that fails after a confirmed Save never says "Nothing was changed".
  - A refused Save is `SaveRejected` with Google's text, and the lists are unchanged.
  - The selector contract skips `savedToast` and `saveError`, which only appear after Save.
- Seam 3, `test/apply.test.ts`:
  - no plan
  - logged out since the plan
  - console changed since the plan (zero saves)
  - busbar.toml changed (no browser)
  - no terminal and no `--yes`: plan printed, refused, zero saves
  - `--yes` happy path: exact output, one save, ownership, `planned`, event order, strips
    `applied`
  - no run on disk: one is started
  - second apply: "Nothing to apply", fake world and `.busbar/` byte-identical
  - refused Save: `failed` in Google's words, never `applied`
  - read-back mismatch: `failed`, and ownership follows what Google holds
  - sign-in bounce at the re-read: `failed`, local.json signed-out, zero saves
- Seam 3, `test/plan.test.ts`:
  - `planned` records `values` and `desired`.
  - A failed read (selector or sign-in) starts a run whose unread strips are `failed` with
    the error.
  - A failing browser close is reported on its own line and doesn't replace the read's
    error.

### Decisions

- `state.json` `planned` is `{ values, desired, read, next }`. Apply takes no `--tunnel`.
  It refuses when busbar.toml plus `values` no longer gives `desired`, or when the fresh
  read differs from `read`.
- After a clean apply, `planned.read` and `planned.next` both become the saved lists. A
  second apply sees no changes and prints "Nothing to apply" without opening a browser.
- Events: `start`, then `activate` for every step, then one Save, then `settle` for every
  step and `apply-done`. Settling a step before Save would claim a write that hadn't
  happened. Any failure after the plan loads emits `fail` for every step with the reason.
  Refusals (changed console, changed toml, no terminal, answered no) emit nothing.
- `fail` keeps the strip in its bay (Plan for a failed `bb plan`, Active for a failed
  apply) and sets a new phase, `failed`. The live status line reads "Stopped: <reason>".
- Ownership follows the read-back. On success, adds go in and removals come out. On a
  mismatch, busbar owns only the adds Google kept and drops only the removals Google
  dropped. A refused or unconfirmed Save leaves ownership unchanged.
- The write path never saves a page it didn't read in the same load. `Page.loadId()` is a
  token on the document's window, checked before editing and again before Save. Before
  Save, write re-reads the page's lists through the fail-closed `list()` and requires them
  to equal `next`. That check also refuses any `next` that would need a reorder.
- `PuppeteerPage.fill` focuses the field, selects all, presses Backspace, then types. Every
  change is a real key event.
- `withConsole` closes the browser after plan and apply. A close failure is reported on its
  own line and never replaces the original error.
- No TTY test: macOS `script` rejects Node's socket and FIFO stdio, and with file stdin it
  sends EOF before the prompt. The `y`/`N` prompt is a manual check (step 3).
- `vitest.config.ts` sets `testTimeout: 20_000`.

### Real-world checks pending

These need Kartikay, the sandbox OAuth client and busbar's Brave profile. Run BB-03's
checks 1 to 3 first, so the read selectors are recorded against the live page.

1. **Record the write selectors.** On the client page in busbar's profile, open DevTools.
   - Check that `saveButton` matches exactly one element, and that it is the Save button.
   - Add a throwaway redirect URI by hand, press Save, and while the confirmation shows run
     `document.querySelectorAll('[role="status"]:not(:empty)')`. Record its text. If
     Google shows "Saving…" before the confirmation, `savedToast` must match only the
     final text.
   - Save an invalid URI (for example `http://x`) and check that
     `[role="alert"]:not(:empty)` holds Google's error text.
   - If Google asks to confirm the Save in a dialog, record its button. It becomes part of
     the write path.
   - Update `selectors.ts`, then remove the throwaway entry.
2. **Apply changes both lists (acceptance 1).**
   - Run `bb plan --tunnel https://<a>.ngrok-free.app`, then `bb apply --yes`. Expect
     "Saved. Google's lists read back exactly as planned." and exit 0.
   - Reload the console. Both lists must be exactly the plan's `next`.
   - Run `bb apply` again. It must print "Nothing to apply" and open no browser window.
3. **Confirm gate (acceptance 3).** Run `bb plan --tunnel https://<b>.ngrok-free.app`,
   then `bb apply` in a terminal.
   - Answer `n`. Expect "Not applied: you answered no. Nothing changed in Google." and
     exit 1. The console must be unchanged.
   - Run `bb apply < /dev/null`. It must refuse after printing the plan, with exit 1.
   - Run `bb apply` and answer `y`. It must apply.
4. **Changed since plan (acceptance 2).** Run `bb plan --tunnel https://<c>.ngrok-free.app`.
   Add a redirect URI by hand in the console and Save. `bb apply --yes` must print
   "Google changed since you planned. Run `bb plan` again." and exit 1, and the console
   must still show your hand edit.
5. **Forced Save failure (acceptance 4).** In `busbar.toml`, temporarily add
   `"http://not a uri/cb"` to `redirect_uris`. Run `bb plan --tunnel <same>`, then
   `bb apply --yes`.
   - Expect `bb: Google didn't save the client: <Google's text>` and exit 1.
   - The `bb ui` strip shows Failed with the same text, and the console is unchanged.
   - Revert busbar.toml.
6. **Framework inputs.** After step 2, confirm the saved entries are exactly what busbar
   typed, with no doubled or stale text. If they aren't, `fill` needs a different strategy
   for Google's inputs.
7. **Board.** Keep `bb ui` open during step 2. The strips must move Plan → Active →
   Cleared and land Applied, never Verified.
