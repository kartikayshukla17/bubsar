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
- [ ] The second apply is a no-op and launches no browser.
- [ ] The strip never shows `verified` after apply. Only BB-05 can produce that.
- [ ] `/kit` shows the new `failed` mark next to the others.

## Out of scope

Verification (BB-05), re-auth mid-apply (BB-06; until then a redirect fails the step
cleanly).

## Notes & risks

- If Google asks to confirm the save in a dialog, treat it as part of the recorded flow,
  not a surprise.
- Never press Save on a page whose lists busbar didn't just read. A navigation or reload
  between read and write aborts the step.
