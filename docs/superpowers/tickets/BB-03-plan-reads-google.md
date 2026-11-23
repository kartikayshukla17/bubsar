# BB-03: `bb plan` reads the real Google console

**Demo when done:** `bb plan --tunnel <new>` opens your signed-in profile in the background,
reads the OAuth client's current redirect URIs and JS origins, and prints the exact diff: add
`<new>/api/auth/callback/google`, remove `<old>/…` (which busbar added last time), and keep
`http://localhost:3000/…` (not busbar's). The Google strip on the board shows the same
`from → to`.

**Depends on:** BB-02 (and the hand-made sandbox OAuth client; see README)
**Layers:** core (Google recipe: selectors + diff + ownership) · cli · run state · ui · browser

## Why this slice

Plan-before-touch only means something if the plan reflects reality. This slice turns the
plan from "what we'd like" into "what will actually change", and it's read-only, so it's
safe to build and test against the real console.

## Scope

- **Google recipe module** in `src/core/recipes/google/`: navigates to the OAuth client's
  page (`console.cloud.google.com/auth/clients/<client_id>?project=<project_id>`) and reads
  both URI lists through **recorded selectors** held in one file, versioned, with a short
  comment per selector. No LLM.
- **Fail closed on DOM drift:** if any expected element isn't found within a timeout, the step
  is marked `failed` with "Google console layout changed: `<selector-name>` not found. Nothing
  was changed." It never guesses.
- **Ownership:** `.busbar/state.json` records the entries busbar has added. Diff rules:
  - desired entry missing → **add**
  - busbar-owned entry no longer desired → **remove**
  - entry not owned by busbar → **keep**, never touched
  - not owned, but the host looks like a tunnel (`*.ngrok-free.app`, `*.trycloudflare.com`,
    …) → **keep**, flagged "likely stale". `bb plan --adopt` lets busbar manage it.
- **Output:** the terminal shows a table of add / remove / keep / likely-stale per list. URLs
  are public and shown in full. The client secret is never read, never navigated to, and
  never shown.
- **Debug:** `--debug` saves a local screenshot on failure to `.busbar/debug/` (mode `0600`),
  with a warning that it may show partial client details. Off by default.
- **UI:** the strip shows the real from → to. Likely-stale entries appear as a note on the
  strip.

## Acceptance criteria

- [ ] Against the sandbox client, `bb plan` prints the correct current lists (checked by eye
      against the console).
- [ ] Adding an entry by hand in the console and re-running `bb plan` shows it as "keep".
- [ ] A hand-added `https://x.ngrok-free.app` shows "likely stale". With `--adopt`, it becomes
      a removal.
- [ ] Breaking a selector on purpose makes the step `failed` with the named selector, and the
      command exits non-zero having made no writes.
- [ ] **Selector contract test:** a saved, scrubbed DOM snapshot of the client page (no
      secret, client ID replaced) lives in fixtures. The selector file passes against it
      offline in CI.
- [x] Unit tests cover the diff/ownership rules, including adopt and likely-stale.
- [ ] Network log during `bb plan` shows only Google console hosts.

## Out of scope

Writing (BB-04). Handling a sign-in or re-auth redirect: for now, a redirect to
`accounts.google.com` fails the step with "session expired; run `bb login google`". BB-06
turns that into a handoff.

## Notes & risks

- Google's console is a heavy SPA. Prefer stable attributes (`aria-label`, form field names)
  over generated class names, and record why each selector was chosen.
- Google renamed this area to "Google Auth Platform" in 2025. Confirm the deep-link URL
  shape against the live console in the first hour.

## Done (2026-11-22)

`bb plan` reads the OAuth client through the Google recipe when the project has logged in,
diffs it against busbar.toml and `.busbar/state.json` ownership, and prints per list what it
adds, removes, keeps, and flags as likely stale. Proven against a hand-built stand-in page
in headless Brave and against the fake world; **nothing here has touched the real console**.

**Ticked:** only the diff/ownership unit tests. Not ticked, and why:

- *Selector contract test:* it exists and runs offline (`test/google-console.test.ts`), but
  against the hand-built stand-in (`test/fixtures/google-console/client.html`), not a saved
  snapshot of the real page. Ruled that way for this pass; the snapshot is pending (step 3).
- *Breaking a selector:* proven on the stand-in (seam 2) and in the fake world (seam 3: exit
  1, the exact message, every `.busbar/` file byte-for-byte unchanged). Not yet against the
  sandbox client (step 7). "No writes" means no provider writes: the failed plan also drops
  `state.json` `planned` to null and changes no other `.busbar/` file. The board does not
  show a `failed` strip yet: the `fail` action and `failed` mark are BB-04's. Today a failed
  plan writes no run at all.
- The other four need the sandbox client.

### Tests added

- **Seam 1** `src/core/diff.test.ts` (13): add; remove what busbar owns; keep what it doesn't;
  keep a desired entry already there (even when owned); likely stale on `*.ngrok-free.app`,
  `*.ngrok.app`, `*.ngrok.io`, `*.trycloudflare.com`, `*.loca.lt`; not flagged: bare tunnel
  domain, lookalike, localhost, not-a-URL; `--adopt` removes likely-stale and keeps the rest.
- **Seam 1** `src/core/plan.test.ts` (+4): replace pairing, add (`from: ""`), unpaired
  removals (`google-<list>-remove-N`, `to: ""`), no strip for an entry already there, the
  likely-stale note on the list's first strip, or the run's first strip when its list has none.
- **Seam 2** `test/google-console.test.ts` (8, Brave, `skipIf` no Brave): selector contract
  (every selector in `selectors.ts` matches the stand-in); read both lists in order from the
  deep link (server log shows `/auth/clients/<id>?project=<pid>`); empty list; a renamed
  section → `SelectorMissing("redirectUris")`; renamed entry fields →
  `SelectorMissing("redirectUriInputs")`; entry fields *and* delete buttons both renamed →
  `SelectorMissing("redirectUriInputs")` (every input in the section must be an entry the
  entry selector finds); a section without its Add URI button → `SelectorMissing("redirectUriAdd")`; sign-in bounce by HTTP 302 and by a script redirect after load →
  `ReauthRequired`; screenshot is a PNG.
- **Seam 3** `test/plan.test.ts` (13): never logged in keeps BB-01's unknown plan and says to
  run `bb login google` (no browser); the full table; state.json `planned` / run steps /
  session record / deep link / client untouched; keep + likely stale; `--adopt`; nothing to
  change; missing selector (exit 1, nothing written); expired session and console bounce
  (exit 1, "session expired; run `bb login google`", local.json → signed-out; superseded by
  BB-06, which hands the sign-in to you and exits 2 if you stop there); `--debug`
  screenshot (`.busbar/debug/` `0700`, file `0600`, warning); uninstalled browser; malformed
  `owned` refused before any browser; a plan after logout drops the earlier read plan.

### Decisions

- **Diff order and `next`:** entries print grouped add → remove → keep → likely stale, each
  in list order. `next` is the current list minus removals, with adds appended (what the
  console will show after Add URI). `bb apply` (BB-04) writes `state.json` `planned.next`.
- **Tunnel hosts:** the five above plus `ngrok-free.dev` and `ngrok.dev`. Only subdomains
  count. Likely-stale entries are kept unless `--adopt`; adopting needs no ownership write,
  because the adopted entry is in `planned.next`'s removals and BB-04 drops removed entries
  from `owned` anyway.
- **A failed read leaves no plan (review ruling):** on `SelectorMissing` and
  `ReauthRequired`, `bb plan` sets `state.json` `google.planned` to null and writes nothing
  else to state. `ReauthRequired` also records `local.json` `session: "signed-out"`, so the
  board's session chip stays honest. A successful read records `signed-in`.
- **Fail closed per list:** each list needs its section and its Add URI button (present even
  when the list is empty); the entry inputs must account for every input in the section;
  every entry needs a delete button. A count that disagrees names the selector that drifted.
  Residual gap: if a section rendered with *no* inputs at all (entries not yet rendered, or
  turned into non-input elements), it reads as empty. Real-world step 4 checks for that.
- **BB-04 handoff:** `bb apply` must re-read the console and refuse unless `planned` isn't
  null, the current read equals `planned.read`, and the current desired lists (busbar.toml +
  `--tunnel`) are the ones that produced `planned.next`. (`planned` doesn't record the desired
  lists or tunnel yet: BB-04 should add that, or recompute `next` and compare.)
- **Never logged in** = no `local.json` google record, or that browser's profile is gone.
  The unread plan clears any earlier `planned` read, so `bb apply` can't act on a stale plan.
- **Reauth detection:** any URL on the accounts host (`accounts.google.com` in production),
  checked after load and again whenever an expected element is missing (late script redirect).
- **Automation mode:** `bb plan` attaches with `sessionCheck.headless` (headed and minimized
  until the BB-02 spike says headless works).
- **Strips:** add shows "New entry", remove shows "Remove" over the struck old entry, and the
  likely-stale note follows on the second line (full text in the tooltip). `/kit` has a
  "Planned from the console" row.

### Real-world checks pending

Run these as part of the one ordered session in [REAL-WORLD-CHECKLIST.md](../REAL-WORLD-CHECKLIST.md). It sets the order and the setup, and this list keeps the detail.

Needs Kartikay, the sandbox OAuth client and busbar's Brave profile. Set
`P="$HOME/Library/Application Support/busbar/profiles/<project.name>/brave"`,
`CID=<client_id>` and `PID=<project_id>` from busbar.toml, and run `bb login google` first.

1. **Deep-link URL shape (first hour).** With no other busbar window open:
   `"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" --user-data-dir="$P" --no-first-run "https://console.cloud.google.com/auth/clients/$CID?project=$PID"`.
   It must land on the client's edit page (both URI lists visible), not a list or a 404.
   Note any redirect in the address bar. If the shape differs, fix `clientUrl` in
   `src/core/recipes/google/console.ts`. Quit that window (Cmd-Q) before step 2.
2. **Record the selectors.** On that page open DevTools. For each entry in
   `src/core/recipes/google/selectors.ts`, run
   `document.querySelectorAll('<css>').length` in the console and, if it isn't right, pick
   a stable replacement (`aria-label`, field `name`, role; never generated classes). Also
   check that `[...document.querySelectorAll('<redirectUriInputs css>')].map(e => e.value)`
   gives the redirect URIs in order, and the same for origins. Update `selectors.ts`, bump
   its version line, and drop the PROVISIONAL header only once all of them are recorded.
3. **Scrubbed DOM snapshot.** In the same console run `copy(document.documentElement.outerHTML)`
   and paste it into `test/fixtures/google-console/snapshot.html`. Scrub: replace the client
   ID with `000000000000-standin.apps.googleusercontent.com` and the project ID with
   `busbar-stand-in`; delete the whole client-secret section; remove emails, project numbers
   and names. Then `grep -n "GOCSPX\|@gmail\|$CID\|$PID" test/fixtures/google-console/snapshot.html`
   must print nothing. Point the selector contract test at it. Inputs carry their values as a
   property, not an attribute, so set `value=` attributes on the entry inputs by hand if the
   snapshot has none.
4. **Correct lists (acceptance 1).** `bb plan --tunnel https://<anything>.ngrok-free.app`
   in the project. The table's lists must match the console's, entry for entry and in order.
   Run it three times: the lists must be the same each time. A shorter list means the read
   raced the SPA; record that.
5. **Hand-added entry → keep (acceptance 2).** In the console add redirect URI
   `http://localhost:4000/api/auth/callback/google`, Save, re-run step 4: it shows `keep …
   not busbar's`.
6. **Likely stale and `--adopt` (acceptance 3).** Add redirect URI
   `https://x.ngrok-free.app/api/auth/callback/google`, Save, re-run: `likely stale`. Then
   `bb plan --tunnel <same> --adopt`: it shows `remove … adopted with --adopt`. (No write
   happens; `bb apply` is BB-04.) Remove both hand-added entries afterwards.
7. **Broken selector (acceptance 4).** `shasum .busbar/*.json > /tmp/before`, change
   `redirectUris` in `selectors.ts` to `'section[aria-label="nope"]'`, `npm run build`, then
   `bb plan --tunnel <same> --debug; echo "exit $?"`. Expect "Google console layout changed:
   `redirectUris` not found. Nothing was changed.", `exit 1`, the screenshot warning,
   `shasum -c /tmp/before` all OK, and `stat -f %Lp .busbar/debug/*.png` prints `600`.
   Look at the screenshot, delete it, revert the selector, and rebuild.
8. **Network log (acceptance 7).** In a second terminal, start before `bb plan`:
   `for i in $(seq 1 100); do M=$(pgrep -f -- "--user-data-dir=$P" | tr '\n' ,); [ -n "$M" ] && lsof -nP -i -a -p "${M%,}" | awk 'NR>1{print $9}'; sleep 0.2; done | sort -u > /tmp/bb-net.txt`,
   and alongside it `sudo tcpdump -l -n -i any 'udp port 53' > /tmp/bb-dns.txt`. Then run
   `bb plan --tunnel <same>`. Every DNS name must be a Google console host
   (`console.cloud.google.com`, `*.google.com`, `*.gstatic.com`, `*.googleapis.com`,
   `*.googleusercontent.com`), and every remote in `/tmp/bb-net.txt` must reverse-resolve
   (`dig -x <ip> +short`) to Google. Record any Brave-owned host (updates, safe browsing):
   that is the browser's own traffic, not busbar's, and the README should say so.
9. **Expired session: superseded by BB-06. Skip it.** `bb plan` no longer fails with
   "session expired; run `bb login google`". Since BB-06 it hands the sign-in to you in a
   plain window, and BB-06's checks 1 and 2 cover that path.
10. **Dia.** Automated tests launch Brave only (BB-02: Dia's own networking ignores the
    loopback flags). Run `bb login google --browser dia`, then steps 4 and 7 in Dia.

