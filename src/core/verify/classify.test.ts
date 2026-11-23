import { describe, expect, it } from "vitest";
import { answerOf as answer, fixture } from "../../../test/helpers/google-auth";
import { classify } from "./classify";

describe("verify classifier on Google authorize fixtures", () => {
  it.each([
    ["accepted-signin-identifier"],
    ["accepted-servicelogin"],
    ["mismatch-error-redirect"],
    ["mismatch-error-page"],
    ["invalid-client"],
    ["rate-limited"],
    ["captcha"],
    ["new-format"],
    ["lookalike-host"],
  ])("%s", (name) => {
    expect(classify(answer(name)).result).toBe(fixture(name).expect);
  });
});

describe("verify classifier says why it couldn't tell", () => {
  it.each([
    ["invalid-client", "Google answered invalid_client"],
    ["rate-limited", "Google rate-limited the check"],
    ["captcha", "Google asked for a captcha"],
    ["new-format", "Google's answer wasn't one busbar recognises"],
    ["lookalike-host", "Google's answer wasn't one busbar recognises"],
  ])("%s", (name, why) => {
    expect(classify(answer(name))).toEqual({ result: "unknown", why });
  });
});

describe("verify classifier without an answer", () => {
  it("a request that never got an answer is unknown, and says so", () => {
    expect(classify({ status: null, location: null, body: "", error: "fetch failed" })).toEqual({
      result: "unknown",
      why: "busbar couldn't reach Google (fetch failed)",
    });
  });
});

describe("verify classifier on an error code", () => {
  it("an OAuth error code beats an allowlisted sign-in path: unknown, not accepted", () => {
    const authError =
      "Cg5pbnZhbGlkX2NsaWVudBIfVGhlIE9BdXRoIGNsaWVudCB3YXMgbm90IGZvdW5kLiCRAw%3D%3D";
    expect(
      classify({
        status: 302,
        location: `https://accounts.google.com/v3/signin/identifier?authError=${authError}`,
        body: "",
      }),
    ).toEqual({ result: "unknown", why: "Google answered invalid_client" });
  });
});
