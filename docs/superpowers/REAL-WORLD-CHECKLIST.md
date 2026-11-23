# busbar real-world checks: one session, in order

BB-01 to BB-08 were built against fakes and a hand-built stand-in of the console. Nothing has
touched real Google. This is the one script for the checks that need Kartikay, his Google
account, the sandbox OAuth client or a person at a browser. Run it top to bottom. Each step
names the ticket check it settles. The ticket has the full text, and this page has the order.

Order matters. Selectors are recorded before anything relies on them, and real responses are
recorded before the verify checks read them. Firefox goes last, because its first launch is
the risky one.

## Setup (once)

1. **A sandbox project.** Make it outside the repo, pointing at the throwaway Cloud project
   and its OAuth web client (tickets README, "Before BB-03"):
   ```sh
   mkdir -p ~/bb-sandbox && cd ~/bb-sandbox
   cat > busbar.toml <<'EOF'
   [project]
   name = "sandbox"

   [values."tunnel.url"]
   kind = "url"
   source = "arg"

   [destinations.google]
   project_id = "<sandbox project id>"
   client_id  = "<sandbox client id>"
   redirect_uris = ["{tunnel.url}/api/auth/callback/google"]
   js_origins    = ["{tunnel.url}"]
   EOF
   ```
2. **The build.** In the repo: `eval "$(fnm env)" && fnm use && npm run build`. Then use
   `alias bb="node <repo>/dist/bb.js"` in every terminal below. Rebuild after any selector
   change.
3. **Names used below.**
   `P="$HOME/Library/Application Support/busbar/profiles/sandbox"`, plus `CID` and `PID` set
   to the client ID and project ID from busbar.toml.
4. **Three terminals in `~/bb-sandbox`.** One runs `bb ui`, one runs commands, and one runs
   probes.

## Pre-flight

1. **Open Firefox once by hand (BB-08 check 0).** Launch `/Applications/Firefox.app` from
   Finder, answer Gatekeeper if it asks, and quit. Do this before any busbar command or test
   touches Firefox, so neither one is the bundle's first launch.
2. **Decide on the quarantine flag. This is your call.** Check it with
   `xattr -p com.apple.quarantine /Applications/Firefox.app`. The Firefox seam-2 tests (step
   G1) skip while the flag is there, even with `BB_TEST_FIREFOX=1`. Clearing it is a security
   setting, so only you decide: `xattr -d com.apple.quarantine /Applications/Firefox.app`.
   If you leave it, skip G1 and note that the two Firefox-only tests still haven't run.
3. **Housekeeping.** Delete the stray default profile from BB-08's build if you don't want
   it: `~/Library/Application Support/Firefox/Profiles/du2t9eol.default-release`.

## A. Sign-in and automation on Brave (the BB-02 spike)

If A1 or A2 fails, stop. The design needs revisiting before anything else here.

1. **Sign-in isn't blocked (BB-02 check 1).** Run `bb login google --browser brave`, sign in
   yourself, wait for the console, and press Enter. Record any "This browser or app may not be
   secure" page. Expect `google: signed in · Brave`, then `bb status` → signed in.
2. **Enter vs Cmd-Q (BB-02 check 2).** Run `bb logout google`, then log in again and quit
   with Cmd-Q. Expect the same result, and no `SingletonLock` in `"$P/brave"`.
3. **Redirect timing (BB-02 check 3).** Run the ticket's node snippet with the profile path
   changed to `$P/brave`. Both URLs must be on `console.cloud.google.com`.
4. **Headless (BB-02 check 4).** Run the same snippet with `HEADLESS=1`. If it loads signed
   in, set `sessionCheck.headless = true` in `src/core/session.ts` and rebuild.
5. **Keychain encryption (BB-02 check 6, Brave).** With busbar's Brave closed:
   `BB_REAL_PROFILE="$P/brave" npx vitest run test/keychain.test.ts` from the repo. Record
   any Keychain prompt.
6. **Board chip (BB-02 check 7).** With `bb ui` open, run `bb logout google` and then
   `bb login google` in the command terminal. The chip changes within a second.

## B. The read selectors and the deep link (BB-03 checks 1 to 3)

1. **Deep link (BB-03 check 1).** Open the client page in busbar's Brave profile from the
   ticket's command. It must land on the edit page with both lists. Fix `clientUrl` if it
   doesn't.
2. **Record the read selectors (BB-03 check 2).** Use DevTools on that page. Update
   `selectors.ts`, bump its version line, and rebuild.
3. **Scrubbed DOM snapshot (BB-03 check 3).** Save it to
   `test/fixtures/google-console/snapshot.html`, scrub it, and run the ticket's `grep`, which
   must print nothing. Point the selector contract test at it.

## C. The write selectors (BB-04 check 1)

1. **Record Save, its confirmation and its error** on the same page, as the ticket says.
   Record any confirm dialog. Update `selectors.ts`, remove the throwaway entry, and rebuild.

## D. Real authorize responses (BB-05 check 1)

1. **Record them with busbar's User-Agent.** busbar's check is Node's `fetch`, which sends
   `User-Agent: node`, so record with the same header. For a URI on the client, one not on
   it, and a made-up client ID:
   ```sh
   curl -sS -A node -D - -o body.html \
     "https://accounts.google.com/o/oauth2/v2/auth?client_id=$CID&redirect_uri=<URI>&response_type=code&scope=openid"
   ```
   Don't use a cookie jar or `-L`. Save each response as `test/fixtures/google-auth/<name>.http`,
   scrub the client ID, and mark the header "recorded <date> from the sandbox client". Fix
   `SIGN_IN_PATHS` or the classifier if the shapes differ. `npx vitest run src/core/verify`
   must pass.

