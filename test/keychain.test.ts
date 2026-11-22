import { describe, expect, it } from "vitest";
import { keychainCheck } from "./helpers/keychain-check";

// Real-world check (BB-02 "Real-world checks pending", step 6). Skipped unless
// BB_REAL_PROFILE names a busbar profile you signed into, e.g.
//   BB_REAL_PROFILE="$HOME/Library/Application Support/busbar/profiles/spike/brave" npx vitest run test/keychain.test.ts
const PROFILE = process.env.BB_REAL_PROFILE;

describe.skipIf(!PROFILE)("Keychain encryption of a real busbar profile", () => {
  it("every stored cookie is v10-encrypted, and none has a plaintext value", async () => {
    const r = await keychainCheck(PROFILE ?? "");
    expect(r.rows, `${r.file} holds no cookies; sign in first`).toBeGreaterThan(0);
    expect(r.v10).toBe(r.rows);
    expect(r.plaintext).toBe(0);
  });
});
