import type { Check } from "../state";

export type AuthAnswer = {
  status: number | null;
  location: string | null;
  body: string;
  error?: string;
};

export type Verdict = { result: Check["result"]; why: string };

const ACCOUNTS_HOST = "accounts.google.com";

/**
 * Where Google sends a signed-out request once it has accepted the client and redirect URI.
 * PROVISIONAL: from Google's documented behaviour; confirm against recordings (BB-05 ticket).
 */
const SIGN_IN_PATHS = [
  "/v3/signin/identifier",
  "/v3/signin/accountchooser",
  "/signin/v2/identifier",
  "/ServiceLogin",
  "/AccountChooser",
  "/o/oauth2/auth/oauthchooseaccount",
  "/signin/oauth/consent",
];

const parse = (url: string | null) => {
  if (!url) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
};

const MISMATCH = "redirect_uri_mismatch";

/** Google's error redirect carries the OAuth error code inside a base64 protobuf, `authError`. */
function authError(to: URL | null): string | null {
  const raw = to?.searchParams.get("authError");
  if (!raw) return null;
  try {
    return atob(raw.replace(/-/g, "+").replace(/_/g, "/")).match(/[a-z][a-z_]{3,}/)?.[0] ?? null;
  } catch {
    return null;
  }
}

export function classify(a: AuthAnswer): Verdict {
  if (a.status === null)
    return { result: "unknown", why: `busbar couldn't reach Google (${a.error ?? "no answer"})` };
  const to = parse(a.location);
  const redirect = a.status >= 300 && a.status < 400;
  const code = authError(to);
  if (code === MISMATCH || a.body.includes(MISMATCH) || a.location?.includes(MISMATCH))
    return { result: "rejected", why: `Google answered ${MISMATCH}` };
  if (redirect && to?.protocol === "https:" && to.hostname === ACCOUNTS_HOST) {
    if (code) return { result: "unknown", why: `Google answered ${code}` };
    if (SIGN_IN_PATHS.includes(to.pathname))
      return { result: "accepted", why: "Google sent the request on to sign-in" };
  }
  if (a.status === 429) return { result: "unknown", why: "Google rate-limited the check" };
  if (to?.pathname.startsWith("/sorry/") || /unusual traffic|captcha/i.test(a.body))
    return { result: "unknown", why: "Google asked for a captcha" };
  return { result: "unknown", why: "Google's answer wasn't one busbar recognises" };
}
