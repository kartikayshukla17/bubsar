import { createHash } from "node:crypto";

/**
 * A secret value busbar holds in memory. It can only ever be written down as
 * `{ slot, fingerprint }`: run state, the event stream, CLI output and the UI never see it.
 */
export class Secret {
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: held for the slice that first writes a secret; never serialized
  readonly #value: string;
  readonly slot: string;
  readonly fingerprint: string;

  private constructor(slot: string, value: string) {
    this.#value = value;
    this.slot = slot;
    const hex = createHash("sha256").update(value).digest("hex");
    this.fingerprint = `sha256 ${hex.slice(0, 4)}…${hex.slice(-4)}`;
  }

  static of(slot: string, value: string) {
    return new Secret(slot, value);
  }

  toJSON() {
    return { slot: this.slot, fingerprint: this.fingerprint };
  }

  toString() {
    return `[secret ${this.slot} ${this.fingerprint}]`;
  }

  [Symbol.for("nodejs.util.inspect.custom")]() {
    return this.toString();
  }
}
