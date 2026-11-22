import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Proof that a busbar profile keeps its session under the browser's real Keychain
 * encryption: every row of the profile's Cookies DB has an `encrypted_value` starting with
 * `v10` and an empty plaintext `value`.
 *
 * This lives under test/ on purpose. busbar's own code (src/) never opens a browser
 * credential store, and `scripts/guard.mjs` fails the build if it names one. Only counts
 * leave SQLite: a 3-byte prefix comparison and a length test. No cookie name, host or value
 * is read into this process.
 *
 * Run it with busbar's browser closed (the browser locks the DB while it runs).
 */
export async function keychainCheck(profileDir: string) {
  const file = [
    join(profileDir, "Default", "Network", "Cookies"),
    join(profileDir, "Default", "Cookies"),
  ].find(existsSync);
  if (!file)
    throw new Error(`no Cookies DB under ${profileDir}/Default. Is this a signed-in profile?`);
  // Loaded here: node:sqlite prints an experimental warning on import, and most runs skip this.
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db
      .prepare(
        `SELECT count(*) AS rows,
                coalesce(sum(hex(substr(encrypted_value, 1, 3)) = '763130'), 0) AS v10,
                coalesce(sum(length(value) > 0), 0) AS plaintext
           FROM cookies`,
      )
      .get() as { rows: number; v10: number; plaintext: number };
    return { file, rows: Number(row.rows), v10: Number(row.v10), plaintext: Number(row.plaintext) };
  } finally {
    db.close();
  }
}
