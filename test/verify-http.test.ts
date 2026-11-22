import { afterEach, describe, expect, it } from "vitest";
import { askAuthorize } from "../src/core/verify/authorize";
import { classify } from "../src/core/verify/classify";
import { type AuthStub, authStub, deadAuthUrl } from "./helpers/google-auth";

const CLIENT = "000000000000-fixture.apps.googleusercontent.com";
const URI = "https://new.ngrok-free.app/api/auth/callback/google";

let stub: AuthStub | undefined;
afterEach(async () => {
  await stub?.close();
  stub = undefined;
});

describe("the verify request (local stub, never Google)", () => {
  it("is one plain GET with the client, the redirect URI, code and openid, carrying no cookie", async () => {
    stub = await authStub(() => "accepted-signin-identifier");
    const answer = await askAuthorize(stub.url, CLIENT, URI);
    expect(stub.requests).toHaveLength(1);
    const [seen] = stub.requests;
    expect(seen.method).toBe("GET");
    expect(seen.path).toBe("/o/oauth2/v2/auth");
    expect(seen.query).toEqual({
      client_id: CLIENT,
      redirect_uri: URI,
      response_type: "code",
      scope: "openid",
    });
    expect(seen.headers.cookie).toBeUndefined();
    expect(seen.headers["user-agent"]).toBe("node");
    expect(Object.keys(seen.headers).filter((h) => h.startsWith("sec-ch-ua"))).toEqual([]);
    expect(classify(answer).result).toBe("accepted");
  });

  it("never follows the redirect, and hands back where it pointed as an absolute URL", async () => {
    stub = await authStub(() => ({ status: 302, headers: { location: "/followed" }, body: "" }));
    const answer = await askAuthorize(stub.url, CLIENT, URI);
    expect(stub.requests.map((r) => r.path)).toEqual(["/o/oauth2/v2/auth"]);
    expect(answer).toEqual({ status: 302, location: `${stub.origin}/followed`, body: "" });
  });

  it("with the network off, comes back without an answer, which classifies as unknown", async () => {
    const answer = await askAuthorize(await deadAuthUrl(), CLIENT, URI);
    expect(answer).toMatchObject({ status: null, location: null, body: "" });
    expect(answer.error).toMatch(/ECONNREFUSED/);
    expect(classify(answer)).toEqual({
      result: "unknown",
      why: `busbar couldn't reach Google (${answer.error})`,
    });
  });
});
