import { parse, TomlError } from "smol-toml";

export type ValueDecl = { kind: "url"; source: "arg" };
export type GoogleDecl = {
  project_id: string;
  client_id: string;
  redirect_uris: string[];
  js_origins: string[];
};
export type Config = {
  project: { name: string };
  values: Record<string, ValueDecl>;
  destinations: { google?: GoogleDecl };
};

export class ConfigError extends Error {
  constructor(
    readonly line: number | null,
    readonly key: string | null,
    reason: string,
  ) {
    super(`busbar.toml${line ? `:${line}` : ""}: ${key ? `${key}: ` : ""}${reason}`);
    this.name = "ConfigError";
  }
}

/** Parse and validate busbar.toml. Throws a ConfigError with a one-line message. */
export function parseConfig(text: string): Config {
  let doc: Record<string, unknown>;
  try {
    doc = parse(text);
  } catch (e) {
    if (!(e instanceof TomlError)) throw e;
    const reason = e.message.split("\n")[0].replace(/^Invalid TOML document: /, "");
    throw new ConfigError(e.line, null, `invalid TOML: ${reason}`);
  }
  return validate(doc, text);
}

type Check = { test: (v: unknown) => boolean; expected: string };
const str: Check = {
  test: (v) => typeof v === "string" && v.length > 0,
  expected: "a non-empty string",
};
const oneOf = (...xs: string[]): Check => ({
  test: (v) => xs.includes(v as string),
  expected: xs.map((x) => `"${x}"`).join(" or "),
});
const templates: Check = {
  test: (v) => Array.isArray(v) && v.every((x) => typeof x === "string"),
  expected: "a list of URL templates",
};

type Table = Record<string, unknown>;
const asTable = (v: unknown): Table | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Table) : undefined;

/** How a key path is written in messages: `values."tunnel.url".source`. */
const show = (path: string[]) => path.map((p) => (/^[\w-]+$/.test(p) ? p : `"${p}"`)).join(".");

function validate(doc: Table, text: string): Config {
  /** Check `table.key`; `why` explains a missing key, `extra` explains a wrong one. */
  const need = (path: string[], key: string, check: Check, why: string, extra = "") => {
    const v = asTable(path.reduce<unknown>((t, p) => asTable(t)?.[p], doc))?.[key];
    if (v === undefined)
      throw new ConfigError(locate(text, path), show([...path, key]), `missing (${why})`);
    if (!check.test(v)) {
      const reason = `expected ${check.expected}${extra ? ` (${extra})` : ""}`;
      throw new ConfigError(locate(text, path, key), show([...path, key]), reason);
    }
    return v;
  };

  need(["project"], "name", str, "names this project's browser profile and run state");

  const values = asTable(doc.values) ?? {};
  for (const id of Object.keys(values)) {
    need(
      ["values", id],
      "kind",
      oneOf("url"),
      "what sort of value this is",
      "v0 wires public URLs only",
    );
    need(
      ["values", id],
      "source",
      oneOf("arg"),
      "where busbar gets it",
      "v0 takes values from flags like --tunnel",
    );
  }
  const declared = Object.keys(values);

  if (asTable(asTable(doc.destinations)?.google)) {
    const g = ["destinations", "google"];
    need(g, "project_id", str, "the Google Cloud project that owns the client");
    need(g, "client_id", str, "the OAuth web client to edit");
    for (const key of ["redirect_uris", "js_origins"]) {
      const list = need(
        g,
        key,
        templates,
        `the ${key === "js_origins" ? "JavaScript origins" : "redirect URIs"} busbar keeps in sync`,
      ) as string[];
      const unknown = list.flatMap(refsIn).find((ref) => !declared.includes(ref));
      if (unknown) {
        const known = declared.length ? declared.join(", ") : "none";
        throw new ConfigError(
          locate(text, g, key),
          show([...g, key]),
          `{${unknown}} is not a declared value (declared: ${known})`,
        );
      }
    }
  }
  return doc as unknown as Config;
}

/** Value ids a template like `{tunnel.url}/cb` refers to. */
export function refsIn(template: string): string[] {
  return [...template.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]);
}

/** Split a TOML key path like `values."tunnel.url"` into its parts. */
function keyPath(raw: string): string[] {
  return (raw.match(/"[^"]*"|'[^']*'|[^.\s]+/g) ?? []).map((p) => p.replace(/^["']|["']$/g, ""));
}

/**
 * Line of `key` inside the `[table]`, or of the table header when the key is absent.
 * Null when the table itself isn't written down.
 */
function locate(text: string, table: string[], key?: string): number | null {
  const lines = text.split("\n");
  const want = table.join("\0");
  const header = lines.findIndex((l) => {
    const m = l.match(/^\s*\[([^[\]]+)\]/);
    return m !== null && keyPath(m[1]).join("\0") === want;
  });
  if (header < 0) return null;
  if (key) {
    for (let i = header + 1; i < lines.length && !/^\s*\[/.test(lines[i]); i++) {
      const m = lines[i].match(/^\s*("[^"]*"|[\w-]+)\s*=/);
      if (m && keyPath(m[1])[0] === key) return i + 1;
    }
  }
  return header + 1;
}
