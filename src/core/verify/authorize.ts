import type { AuthAnswer } from "./classify";

export function authUrl(env = process.env) {
  return env.BB_GOOGLE_AUTH_URL ?? "https://accounts.google.com/o/oauth2/v2/auth";
}

const TIMEOUT_MS = 15_000;
const MAX_BODY = 256 * 1024;

export async function askAuthorize(
  endpoint: string,
  clientId: string,
  redirectUri: string,
): Promise<AuthAnswer> {
  const url = new URL(endpoint);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid",
  }).toString();
  try {
    const res = await fetch(url, {
      redirect: "manual",
      credentials: "omit",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const location = res.headers.get("location");
    const body = (await res.text()).slice(0, MAX_BODY);
    return {
      status: res.status,
      location: location === null ? null : new URL(location, url).href,
      body,
    };
  } catch (e) {
    const err = e as Error & { cause?: Error };
    return { status: null, location: null, body: "", error: err.cause?.message ?? err.message };
  }
}
