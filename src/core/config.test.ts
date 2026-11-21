import { describe, expect, it } from "vitest";
import { parseConfig } from "./config";

// The v0 sample from BB-01.
const SAMPLE = `[project]
name = "enquiry-to-paid"

[values."tunnel.url"]
kind = "url"          # public, so shown in full
source = "arg"        # supplied by --tunnel

[destinations.google]
project_id = "my-sandbox-123"
client_id  = "1234-abc.apps.googleusercontent.com"
redirect_uris = ["{tunnel.url}/api/auth/callback/google"]
js_origins    = ["{tunnel.url}"]
`;

const errorOf = (text: string) => {
  try {
    parseConfig(text);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected parseConfig to reject");
};

describe("parseConfig (busbar.toml v0)", () => {
  it("reads the sample into project, values and the Google destination", () => {
    expect(parseConfig(SAMPLE)).toEqual({
      project: { name: "enquiry-to-paid" },
      values: { "tunnel.url": { kind: "url", source: "arg" } },
      destinations: {
        google: {
          project_id: "my-sandbox-123",
          client_id: "1234-abc.apps.googleusercontent.com",
          redirect_uris: ["{tunnel.url}/api/auth/callback/google"],
          js_origins: ["{tunnel.url}"],
        },
      },
    });
  });

  it("names the line of a TOML syntax error, in one line", () => {
    const broken = SAMPLE.replace('client_id  = "1234', 'client_id  = 1234"');
    const msg = errorOf(broken);
    expect(msg).toMatch(/^busbar\.toml:10: /);
    expect(msg).not.toContain("\n");
  });

  it("names a missing key and the line of its table", () => {
    const noClient = SAMPLE.replace(/^client_id.*\n/m, "");
    expect(errorOf(noClient)).toBe(
      "busbar.toml:8: destinations.google.client_id: missing (the OAuth web client to edit)",
    );
  });

  it("names a key with the wrong type and its own line", () => {
    const asString = SAMPLE.replace(
      'redirect_uris = ["{tunnel.url}/api/auth/callback/google"]',
      'redirect_uris = "{tunnel.url}/api/auth/callback/google"',
    );
    expect(errorOf(asString)).toBe(
      "busbar.toml:11: destinations.google.redirect_uris: expected a list of URL templates",
    );
  });

  it("rejects a template that names an undeclared value", () => {
    const typo = SAMPLE.replace("{tunnel.url}/api", "{tunel.url}/api");
    expect(errorOf(typo)).toBe(
      "busbar.toml:11: destinations.google.redirect_uris: {tunel.url} is not a declared value (declared: tunnel.url)",
    );
  });

  it("rejects a value source v0 can't supply", () => {
    const fromEnv = SAMPLE.replace('source = "arg"', 'source = "env"');
    expect(errorOf(fromEnv)).toBe(
      'busbar.toml:6: values."tunnel.url".source: expected "arg" (v0 takes values from flags like --tunnel)',
    );
  });

  it("requires a project name", () => {
    expect(errorOf(SAMPLE.replace('name = "enquiry-to-paid"', ""))).toBe(
      "busbar.toml:1: project.name: missing (names this project's browser profile and run state)",
    );
  });
});