## E. The functional checks, through the full rewire

Keep `bb ui` open for all of E.

1. **Plan reads the real client (BB-03 checks 4 to 8).** Check the lists, three runs alike,
   a hand-added entry kept, likely stale and `--adopt`, the broken selector with `--debug`,
   and the network log. Remove the hand-added entries afterwards.
2. **Skip BB-03 check 9.** BB-06 superseded it: an expired session now hands the sign-in to
   you instead of failing with "session expired". E4 covers it.
3. **Apply (BB-04 checks 2 to 7).** Check both lists change, the confirm gate, changed since
   plan, a forced Save failure, framework inputs, and the board.
4. **Re-auth handoff (BB-06 checks 1 to 6).** Check the manual handoff on apply, Ctrl-C in a
   real terminal, board timing, step-up mid-run, the continue link, and Cmd-Q instead of
   Enter.
5. **Guards added in the final review fixes.**
   1. **One command at a time.** Run `bb plan --tunnel https://<p>.ngrok-free.app`, then
      `bb apply` and leave it at `Apply N changes to Google? [y/N]`. In the second terminal,
      run `bb plan --tunnel https://<q>.ngrok-free.app`. Expect `bb: another bb command is
      running in this project (pid N)…` and exit 1. `bb ui` still follows the run. Don't run
      `bb status` here: it takes no lock, but it would attach to the profile apply holds.
      Answer `n` in the first terminal. `ls .busbar/lock` must then say there's no such file.
   2. **A route change before Save.** Again leave `bb apply` at `[y/N]`. Open busbar's
      minimized Brave from the Dock and, inside the console, go to another OAuth client
      (any client list or link, not a reload). Then answer `y`. Expect "The client page
      moved to another address after busbar read it, so busbar didn't press Save. Nothing
      was changed.", exit 1, and both clients unchanged in the console. If the console loads
      a new document for that move, expect "The client page reloaded after busbar read it…"
      instead. Record which one you saw.
   3. **Verify before any read.** In a fresh copy of the project (same busbar.toml, no
      `.busbar/`), run `bb verify; echo $?`. Expect "busbar hasn't read Google yet. Run bb
      plan, then bb apply." and `3`.
6. **Verify (BB-05 checks 2 to 5).** Check eventually verified after apply, a URI never
   added → not accepted, gentleness, and the network off for real.
7. **The full rewire and screen capture (BB-07 checks 1 to 6).** Run the whole loop on a
   rotated tunnel, the board beside it, the board opened mid-run, a rerun, answering no, and
   record the terminal and board side by side for the build-in-public log.

## F. Dia

1. **Sign-in and automation (BB-02 check 5).** Repeat A1 to A4 with `--browser dia` and
   `Dia.app/Contents/MacOS/Dia`. Then `bb login google` again shows "already signed in" with
   no window.
2. **Keychain encryption (BB-02 check 6, Dia).** Run
   `BB_REAL_PROFILE="$P/dia" npx vitest run test/keychain.test.ts`.
3. **Plan on Dia (BB-03 check 10).** Run E1's list check and broken selector check in Dia.
4. **Rewire on Dia (BB-08 check 9, Dia half).** Run E7's first check on Dia. `bb status`
   still prints the Keychain line. busbar's tests never launch Dia, so this is the only
   time it runs automated.

## G. Firefox (BB-08)

1. **The two Firefox-only seam-2 tests, on real Firefox.** Only do this if you cleared the
   flag in pre-flight step 2. Start the probe in the probe terminal first. It runs about 30s
   and lists every remote address a test profile's processes open:
   ```sh
   for i in $(seq 1 150); do M=$(pgrep -f -- "bb-profile-" | tr '\n' ,); [ -n "$M" ] && lsof -nP -i -a -p "${M%,}" | awk 'NR>1{print $9}'; sleep 0.2; done | sort -u > /tmp/bb-ff-net.txt
   ```
   Then run this in the repo:
   `BB_TEST_FIREFOX=1 npx vitest run test/puppeteer.test.ts test/google-console.test.ts`.
   Expect every Firefox test to pass, the BiDi-close and prefs-restore tests included, and
   `/tmp/bb-ff-net.txt` to hold loopback addresses only (`127.0.0.1`, `[::1]`). Record any
   other address and stop: the loopback prefs have a gap.
2. **Sign-in isn't blocked (BB-08 check 1).** Run `bb logout google`, then
   `bb login google --browser firefox`.
3. **The pid-scoped clean quit and the Automation prompt (BB-08 check 2).** Press Enter the
   moment the console shows. busbar's Firefox closes on its own within a second or two, and
   your everyday Firefox is untouched. Record whether macOS asks if osascript may control
   Firefox (System Settings → Privacy & Security → Automation). If you deny it, the quit
   falls back to SIGTERM after 10s. Then `bb status` still says signed in.
4. **The rest (BB-08 checks 3 to 8 and 10).** Check the minimized automated window, clean
   prefs on the real profile, plan, apply and verify, the re-auth handoff, rewire, profile
   permissions, and the first-launch note.
5. **Brave regression (BB-08 check 9, Brave half).** Re-run E7's first check on Brave.

## Clean up

`bb logout google` (it removes and names every profile), then `rm -rf ~/bb-sandbox`.
Tick each ticket's boxes that this session proved, and note what didn't hold.
